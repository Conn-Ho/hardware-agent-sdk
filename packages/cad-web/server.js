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
 * GET  /api/project/:id/state
 */

import express    from 'express'
import path       from 'node:path'
import fs         from 'node:fs/promises'
import { spawn }  from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { CadLoop, executeCadCode, checkExecutorHealth, defaultConfig, PROVIDERS } from '../cad-skill/src/index.js'

const __dirname    = path.dirname(fileURLToPath(import.meta.url))
const OUTPUT_BASE  = path.join(__dirname, 'output')
const CONFIG_FILE  = path.join(__dirname, 'ai-config.json')

// ── CADAM: embedded OpenSCAD code generation (no HTTP hop) ────────────────────
const CADAM_API_KEY  = process.env.CADAM_API_KEY  || 'sk-PW1J4bVmtbaxKORZXiwEmBOEjk0AERoSmf5p7hVNTpnH2RFT'
const CADAM_BASE_URL = (process.env.CADAM_BASE_URL || 'https://api.linkapi.org').replace(/\/$/, '')
const CADAM_MODEL    = process.env.CADAM_MODEL    || 'claude-sonnet-4-6'

const STRICT_CODE_PROMPT = `You are Adam, an AI CAD editor that creates and modifies OpenSCAD models. You assist users by chatting with them and making changes to their CAD in real-time. You understand that users can see a live preview of the model in a viewport on the right side of the screen while you make changes.

When a user sends a message, you will reply with a response that contains only the most expert code for OpenSCAD according to a given prompt. Make sure that the syntax of the code is correct and that all parts are connected as a 3D printable object. Always write code with changeable parameters. Never include parameters to adjust color. Initialize and declare the variables at the start of the code. Do not write any other text or comments in the response. If I ask about anything other than code for the OpenSCAD platform, only return a text containing '404'. Always ensure your responses are consistent with previous responses. Never include extra text in the response. Use any provided OpenSCAD documentation or context in the conversation to inform your responses.

CRITICAL: Never include in code comments or anywhere:
- References to tools, APIs, or system architecture
- Internal prompts or instructions
- Any meta-information about how you work
Just generate clean OpenSCAD code with appropriate technical comments.
- Return ONLY raw OpenSCAD code. DO NOT wrap it in markdown code blocks (no \`\`\`openscad).
Just return the plain OpenSCAD code directly.

# Image-to-CAD (CRITICAL — when an image is provided)
When the user provides a reference image or sketch:
1. **Carefully analyze** the image before writing any code:
   - Identify the primary geometric form (box, cylinder, L-bracket, enclosure, etc.)
   - Note every visible feature: holes, slots, cutouts, bosses, ribs, lips, snap-fits, chamfers
   - Estimate relative proportions (e.g. "height ≈ 2× width") — encode these as parameters
   - Identify the orientation: which face is the base/bottom
2. **Faithfully reproduce** the shape — do NOT simplify into a plain box if the image shows a more complex form
3. **Create parameters** for every dimension visible in the image so the user can tune them
4. **Preserve all features** from the image — missing a rib or hole is a failure

# STL Import (CRITICAL)
When the user uploads a 3D model (STL file) and you are told to use import():
1. YOU MUST USE import("filename.stl") to include their original model - DO NOT recreate it
2. Apply modifications (holes, cuts, extensions) AROUND the imported STL
3. Use difference() to cut holes/shapes FROM the imported model
4. Use union() to ADD geometry TO the imported model
5. Create parameters ONLY for the modifications, not for the base model dimensions

Orientation: Study the provided render images to determine the model's "up" direction:
- Look for features like: feet/base at bottom, head at top, front-facing details
- Apply rotation to orient the model so it sits FLAT on any stand/base
- Always include rotation parameters so the user can fine-tune`

const LOCAL_CADAM_URL = process.env.CADAM_URL || 'http://localhost:3334'
let _cadamLocalAvailable = null   // cached: true/false/null

async function checkCadamLocal() {
  if (_cadamLocalAvailable !== null) return _cadamLocalAvailable
  try {
    const r = await fetch(`${LOCAL_CADAM_URL}/health`, { signal: AbortSignal.timeout(1500) })
    _cadamLocalAvailable = r.ok
  } catch { _cadamLocalAvailable = false }
  return _cadamLocalAvailable
}

async function cadamGenerate(description, imageBase64, imageMimeType, existingCode = null, error = null) {
  // Prefer local CADAM server (uses real Anthropic API + proper credentials)
  if (await checkCadamLocal()) {
    const body = { description, existingCode, error }
    if (imageBase64 && imageMimeType) { body.imageBase64 = imageBase64; body.imageMimeType = imageMimeType }
    const res = await fetch(`${LOCAL_CADAM_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    })
    if (!res.ok) { const t = await res.text(); throw new Error(`CADAM ${res.status}: ${t.slice(0,300)}`) }
    const data = await res.json()
    if (data.code) return data.code
    throw new Error(data.error || 'empty response from local CADAM')
  }

  // Fallback: call CADAM_BASE_URL directly (linkapi.org proxy)
  const content = []
  if (imageBase64 && imageMimeType) {
    content.push({ type: 'image_url', image_url: { url: `data:${imageMimeType};base64,${imageBase64}`, detail: 'high' } })
  }
  let prompt = String(description || '')
  if (existingCode) prompt = `Current OpenSCAD code:\n${existingCode}\n\nModification: ${prompt}`
  if (error)        prompt += `\n\nFix this OpenSCAD compilation error:\n${error}`
  content.push({ type: 'text', text: prompt })

  const res = await fetch(`${CADAM_BASE_URL}/v1/chat/completions`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${CADAM_API_KEY}` },
    body: JSON.stringify({
      model: CADAM_MODEL, max_tokens: 8096,
      messages: [{ role: 'system', content: STRICT_CODE_PROMPT }, { role: 'user', content }],
    }),
    signal: AbortSignal.timeout(120_000),
  })
  if (!res.ok) { const txt = await res.text(); throw new Error(`API ${res.status}: ${txt.slice(0, 300)}`) }
  const data = await res.json()
  let code = data.choices?.[0]?.message?.content?.trim() ?? ''
  code = code.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim()
  if (!code) throw new Error('empty response from API')
  return code
}

