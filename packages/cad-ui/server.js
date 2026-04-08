/**
 * CAD UI API server — bridges the React frontend with cad-skill CLI.
 */
import express from 'express'
import cors from 'cors'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = 3788

const app = express()
app.use(cors())
app.use(express.json())

// ── Health ────────────────────────────────────────────────────────────────

app.get('/api/health', async (_req, res) => {
  let dockerOk = false
  try {
    const r = await fetch('http://localhost:8765/health', { signal: AbortSignal.timeout(2000) })
    dockerOk = r.ok
  } catch {}
  res.json({ ok: true, docker: dockerOk })
})

// ── Generate code ──────────────────────────────────────────────────────────

app.post('/api/generate', async (req, res) => {
  const { description } = req.body
  if (!description?.trim()) return res.status(400).json({ error: 'description required' })

  // Set up SSE for streaming updates
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  send('status', { message: 'Generating Build123d code...' })

  try {
    const code = await runCadSkill(['code', description])
    send('code', { code })
    send('status', { message: 'Code generated' })

    // Try Docker execution
    send('status', { message: 'Executing model...' })
    try {
      const result = await executeCode(code)
      if (result.success) {
        send('result', {
          success: true,
          metrics: result.metrics,
          stl_b64: result.exports?.stl_b64,
        })
      } else {
        send('result', { success: false, error: result.error })
      }
    } catch (e) {
      send('result', { success: false, error: 'Docker executor not available — showing code only' })
    }

    send('done', {})
    res.end()
  } catch (err) {
    send('error', { message: err.message })
    res.end()
  }
})

// ── Refine code ────────────────────────────────────────────────────────────

app.post('/api/refine', async (req, res) => {
  const { description, currentCode } = req.body
  if (!description?.trim()) return res.status(400).json({ error: 'description required' })

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  send('status', { message: 'Refining model...' })

  try {
    const prompt = currentCode
      ? `Modify this Build123d code:\n\`\`\`python\n${currentCode}\n\`\`\`\n\nChange: ${description}\n\nOutput corrected Python only.`
      : description

    const code = await runCadSkill(['code', prompt])
    send('code', { code })

    send('status', { message: 'Executing refined model...' })
    try {
      const result = await executeCode(code)
      if (result.success) {
        send('result', { success: true, metrics: result.metrics, stl_b64: result.exports?.stl_b64 })
      } else {
        send('result', { success: false, error: result.error })
      }
    } catch {
      send('result', { success: false, error: 'Docker not available' })
    }

    send('done', {})
    res.end()
  } catch (err) {
    send('error', { message: err.message })
    res.end()
  }
})

// ── Helpers ────────────────────────────────────────────────────────────────

function runCadSkill(args) {
  return new Promise((resolve, reject) => {
    const cadSkillBin = path.resolve(__dirname, '../cad-skill/bin/cad-skill.js')
    const env = { ...process.env }
    delete env.CLAUDECODE

    const child = spawn('node', [cadSkillBin, ...args], { env })
    let out = ''
    let err = ''
    child.stdout.on('data', d => { out += d })
    child.stderr.on('data', d => { err += d })
    child.on('close', code => {
      if (code !== 0) reject(new Error(err || 'cad-skill failed'))
      else {
        // Strip ANSI codes and extract plain code
        const clean = out.replace(/\x1b\[[0-9;]*m/g, '').trim()
        // Remove ora spinner lines (lines with ✔ or ✖)
        const lines = clean.split('\n').filter(l => !l.match(/^[✔✖─]/))
        resolve(lines.join('\n').trim())
      }
    })
    child.on('error', reject)
  })
}

async function executeCode(code) {
  const res = await fetch('http://localhost:8765/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
    signal: AbortSignal.timeout(120_000),
  })
  if (!res.ok) throw new Error(`Executor HTTP ${res.status}`)
  return res.json()
}

app.listen(PORT, () => {
  console.log(`CAD UI API server running at http://localhost:${PORT}`)
})
