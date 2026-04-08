/**
 * cad-web local server
 *
 * GET  /api/status
 * GET  /api/providers
 * GET  /api/ai-config          POST /api/ai-config
 * POST /api/generate           (SSE)
 * GET  /api/assets             list all saved assets
 * DELETE /api/assets/:id       delete asset folder
 * GET  /api/model/:id/stl
 * GET  /api/model/:id/render/:view
 */

import express    from 'express'
import path       from 'node:path'
import fs         from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { CadLoop, executeCadCode, checkExecutorHealth, defaultConfig, PROVIDERS } from '../cad-skill/src/index.js'

const __dirname    = path.dirname(fileURLToPath(import.meta.url))
const OUTPUT_BASE  = path.join(__dirname, 'output')
const CONFIG_FILE  = path.join(__dirname, 'ai-config.json')

const app = express()
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

const sessions = new Map()

// ── AI Config ─────────────────────────────────────────────────────────────────

async function readAiConfig() {
  try { return { ...defaultConfig(), ...JSON.parse(await fs.readFile(CONFIG_FILE, 'utf8')) } }
  catch { return defaultConfig() }
}

async function writeAiConfig(cfg) {
  await fs.writeFile(CONFIG_FILE, JSON.stringify(cfg, null, 2))
}

app.get('/api/providers',  (_req, res) => res.json(PROVIDERS))

app.get('/api/ai-config', async (_req, res) => {
  const cfg = await readAiConfig()
  res.json({ ...cfg, apiKey: cfg.apiKey ? '••••••••' + cfg.apiKey.slice(-4) : '' })
})

app.post('/api/ai-config', async (req, res) => {
  const current = await readAiConfig()
  const update  = req.body ?? {}
  if (update.apiKey?.startsWith('••••')) delete update.apiKey
  await writeAiConfig({ ...current, ...update })
  sessions.clear()
  res.json({ ok: true })
})

// ── Status ────────────────────────────────────────────────────────────────────

app.get('/api/status', async (_req, res) => {
  const [executor, cfg] = await Promise.all([checkExecutorHealth(), readAiConfig()])
  res.json({ executor, aiProvider: cfg.provider })
})

// ── Assets ────────────────────────────────────────────────────────────────────

async function listAssets() {
  try {
    const entries = await fs.readdir(OUTPUT_BASE, { withFileTypes: true })
    const assets  = []
    for (const e of entries) {
      if (!e.isDirectory()) continue
      const id   = e.name
      const dir  = path.join(OUTPUT_BASE, id)
      try {
        const meta = JSON.parse(await fs.readFile(path.join(dir, 'meta.json'), 'utf8'))
        const stlStat = await fs.stat(path.join(dir, 'model.stl')).catch(() => null)
        assets.push({
          id,
          description:  meta.description  ?? '(no description)',
          timestamp:    meta.timestamp     ?? 0,
          metrics:      meta.metrics       ?? {},
          printability: meta.printability  ?? {},
          hasStl:       !!stlStat,
          stlBytes:     stlStat?.size ?? 0,
          renders:      meta.renders       ?? [],
        })
      } catch { /* skip folders without meta */ }
    }
    return assets.sort((a, b) => b.timestamp - a.timestamp)
  } catch { return [] }
}

app.get('/api/assets', async (_req, res) => {
  res.json(await listAssets())
})