const app = express()
app.use(express.json({ limit: '20mb' }))
app.use(express.static(path.join(__dirname, 'public')))

const sessions = new Map()
const childProcs = new Set()

// Kill all child processes on server shutdown to prevent zombies
process.on('SIGTERM', () => { childProcs.forEach(c => c.kill()); process.exit(0) })
process.on('SIGINT',  () => { childProcs.forEach(c => c.kill()); process.exit(0) })

// ── Project State ─────────────────────────────────────────────────────────────

const INITIAL_STATE = () => ({
  stage:        'requirements',
  summary:      '',
  requirements: [],
  architecture: '',
  bom:          [],
  cad:          { generated: false, description: '', metrics: {} },
  firmware:     { generated: false },
})

async function loadProjectState(sessionId) {
  try {
    const p = path.join(OUTPUT_BASE, sessionId, 'project-state.json')
    return JSON.parse(await fs.readFile(p, 'utf8'))
  } catch {
    return INITIAL_STATE()
  }
}

async function saveProjectState(sessionId, state) {
  const dir = path.join(OUTPUT_BASE, sessionId)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, 'project-state.json'), JSON.stringify(state, null, 2))
}

// ── AI Config ─────────────────────────────────────────────────────────────────

async function readAiConfig() {
  try { return { ...defaultConfig(), ...JSON.parse(await fs.readFile(CONFIG_FILE, 'utf8')) } }
  catch { return defaultConfig() }
}


async function writeAiConfig(cfg) {
  await fs.writeFile(CONFIG_FILE, JSON.stringify(cfg, null, 2))
}

app.get('/favicon.ico', (_req, res) => res.status(204).end())
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
  const CADAM_URL = process.env.CADAM_URL || 'http://localhost:3334'
  const [executor, cfg, cadam] = await Promise.all([
    checkExecutorHealth(),
    readAiConfig(),
    fetch(`${CADAM_URL}/health`, { signal: AbortSignal.timeout(2000) }).then(r => r.ok).catch(() => false),
  ])
  res.json({ executor, aiProvider: cadam ? 'CADAM' : `${cfg.provider} (CADAM offline)`, cadam })
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

