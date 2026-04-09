/**
 * Executor — runs OpenSCAD natively on the host machine.
 * Falls back to HTTP executor if CAD_EXECUTOR_URL is set.
 */

import { spawn }         from 'node:child_process'
import { promises as fs } from 'node:fs'
import { accessSync }     from 'node:fs'
import path               from 'node:path'
import os                 from 'node:os'

const EXECUTOR_URL  = process.env.CAD_EXECUTOR_URL ?? null
const OPENSCAD_BIN  = process.env.OPENSCAD_BIN     ?? findOpenSCAD()

function findOpenSCAD() {
  // Common install locations
  const candidates = [
    '/opt/homebrew/bin/openscad',
    '/usr/local/bin/openscad',
    '/usr/bin/openscad',
    '/Applications/OpenSCAD.app/Contents/MacOS/OpenSCAD',
  ]
  for (const c of candidates) {
    try { accessSync(c); return c } catch {}
  }
  return 'openscad'
}

// ── Native OpenSCAD execution ─────────────────────────────────────────────────

async function executeNative(code, params = {}) {
  const tmpDir  = await fs.mkdtemp(path.join(os.tmpdir(), 'cad-'))
  const scadFile = path.join(tmpDir, 'model.scad')
  const stlFile  = path.join(tmpDir, 'model.stl')

  try {
    await fs.writeFile(scadFile, code)

    // Build args — use -D to override parameters
    const args = ['--export-format', 'stl', '-o', stlFile]
    for (const [k, v] of Object.entries(params)) args.push('-D', `${k}=${v}`)
    args.push(scadFile)

    const { exitCode, stderr } = await runProcess(OPENSCAD_BIN, args, 60_000)

    // Check stl exists (OpenSCAD may exit 0 but only produce warnings)
    let stlExists = false
    try { await fs.access(stlFile); stlExists = true } catch {}

    if (!stlExists || (exitCode !== 0 && exitCode !== null)) {
      // Filter out INFO/WARNING lines, keep ERROR lines
      const errLines = (stderr || '').split('\n')
        .filter(l => /ERROR|error|undefined/.test(l))
        .join('\n')
        .trim()
      return { success: false, error: errLines || stderr?.slice(-1000) || 'OpenSCAD failed' }
    }

    const stlBuf = await fs.readFile(stlFile)
    const metrics = await getMetrics(stlFile)

    return {
      success:      true,
      metrics,
      printability: getPrintability(metrics),
      renders:      {},  // rendered client-side via Three.js
      exports:      { stl_b64: stlBuf.toString('base64') },
    }
  } finally {
    fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
}

function runProcess(bin, args, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(bin, args)
    let stderr = ''
    child.stderr.on('data', d => { stderr += d })
    const timer = setTimeout(() => { child.kill(); resolve({ exitCode: -1, stderr: 'Timeout' }) }, timeoutMs)
    child.on('close', code => { clearTimeout(timer); resolve({ exitCode: code, stderr }) })
    child.on('error', err => { clearTimeout(timer); resolve({ exitCode: -1, stderr: err.message }) })
  })
}

// ── Metrics via trimesh (Python) ──────────────────────────────────────────────

async function getMetrics(stlFile) {
  const script = `
import trimesh, json, sys
m = trimesh.load(sys.argv[1], force='mesh')
bb = m.bounding_box.extents
print(json.dumps({"bounding_box":{"x":round(float(bb[0]),2),"y":round(float(bb[1]),2),"z":round(float(bb[2]),2)},"volume_mm3":round(float(m.volume),2),"is_valid":bool(m.is_watertight)}))
`
  return new Promise(resolve => {
    const child = spawn('python3', ['-c', script, stlFile])
    let out = '', err = ''
    const timer = setTimeout(() => { child.kill(); resolve({}) }, 20_000)
    child.stdout.on('data', d => out += d)
    child.stderr.on('data', d => err += d)
    child.on('close', code => {
      clearTimeout(timer)
      if (code !== 0) {
        if (/No module named/.test(err)) {
          console.error('[executor] Python metrics unavailable — install deps: pip3 install trimesh')
        } else if (err.trim()) {
          console.error('[executor] metrics python error:', err.slice(0, 300))
        }
        resolve({})
        return
      }
      try { resolve(JSON.parse(out.trim())) } catch {
        console.error('[executor] metrics JSON parse failed:', out.slice(0, 200))
        resolve({})
      }
    })
    child.on('error', e => {
      clearTimeout(timer)
      console.error('[executor] failed to spawn python3 for metrics:', e.message)
      resolve({})
    })
  })
}

function getPrintability(metrics) {
  return {
    is_watertight: metrics.is_valid ?? false,
    volume_mm3:    metrics.volume_mm3 ?? 0,
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function executeCadCode(code, params = {}) {
  // Prefer HTTP executor if explicitly configured
  if (EXECUTOR_URL) {
    const res = await fetch(`${EXECUTOR_URL}/execute`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ code, params }),
      signal:  AbortSignal.timeout(120_000),
    })
    if (!res.ok) throw new Error(`Executor HTTP ${res.status}`)
    return res.json()
  }
  return executeNative(code, params)
}

export async function checkExecutorHealth() {
  if (EXECUTOR_URL) {
    try {
      const res = await fetch(`${EXECUTOR_URL}/health`, { signal: AbortSignal.timeout(3000) })
      return res.ok
    } catch { return false }
  }
  // Check that openscad binary exists
  try {
    const { exitCode } = await runProcess(OPENSCAD_BIN, ['--version'], 3000)
    return exitCode === 0
  } catch { return false }
}