app.delete('/api/assets/:id', async (req, res) => {
  try {
    const dir = path.resolve(path.join(OUTPUT_BASE, req.params.id))
    if (!dir.startsWith(OUTPUT_BASE)) return res.status(400).end()
    await fs.rm(dir, { recursive: true, force: true })
    sessions.delete(req.params.id)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── Generate (SSE) ────────────────────────────────────────────────────────────

app.post('/api/generate', async (req, res) => {
  const { description, sessionId, mode = 'new', imageBase64, imageMimeType } = req.body
  if (!description?.trim()) return res.status(400).json({ error: 'description is required' })

  res.setHeader('Content-Type',  'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection',    'keep-alive')

  const emit = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`)

  try {
    const id        = sessionId || crypto.randomUUID()
    const outputDir = path.join(OUTPUT_BASE, id)
    const aiCfg     = await readAiConfig()

    let loop = sessions.get(id)

    const log = (msg) => {
      console.log(`[${id.slice(0, 8)}] ${msg}`)
      emit({ type: 'log', text: msg })
    }

    if (!loop || mode === 'new') {
      loop = new CadLoop({
        outputDir,
        verbose:    false,
        provider:   aiCfg.provider,
        model:      aiCfg.model,
        baseUrl:    aiCfg.baseUrl,
        apiKey:     aiCfg.apiKey,
        onProgress: log,
        onCode:     (code) => emit({ type: 'code', code }),
      })
      sessions.set(id, loop)
    } else {
      loop.onProgress = log
      loop.onCode     = (code) => emit({ type: 'code', code })
      loop.aiOpts     = { provider: aiCfg.provider, model: aiCfg.model, baseUrl: aiCfg.baseUrl, apiKey: aiCfg.apiKey }
    }

    const useRefine = mode === 'refine' && loop.currentCode
    log(`Provider: ${aiCfg.provider}${aiCfg.model ? ` / ${aiCfg.model}` : ''}`)
    log(useRefine ? 'Mode: refine existing model' : 'Mode: generate new model')
    if (imageBase64) log('Image attached — using vision')

    const { code, result, rounds, renderPaths } = useRefine
      ? await loop.refine(description.trim())
      : await loop.generate(description.trim(), imageBase64 || null, imageMimeType || null)

    if (result.success) {
      // Export STL
      try {
        const stlPath = await loop.export('stl', 'model')
        log(`STL saved → ${stlPath}`)
      } catch (e) { log(`STL export failed: ${e.message}`) }

      // Save metadata for asset manager
      const meta = {
        id,
        description:  description.trim(),
        timestamp:    Date.now(),
        metrics:      result.metrics      ?? {},
        printability: result.printability ?? {},
        code:         code                ?? '',
        renders:      Object.keys(renderPaths),
      }
      await fs.mkdir(outputDir, { recursive: true })
      await fs.writeFile(path.join(outputDir, 'meta.json'), JSON.stringify(meta, null, 2))

      emit({
        type:         'done',
        sessionId:    id,
        rounds,
        metrics:      result.metrics      ?? {},
        printability: result.printability ?? {},
        renderViews:  Object.keys(renderPaths),
      })
    } else {
      emit({ type: 'error', text: result.error ?? 'Execution failed after all correction rounds' })
    }
  } catch (err) {
    emit({ type: 'error', text: err.message })
  }

  res.end()
})

// ── Param update (re-exec code with patched values, no AI) ────────────────────

app.post('/api/model/:id/exec-params', async (req, res) => {
  try {
    const id  = req.params.id
    const dir = safeJoin(OUTPUT_BASE, id)
    const { params } = req.body   // { PARAM_NAME: newValue, ... }

    // Load saved code
    const meta = JSON.parse(await fs.readFile(path.join(dir, 'meta.json'), 'utf8'))
    let code = meta.code
    if (!code) return res.status(400).json({ error: 'No saved code for this asset' })

    // Patch parameter lines: NAME = <number>  # @param ...
    for (const [name, value] of Object.entries(params)) {
      code = code.replace(
        new RegExp(`^(${name}\\s*=\\s*)[\\d.]+`, 'm'),
        `$1${value}`
      )
    }

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    const emit = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`)

    emit({ type: 'log', text: 'Re-executing with updated parameters...' })

    const loop = sessions.get(id) || new CadLoop({ outputDir: dir })
    loop.currentCode = code
    loop._lastResult = null

    const result = await executeCadCode(code)
    if (!result.success) {
      emit({ type: 'error', text: result.error ?? 'Execution failed' })
      res.end(); return
    }

    // Save STL
    const stlB64 = result.exports?.stl_b64
    if (stlB64) await fs.writeFile(path.join(dir, 'model.stl'), Buffer.from(stlB64, 'base64'))

    // Save renders
    const renderPaths = {}
    for (const [view, b64] of Object.entries(result.renders || {})) {
      if (typeof b64 !== 'string') continue
      const fp = path.join(dir, `model_${view}.png`)
      await fs.writeFile(fp, Buffer.from(b64, 'base64'))
      renderPaths[view] = fp
    }

    // Update meta
    meta.code         = code
    meta.metrics      = result.metrics      ?? meta.metrics
    meta.printability = result.printability ?? meta.printability
    meta.renders      = Object.keys(renderPaths)
    await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2))

    // Update session cache
    if (sessions.has(id)) {
      sessions.get(id).currentCode = code
      sessions.get(id)._lastResult = result
    }

    emit({ type: 'done', metrics: result.metrics ?? {}, printability: result.printability ?? {}, renderViews: Object.keys(renderPaths) })
    res.end()
  } catch(e) {
    res.status(500).json({ error: e.message })
  }
})

// ── Serve model files ─────────────────────────────────────────────────────────

function safeJoin(base, ...parts) {
  const r = path.resolve(path.join(base, ...parts))
  if (!r.startsWith(base)) throw new Error('Path traversal')
  return r
}

app.get('/api/model/:id/meta', async (req, res) => {
  try {
    const p = safeJoin(OUTPUT_BASE, req.params.id, 'meta.json')
    res.json(JSON.parse(await fs.readFile(p, 'utf8')))
  } catch { res.status(404).json({ error: 'not found' }) }
})

app.get('/api/model/:id/stl', (req, res) => {
  try {
    res.sendFile(safeJoin(OUTPUT_BASE, req.params.id, 'model.stl'),
      err => { if (err && !res.headersSent) res.status(404).end() })
  } catch { res.status(400).end() }
})

app.get('/api/model/:id/step', (req, res) => {
  try {
    res.sendFile(safeJoin(OUTPUT_BASE, req.params.id, 'model.step'),
      err => { if (err && !res.headersSent) res.status(404).end() })
  } catch { res.status(400).end() }
})

app.get('/api/model/:id/render/:view', (req, res) => {
  try {
    const view = req.params.view.replace(/[^a-z]/g, '')
    res.sendFile(safeJoin(OUTPUT_BASE, req.params.id, `model_${view}.png`),
      err => { if (err && !res.headersSent) res.status(404).end() })
  } catch { res.status(400).end() }
})

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT ?? 3333
readAiConfig().then(cfg => {
  app.listen(PORT, () => {
    console.log(`\n  CAD Web UI  →  http://localhost:${PORT}`)
    console.log(`  AI provider →  ${cfg.provider}${cfg.model ? ` (${cfg.model})` : ''}`)
    console.log(`  Executor    →  http://localhost:8765\n`)
  })
})