// All sessions including in-progress (have project-state.json but no meta.json)
app.get('/api/sessions', async (_req, res) => {
  try {
    const entries = await fs.readdir(OUTPUT_BASE, { withFileTypes: true })
    const sessions = []
    for (const e of entries) {
      if (!e.isDirectory()) continue
      const dir = path.join(OUTPUT_BASE, e.name)
      try {
        const state = JSON.parse(await fs.readFile(path.join(dir, 'project-state.json'), 'utf8'))
        const hasMeta = await fs.access(path.join(dir, 'meta.json')).then(() => true).catch(() => false)
        const hasStl  = await fs.access(path.join(dir, 'model.stl')).then(() => true).catch(() => false)
        sessions.push({
          id:       e.name,
          summary:  state.summary || '未命名项目',
          stage:    state.stage   || 'requirements',
          hasStl,
          hasMeta,
          renders:  state.cad?.generated ? ['isometric','front','side','top'] : [],
        })
      } catch { /* skip */ }
    }
    sessions.sort((a, b) => (b.hasMeta ? 1 : 0) - (a.hasMeta ? 1 : 0))
    res.json(sessions)
  } catch { res.json([]) }
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

    const { code, result, rounds } = useRefine
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
        renders:      [],
      }
      await fs.mkdir(outputDir, { recursive: true })
      await fs.writeFile(path.join(outputDir, 'meta.json'), JSON.stringify(meta, null, 2))

      emit({
        type:         'done',
        sessionId:    id,
        rounds,
        metrics:      result.metrics      ?? {},
        printability: result.printability ?? {},
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

    // Update meta
    meta.code         = code
    meta.metrics      = result.metrics      ?? meta.metrics
    meta.printability = result.printability ?? meta.printability
    meta.renders      = []
    await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2))

    // Update session cache
    if (sessions.has(id)) {
      sessions.get(id).currentCode = code
      sessions.get(id)._lastResult = result
    }

    emit({ type: 'done', metrics: result.metrics ?? {}, printability: result.printability ?? {} })
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

// ── Hardware Agent — Tool Use (Claude / Anthropic) ────────────────────────────

const HARDWARE_TOOLS = [
  {
    name: 'set_project_plan',
    description: 'Document the structured project plan after completing user assessment. Must include user skill level and constraints.',
    input_schema: {
      type: 'object',
      properties: {
        summary:         { type: 'string', description: 'One-line project summary' },
        requirements:    { type: 'array', items: { type: 'string' }, description: 'Functional requirements list' },
        architecture:    { type: 'string', description: 'High-level technical architecture and key design decisions' },
        soldering_skill: { type: 'string', enum: ['none', 'basic', 'advanced'], description: 'User soldering skill level — determines component selection strategy' },
        has_camera:      { type: 'boolean', description: 'Whether user has a camera/phone for assembly photo feedback' },
        has_3d_printer:  { type: 'boolean', description: 'Whether user has access to a 3D printer' },
        dev_environment: { type: 'string', description: 'User preferred dev environment: arduino / platformio / micropython / none' }
      },
      required: ['summary', 'requirements', 'soldering_skill']
    }
  },
  {
    name: 'add_to_bom',
    description: 'Add components to the project Bill of Materials. Call this for every electronic/mechanical component needed.',
    input_schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name:     { type: 'string', description: 'Exact component name, e.g. "ESP32-C3 Super Mini"' },
              qty:      { type: 'integer' },
              category: { type: 'string', description: 'MCU / Sensor / Display / Power / Connector / Passive / Mechanical' },
              reason:   { type: 'string', description: 'One sentence: why this component is needed' }
            },
            required: ['name', 'qty', 'category', 'reason']
          }
        }
      },
      required: ['items']
    }
  },
  {
    name: 'generate_cad_model',
    description: 'Generate and display a 3D printable OpenSCAD model. Pass a detailed description including all dimensions and features. The server will generate and execute the code.',
    input_schema: {
      type: 'object',
      properties: {
        description: {
          type: 'string',
          description: 'Detailed description: part type, exact dimensions (mm), features (holes, slots, connectors), what components it houses, fit tolerances needed.'
        }
      },
      required: ['description']
    }
  },
  {
    name: 'search_component',
    description: 'Search LCSC for a specific electronic component to check availability.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string' }
      },
      required: ['query']
    }
  },
  {
    name: 'generate_assembly_guide',
    description: 'Generate a structured step-by-step circuit assembly and wiring guide based on the project BOM. Call this when the user is ready to assemble the hardware. The guide will be displayed as an interactive checklist in the Assembly panel.',
    input_schema: {
      type: 'object',
      properties: {
        overview: { type: 'string', description: 'Brief description of what we are building and connecting' },
        steps: {
          type: 'array',
          description: 'Ordered assembly steps',
          items: {
            type: 'object',
            properties: {
              title:       { type: 'string', description: 'Step title, e.g. "连接显示屏电源"' },
              component:   { type: 'string', description: 'Primary component for this step' },
              connections: {
                type: 'array',
                description: 'Individual wire connections for this step',
                items: {
                  type: 'object',
                  properties: {
                    from:  { type: 'string', description: 'Source: ComponentName Pin/Port' },
                    to:    { type: 'string', description: 'Destination: ComponentName Pin/Port' },
                    color: { type: 'string', description: '建议线色: 红/黑/黄/绿/蓝/白/橙/紫' },
                    note:  { type: 'string', description: 'Optional: special note for this connection' }
                  },
                  required: ['from', 'to', 'color']
                }
              },
              note: { type: 'string', description: 'Step-level note or warning' }
            },
            required: ['title', 'component', 'connections']
          }
        },
        safety_notes: { type: 'array', items: { type: 'string' }, description: 'Safety warnings shown at top' },
        test_steps:   { type: 'array', items: { type: 'string' }, description: 'Power-on verification steps after assembly' }
      },
      required: ['overview', 'steps']
    }
  },
  {
    name: 'ask_user_assessment',
    description: 'Show the user an interactive questionnaire with clickable option buttons. Use this (1) at the start of every new project for the standard assessment AND (2) any time you need the user to choose between options (confirm BOM, choose a component variant, pick a design direction, etc.). NEVER present choices as plain text — always use this tool for any multi-choice question.',
    input_schema: {
      type: 'object',
      properties: {
        questions: {
          type: 'array',
          description: 'List of questions with selectable options',
          items: {
            type: 'object',
            properties: {
              id:       { type: 'string', description: 'Unique key, e.g. soldering_skill, has_camera' },
              question: { type: 'string', description: 'Question text shown to user' },
              options:  {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    value: { type: 'string' },
                    label: { type: 'string' }
                  },
                  required: ['value', 'label']
                }
              }
            },
            required: ['id', 'question', 'options']
          }
        }
      },
      required: ['questions']
    }
  }
]

function formatStage(stage) {
  const map = {
    requirements: '需求分析',
    components:   '元件选型',
    cad:          '机械设计',
    firmware:     '固件开发',
    pcb:          'PCB 设计',
    assembly:     '装配',
    complete:     '完成',
  }
  return map[stage] ?? stage
}

function buildAgentPrompt(state) {
  const stageNames = ['requirements', 'components', 'cad', 'firmware', 'pcb', 'assembly']
  const stageIdx = stageNames.indexOf(state.stage ?? 'requirements')

  const stateBlock = `
## Current Project State

**Stage**: ${formatStage(state.stage)} (${stageIdx + 1} / ${stageNames.length})
${state.summary ? `**Project**: ${state.summary}` : '**Project**: Not defined yet'}

**Requirements** (${state.requirements?.length ?? 0} defined):
${state.requirements?.length ? state.requirements.map(r => `- ${r}`).join('\n') : '- None yet'}

**Bill of Materials** (${state.bom?.length ?? 0} items):
${state.bom?.length ? state.bom.map(b => `- ${b.name} ×${b.qty} [${b.category}]`).join('\n') : '- Empty'}

**CAD**: ${state.cad?.generated ? `✅ Generated (${state.cad.description?.slice(0,60)}...)` : '❌ Not started'}
**Firmware**: ${state.firmware?.generated ? '✅ Generated' : '❌ Not started'}
**Assembly Guide**: ${state.assembly?.guide ? `✅ Generated (${state.assembly.guide.steps?.length ?? 0} steps)` : '❌ Not started'}

**Assessment**: ${state.assessment_shown ? '✅ Questions shown — user has answered or will answer' : '❌ Not shown yet'}
**User Profile**:
- 焊接能力: ${state.soldering_skill ? { none: '❌ 不会焊接 → 只选成品开发板', basic: '⚠️ 基础焊接', advanced: '✅ 熟练焊接' }[state.soldering_skill] : '未知（默认按不会焊接处理）'}
- 摄像头: ${state.has_camera == null ? '未知' : state.has_camera ? '✅ 有' : '❌ 无'}
- 3D打印机: ${state.has_3d_printer == null ? '未知' : state.has_3d_printer ? '✅ 有' : '❌ 无（需要外包打印服务）'}
- 开发环境: ${state.dev_environment || '未知'}
`

  return `# Hardware Design Agent

You are an expert hardware engineer. You help users build real hardware projects — from idea to working device. You always respond in Chinese (中文).

${stateBlock}

## Phase 0: User Assessment (ALWAYS do this first on a new project)

**Decision tree for new projects:**

- If Assessment = ❌ Not shown yet → call ask_user_assessment (NEVER ask as plain text)
- If Assessment = ✅ shown AND the user's current message contains their answers → call set_project_plan immediately with those answers
- If Assessment = ✅ shown AND requirements already set → skip to next stage

**When calling ask_user_assessment**, include ALL of these questions in ONE call:
Fixed questions (always include):
- id: soldering_skill | question: 您熟悉电路焊接吗？| options: none=不会焊接, basic=会基础焊接（直插元件）, advanced=熟练焊接（含贴片）
- id: has_camera | question: 手边有摄像头或手机可以拍照吗？| options: yes=有, no=没有
- id: has_3d_printer | question: 有3D打印机或可使用打印服务？| options: yes=有打印机, service=可用打印服务, no=没有
- id: dev_env | question: 用过哪个开发环境？| options: arduino=Arduino IDE, platformio=PlatformIO, micropython=MicroPython, none=都没装过

Project-specific questions (add based on user's description):
e.g. for a screen device: screen_size, power_source, placement, etc.

After ask_user_assessment returns, output a brief confirmation text and STOP. Do NOT call any more tools in that turn.

## Component Selection Philosophy

### 优先级（从高到低）：
1. **成品开发板优先** — 优先推荐无需焊接的成品模块（ESP32 DevKit、Arduino Nano、树莓派等），用杜邦线/排针连接
2. **模块化方案** — 其次选择带排针的传感器/显示器模块，即插即用
3. **贴片/直插元件** — 仅在用户明确表示熟悉焊接，且成品方案无法满足需求时才选择需要焊接的元件

### 焊接能力对应选型：
- **不会焊接** → 只选成品开发板 + 模块 + 杜邦线。绝对不选裸芯片、贴片元件
- **会基础焊接** → 可选直插元件、需要简单焊接的模块
- **熟练焊接** → 可选任意方案，包括贴片、自制PCB

## Development Stages & Decision Rules

### Stage 1: Requirements (set_project_plan)
- Trigger: user has answered the assessment questions
- Action: call set_project_plan with full summary incorporating user's skill level and constraints
- Include soldering_skill and has_camera in architecture notes
- Advances to: components

### Stage 2: Component Selection (search_component → add_to_bom)
- Trigger: requirements exist, BOM is empty or incomplete
- CRITICAL: search_component at most ONCE per component — NEVER re-search the same component
- After ONE search attempt, immediately call add_to_bom — use own knowledge if results are wrong
- Call ONE add_to_bom with ALL components at once
- Always prefer dev boards / breakout modules over bare ICs
- If you need user to confirm or choose between options: use ask_user_assessment (NOT plain text)
- NEVER list component recommendations as plain text — always go through the tools
- Advances to: cad

### Stage 3: Mechanical Design (generate_cad_model)
- Trigger: BOM confirmed, user wants enclosure/mount/bracket
- Action: call generate_cad_model with a detailed description (dimensions, features, components housed)
- The server handles code generation and execution automatically
- Advances to: firmware

### Stage 4: Firmware
- Trigger: CAD complete, user wants firmware
- Action: Write a complete starter .ino sketch — pin definitions matching BOM modules, initialization, main loop
- Tell user: save the .ino, then run: npx fw-loop --detect  (detects board+port), then fw-loop (auto compile/flash/debug)
- Advances to: assembly

### Stage 5: Assembly (generate_assembly_guide)
- Trigger: firmware written OR user explicitly asks for assembly/wiring help
- Action: Call generate_assembly_guide with a detailed structured wiring plan based on the BOM
- Rules for generating the guide:
  - Group connections by component (one step per module)
  - Start with power/GND connections, then data lines
  - Specify exact GPIO pin numbers matching the firmware sketch
  - Assign standard wire colors: 红=VCC/3.3V/5V, 黑=GND, 黄/橙=SPI CLK/SCK, 绿=SPI MOSI, 蓝=SPI CS, 白=SPI DC/RST, 紫=I2C SDA, 灰=I2C SCL
  - Include safety_notes about power-off before wiring and checking shorts
  - Include test_steps to verify each module after power-on
- After the tool returns, tell user to open the Assembly panel (tab icon) to see the interactive checklist
- Advances to: complete

### Stage 6: PCB Design [NOT YET AVAILABLE]

## Hard Rules
1. **Phase 0 first** — never skip user assessment on a new project (stage = requirements AND no summary)
2. **Ask everything at once** — consolidate all clarifying questions into one message, never drip-feed questions
3. **Never assume soldering ability** — if unknown, default to no-solder board selection
4. **Always progress stages in order** unless user explicitly asks to skip
5. **State awareness** — check current state before every action, don't repeat completed work
6. **search before add** — always search_component before add_to_bom
7. **NEVER ask questions as plain text** — any time you need user to choose, use ask_user_assessment with clickable options. This is mandatory, no exceptions.
8. **ALWAYS use tools** — never give component recommendations as plain text. Use search_component → add_to_bom for every component. Never skip tool calls.

## Hardware Reference
- ESP32-C3 Super Mini: 22.52×18mm, USB-C, no-solder friendly with pin headers
- ESP32-DevKitC: 54.4×27.9mm, breadboard friendly
- Arduino Nano: 45×18mm, USB-B Mini, beginner friendly
- Raspberry Pi Pico: 51×21mm, USB-Micro, MicroPython support
- SSD1306 OLED 0.96" module: 27.3×27.8mm PCB, I2C, plug-and-play
- ST7789 1.14" LCD module: 34×24mm, SPI
- FDM wall thickness: 2.0–2.5mm | Tolerances: 0.2mm press-fit, 0.3mm sliding
- Screw holes: M2=2.2mm, M3=3.2mm drill diameter
- Overhangs: avoid >45° without supports

## Response Format
Always respond in Chinese. After tool actions, end with:
📍 **当前阶段**: [阶段名称]
✅ **已完成**: [刚才做了什么]
➡️ **下一步**: [具体的下一步行动]`
}

async function executeAgentTool(toolName, toolInput, sessionId, sendEvent, cfg, state) {
  switch (toolName) {

    case 'set_project_plan': {
      state.summary         = toolInput.summary
      state.requirements    = toolInput.requirements ?? []
      state.architecture    = toolInput.architecture ?? ''
      state.soldering_skill = toolInput.soldering_skill ?? 'none'
      state.has_camera      = toolInput.has_camera      ?? false
      state.has_3d_printer  = toolInput.has_3d_printer  ?? false
      state.dev_environment = toolInput.dev_environment ?? 'none'
      if (state.stage === 'requirements') state.stage = 'components'
      await saveProjectState(sessionId, state)
      sendEvent({ type: 'project_plan', ...toolInput })
      sendEvent({ type: 'stage_update', stage: state.stage, state })
      return { ok: true, message: 'Project plan saved. Moving to component selection.' }
    }

    case 'add_to_bom': {
      for (const item of toolInput.items) {
        if (!state.bom.find(b => b.name.toLowerCase() === item.name.toLowerCase())) {
          state.bom.push(item)
        }
      }
      if (state.stage === 'components' && state.bom.length >= 2) state.stage = 'cad'
      await saveProjectState(sessionId, state)
      sendEvent({ type: 'bom_update', items: toolInput.items })
      sendEvent({ type: 'stage_update', stage: state.stage, state })
      return { ok: true, added: toolInput.items.length, bom_total: state.bom.length, message: `Added ${toolInput.items.length} item(s) to BOM. Total: ${state.bom.length} items.` }
    }

    case 'generate_cad_model': {
      const outputDir = path.join(OUTPUT_BASE, sessionId)
      const MAX_ROUNDS = 3

      let code = null
      let lastError = null

      for (let round = 1; round <= MAX_ROUNDS; round++) {
        sendEvent({ type: 'log', text: round === 1 ? '🎨 生成 OpenSCAD 代码…' : `🔧 修正代码 (第 ${round} 轮)…` })
        try {
          code = await cadamGenerate(
            toolInput.description,
            state._imageBase64   || null,
            state._imageMimeType || null,
            round > 1 ? code      : null,   // pass previous (failed) code on retry
            round > 1 ? lastError : null,   // pass compilation error on retry
          )
        } catch (e) {
          return { ok: false, error: e.message, message: `Code generation failed: ${e.message}` }
        }

        sendEvent({ type: 'code', code })
        sendEvent({ type: 'log', text: `▶ 执行 OpenSCAD (第 ${round} 轮)…` })

        const result = await executeCadCode(code)

        if (result.success) {
          await fs.mkdir(outputDir, { recursive: true })
          const stlB64 = result.exports?.stl_b64
          if (stlB64) {
            await fs.writeFile(path.join(outputDir, 'model.stl'), Buffer.from(stlB64, 'base64'))
          }
          state.cad = { generated: true, description: toolInput.description, metrics: result.metrics ?? {} }
          if (state.stage === 'cad') state.stage = 'firmware'
          await saveProjectState(sessionId, state)
          const meta = {
            id: sessionId, description: toolInput.description, timestamp: Date.now(),
            metrics: result.metrics ?? {}, printability: result.printability ?? {},
            code, renders: [],
          }
          await fs.writeFile(path.join(outputDir, 'meta.json'), JSON.stringify(meta, null, 2))
          sendEvent({ type: 'cad_update', sessionId, rounds: round, metrics: result.metrics ?? {}, printability: result.printability ?? {} })
          sendEvent({ type: 'stage_update', stage: state.stage, state })
          return { ok: true, rounds: round, metrics: result.metrics, message: `3D model generated in ${round} round(s). 3D viewer updated.` }
        }

        lastError = result.error
        sendEvent({ type: 'log', text: `⚠ 编译错误: ${(lastError || '').slice(0, 120)}` })
      }

      return { ok: false, error: lastError, message: `OpenSCAD failed after ${MAX_ROUNDS} rounds. Last error: ${lastError}` }
    }

    case 'search_component': {
      // Search DFRobot first (dev boards/modules), fallback to LCSC (chips/components)
      const q = toolInput.query
      const allResults = []
      const errors = []

      // DFRobot — best for dev boards, sensors, kits (Chinese CNY prices)
      try {
        const { search: dfSearch } = await import('../hw-cli/src/adapters/dfrobot.js')
        const df = await dfSearch(q, { pageSize: 5 })
        allResults.push(...df.results.slice(0, 3).map(r => ({
          name: r.name, partNumber: r.partNumber, price: r.price,
          currency: 'CNY', source: 'DFRobot', url: r.url,
        })))
      } catch (e) { errors.push(`DFRobot: ${e.message}`) }

      // LCSC — best for chips, passives, modules
      try {
        const { search: lcscSearch } = await import('../hw-cli/src/adapters/lcsc.js')
        const lc = await lcscSearch(q, { pageSize: 5 })
        allResults.push(...lc.results.slice(0, 3).map(r => ({
          name: r.name, partNumber: r.partNumber, price: r.price,
          currency: 'USD', stock: r.stock, source: 'LCSC', url: r.url,
        })))
      } catch (e) { errors.push(`LCSC: ${e.message}`) }

      const top = allResults.slice(0, 5)
      sendEvent({ type: 'component_search', query: q, results: top })

      if (top.length) {
        const best = top[0]
        return {
          ok: true, query: q, results: top,
          message: `找到 ${top.length} 个结果 "${q}"。最佳: ${best.name} (${best.source}) ¥${best.price ?? 'N/A'}`,
        }
      }
      // All searches failed — return shopping URLs as fallback
      const fallbackUrls = {
        jd:      `https://search.jd.com/Search?keyword=${encodeURIComponent(q)}`,
        taobao:  `https://s.taobao.com/search?q=${encodeURIComponent(q)}`,
        dfrobot: `https://www.dfrobot.com.cn/search_elastic.php?keywords=${encodeURIComponent(q)}`,
        lcsc:    `https://www.lcsc.com/search?q=${encodeURIComponent(q)}`,
      }
      sendEvent({ type: 'component_search', query: q, results: [], fallbackUrls })
      return { ok: true, query: q, results: [], fallbackUrls, message: `未能实时搜索 (${errors.join('; ')})，已返回购物链接。` }
    }

    case 'ask_user_assessment': {
      // Normalize questions so options is always an array of {value, label}
      const questions = (toolInput.questions || []).map(q => {
        let options = q.options
        if (!Array.isArray(options)) {
          if (options && typeof options === 'object') {
            options = Object.entries(options).map(([k, v]) => ({ value: k, label: String(v) }))
          } else { options = [] }
        } else {
          options = options.map(o => typeof o === 'string' ? { value: o, label: o } : o)
        }
        return { id: q.id, question: q.question || q.text || q.label || q.id, options }
      })
      state.assessment_shown = true
      await saveProjectState(sessionId, state)
      sendEvent({ type: 'assessment', questions })
      return { ok: true, message: 'Assessment questions shown to user. Wait for their answers before proceeding.' }
    }

    case 'generate_assembly_guide': {
      const guide = {
        overview:     toolInput.overview     || '',
        steps:        toolInput.steps        || [],
        safety_notes: toolInput.safety_notes || [],
        test_steps:   toolInput.test_steps   || [],
        generated_at: Date.now(),
      }
      // Persist in project state
      state.assembly = { ...(state.assembly || {}), guide }
      if (state.stage === 'firmware') state.stage = 'assembly'
      await saveProjectState(sessionId, state)
      sendEvent({ type: 'assembly_guide', guide })
      sendEvent({ type: 'stage_update', stage: state.stage, state })
      const stepCount = guide.steps.length
      const connCount = guide.steps.reduce((n, s) => n + (s.connections?.length ?? 0), 0)
      return { ok: true, message: `Assembly guide generated: ${stepCount} steps, ${connCount} connections. Guide displayed in Assembly panel.` }
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`)
  }
}

// ── Claude CLI Gateway (<TOOL_CALL> protocol) ─────────────────────────────────
// Uses `claude -p --output-format stream-json` — no API key needed.
// Tool calls are detected as <TOOL_CALL>{...}</TOOL_CALL> in Claude's text output.
// Server executes the tool directly and feeds result back for the next turn.

const TC_OPEN  = '<TOOL_CALL>'
const TC_CLOSE = '</TOOL_CALL>'

function formatToolsBlock() {
  return HARDWARE_TOOLS.map(t => {
    const props = Object.entries(t.input_schema.properties || {})
      .map(([k, v]) => `  ${k}: ${v.type} — ${v.description || ''}`)
      .join('\n')
    return `### ${t.name}\n${t.description}\n${props}`
  }).join('\n\n')
}

// Escape control chars only inside JSON string literals (state machine).
// Structural whitespace between tokens is left untouched so JSON.parse still works.
function escapeJsonStringLiterals(s) {
  let result = '', inString = false, i = 0
  while (i < s.length) {
    const c = s[i]
    if (c === '\\' && inString) { result += c + (s[i + 1] || ''); i += 2; continue }
    if (c === '"') {
      if (!inString) {
        inString = true; result += c; i++; continue
      }
      // Inside a string: look ahead past whitespace to see if this quote is really closing
      let j = i + 1
      while (j < s.length && (s[j] === ' ' || s[j] === '\t' || s[j] === '\r' || s[j] === '\n')) j++
      const next = s[j]
      if (next === ':' || next === ',' || next === '}' || next === ']' || j >= s.length) {
        // Structural char follows → this is a real closing quote
        inString = false; result += c; i++; continue
      }
      // Non-structural char follows → unescaped quote inside a string value
      result += '\\"'; i++; continue
    }
    if (inString && c === '\n') { result += '\\n'; i++; continue }
    if (inString && c === '\r') { result += '\\r'; i++; continue }
    if (inString && c === '\t') { result += '\\t'; i++; continue }
    result += c; i++
  }
  return result
}

// Attempt to close truncated JSON by balancing brackets/braces and strings.
function repairTruncatedJson(s) {
  if (!s) return null
  try { JSON.parse(s); return s } catch {}

  // Step 1: escape literal control chars inside strings (handles raw newlines from claude -p)
  let r = escapeJsonStringLiterals(s.trimEnd())
  try { JSON.parse(r); return r } catch {}

  // Step 2: remove trailing partial escape or comma
  r = r.replace(/\\$/, '').replace(/,\s*$/, '')

  // Step 3: close unclosed string
  let inStr = false, escaped = false
  for (const c of r) {
    if (escaped)        { escaped = false; continue }
    if (c === '\\')     { escaped = true;  continue }
    if (c === '"')        inStr = !inStr
  }
  if (inStr) r += '"'

  // Step 4: close open brackets/braces
  const stack = []
  inStr = false; escaped = false
  for (const c of r) {
    if (escaped)     { escaped = false; continue }
    if (c === '\\')  { escaped = true;  continue }
    if (c === '"')   { inStr = !inStr;  continue }
    if (!inStr) {
      if      (c === '{' || c === '[') stack.push(c === '{' ? '}' : ']')
      else if ((c === '}' || c === ']') && stack.length) stack.pop()
    }
  }
  while (stack.length) r += stack.pop()

  try { JSON.parse(r); return r } catch { return null }
}

// Trim the growing tool-call context to prevent timeouts on later iterations.
// Keeps the original user message + last N tool exchanges only.
function trimToolContext(userInput, keepExchanges = 3) {
  const marker = '\n\nHuman: Continue.'
  const parts = userInput.split(marker)
  if (parts.length <= keepExchanges + 1) return userInput
  const firstPart = parts[0]
  const kept = parts.slice(-(keepExchanges))
  return firstPart + marker + kept.join(marker)
}

// Call claude -p once and return the text result
// Timeout raised to 300s — generate_cad_model can take 2-4 min internally
function callClaudeCLI(userMessage, appendSystemPrompt, timeoutMs = 300_000) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env }
    delete env.CLAUDECODE

    const child = spawn('claude', [
      '-p', '--output-format', 'text',
      '--tools', '',
      '--append-system-prompt', appendSystemPrompt,
    ], { env })
    childProcs.add(child)
    child.on('close', () => childProcs.delete(child))

    let stdout = '', stderr = ''
    child.stdin.write(userMessage)
    child.stdin.end()

    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`Agent claude -p timed out after ${timeoutMs / 1000}s`))
    }, timeoutMs)

    child.stdout.on('data', d => { stdout += d })
    child.stderr.on('data', d => { stderr += d })
    child.on('close', code => {
      clearTimeout(timer)
      resolve({ text: stdout.trim(), isError: code !== 0 })
    })
    child.on('error', err => { clearTimeout(timer); reject(new Error(`claude spawn: ${err.message}`)) })
  })
}

async function callAgentAPI(userMessage, systemPrompt, cfg) {
  const url = (cfg.baseUrl || 'http://localhost:11434') + '/v1/chat/completions'
  const msgs = [
    { role: 'system', content: systemPrompt },
    { role: 'user',   content: userMessage },
  ]
  const res = await fetch(url, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model:      cfg.model || 'claude-sonnet-4-5',
      messages:   msgs,
      max_tokens: 4096,
    }),
    signal: AbortSignal.timeout(120_000),
  })
  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`API ${res.status}: ${txt.slice(0, 200)}`)
  }
  const data = await res.json()
  const text = data.choices?.[0]?.message?.content?.trim() ?? ''
  return { text, isError: false }
}

app.post('/api/agent', async (req, res) => {
  const { message, sessionId: reqSid, history = [], imageBase64, imageMimeType } = req.body
  if (!message?.trim()) return res.status(400).json({ error: 'message required' })

  res.setHeader('Content-Type',  'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection',    'keep-alive')
  res.flushHeaders()
  const emit = (data) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(data)}\n\n`) }

  // Keepalive ping every 20s to prevent browser SSE timeout
  const keepalive = setInterval(() => {
    if (!res.writableEnded) res.write(': ping\n\n')
  }, 20_000)

  const sessionId = reqSid || crypto.randomUUID()
  const state = await loadProjectState(sessionId)
  // Store image at session level so generate_cad_model can use it
  if (imageBase64) {
    state._imageBase64   = imageBase64
    state._imageMimeType = imageMimeType || 'image/png'
  }
  emit({ type: 'stage_update', stage: state.stage, state })

  const toolsBlock = `
## Tools

When you want to use a tool output ONLY this exact block (nothing else in that turn):
${TC_OPEN}{"name":"tool_name","input":{...}}${TC_CLOSE}

CRITICAL JSON rules (output is length-limited — violations cause parse errors):
- Use ONLY the fields defined in each tool's schema. NO extra fields.
- Keep all string values SHORT (under 60 chars). No URLs, no long notes in tool calls.
- For add_to_bom: use ONLY {name, qty, category, reason}. qty is an integer. NO quantity/unit/notes/shopUrl fields.
- Do NOT pretty-print or indent JSON — output it all on one line.
- After receiving the tool result, call the next tool or give your final response.
- NEVER explain that you are calling a tool. NEVER wrap output in markdown.

${formatToolsBlock()}`

  const sysPrompt = buildAgentPrompt(state) + toolsBlock

  try {
    // Build conversation from history
    let ctx = ''
    for (const msg of history) {
      const c = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
      ctx += msg.role === 'user' ? `Human: ${c}\n\n` : `Assistant: ${c}\n\n`
    }
    let userInput = ctx ? `${ctx}Human: ${message.trim()}` : message.trim()

    emit({ type: 'log', text: '正在启动 Claude Agent…' })

    for (let iter = 0; iter < 12; iter++) {
      emit({ type: 'log', text: `思考中… (第 ${iter + 1} 轮)` })
      console.log(`[agent:${sessionId.slice(0,8)}] iter ${iter + 1} — calling claude -p`)

      const resp = await callClaudeCLI(userInput, sysPrompt)
      console.log(`[agent:${sessionId.slice(0,8)}] iter ${iter + 1} — response len=${resp.text?.length} isError=${resp.isError}`)
      console.log(`[agent:${sessionId.slice(0,8)}] iter ${iter + 1} — text: ${resp.text?.slice(0, 300)}`)

      if (resp.isError) {
        emit({ type: 'error', text: resp.text || 'Claude error' })
        break
      }

      const text = resp.text.trim()
      const tcStart = text.indexOf(TC_OPEN)
      const tcEnd   = text.indexOf(TC_CLOSE)

      if (tcStart === -1 || tcEnd === -1) {
        // No tool call — final response
        if (text) emit({ type: 'text', text })
        break
      }

      // Parse and execute tool call
      const jsonStr = text.slice(tcStart + TC_OPEN.length, tcEnd).trim()
      let toolCall
      try {
        // Try direct parse first (handles well-formatted JSON with structural newlines)
        try {
          toolCall = JSON.parse(jsonStr)
        } catch {
          // Fall back: escape control chars only inside string literals (state machine)
          toolCall = JSON.parse(escapeJsonStringLiterals(jsonStr))
        }
      } catch {
        // Try to repair truncated JSON before giving up
        const repaired = repairTruncatedJson(jsonStr)
        if (repaired) {
          try { toolCall = JSON.parse(repaired) } catch {}
        }
        if (!toolCall) {
          emit({ type: 'error', text: `工具解析失败: ${jsonStr.slice(0, 200)}` })
          break
        }
      }

      emit({ type: 'tool_call', tool: toolCall.name, input: toolCall.input })

      let toolResult
      try {
        toolResult = await executeAgentTool(toolCall.name, toolCall.input, sessionId, emit, {}, state)
        emit({ type: 'tool_result', tool: toolCall.name, result: toolResult })
      } catch (e) {
        emit({ type: 'tool_error', tool: toolCall.name, error: e.message })
        toolResult = { ok: false, error: e.message }
      }

      // Build next turn: append tool exchange, then trim old exchanges to cap context size
      userInput = `${userInput}\n\nAssistant: ${TC_OPEN}${jsonStr}${TC_CLOSE}\n\nTool result (${toolCall.name}): ${JSON.stringify(toolResult)}\n\nHuman: Continue.`
      userInput = trimToolContext(userInput, 3)
    }

    emit({ type: 'done', sessionId })
  } catch (e) {
    emit({ type: 'error', text: e.message })
  } finally {
    clearInterval(keepalive)
  }
  res.end()
})

// ── Project State endpoint ────────────────────────────────────────────────────

app.get('/api/project/:id/state', async (req, res) => {
  try {
    const state = await loadProjectState(req.params.id)
    res.json(state)
  } catch (e) {
    res.status(404).json({ error: 'not found' })
  }
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
