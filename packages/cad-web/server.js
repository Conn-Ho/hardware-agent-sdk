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
    name: 'ask_user_assessment',
    description: 'Show the user an interactive questionnaire with clickable options. Use this at the start of EVERY new project to collect: soldering skill, camera availability, 3D printer access, dev environment preference, and project-specific details. DO NOT ask questions as plain text — always use this tool.',
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
- Action: search then add — respect the soldering skill level when choosing parts
- Always prefer dev boards / breakout modules over bare ICs
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

### Stage 5: Assembly
- Trigger: firmware flashed, user wants assembly help
- Action: List step-by-step assembly order, reference 3D viewer for enclosure fit
- Tell user: open /viewer.html?id=<sessionId> for interactive 3D view
- Advances to: complete

### Stage 6: PCB Design [NOT YET AVAILABLE]

## Hard Rules
1. **Phase 0 first** — never skip user assessment on a new project (stage = requirements AND no summary)
2. **Ask everything at once** — consolidate all clarifying questions into one message, never drip-feed questions
3. **Never assume soldering ability** — if unknown, default to no-solder board selection
4. **Always progress stages in order** unless user explicitly asks to skip
5. **State awareness** — check current state before every action, don't repeat completed work
6. **search before add** — always search_component before add_to_bom

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

      // Step 1: Dedicated, fresh-context code generation (no agent history = fast)
      sendEvent({ type: 'log', text: '🎨 生成 OpenSCAD 代码…' })
      const { aiPrompt } = await import('../cad-skill/src/ai-client.js')
      const { CODE_GEN_PROMPT } = await import('../cad-skill/src/prompts.js')
      const mainCfg = await readAiConfig()
      let code
      try {
        code = await aiPrompt(toolInput.description, {
          systemPrompt: CODE_GEN_PROMPT,
          provider:     mainCfg.provider,
          model:        mainCfg.model,
          baseUrl:      mainCfg.baseUrl,
          apiKey:       mainCfg.apiKey,
          imageBase64:  state._imageBase64   || undefined,
          imageMimeType: state._imageMimeType || undefined,
        })
        // Strip markdown fences if model wrapped it
        code = code.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim()
      } catch (e) {
        return { ok: false, error: e.message, message: `Code generation failed: ${e.message}` }
      }

      sendEvent({ type: 'code', code })
      sendEvent({ type: 'log', text: '▶ 执行 OpenSCAD…' })

      const result = await executeCadCode(code)

      if (result.success) {
        await fs.mkdir(outputDir, { recursive: true })
        // Save STL
        const stlB64 = result.exports?.stl_b64
        if (stlB64) {
          await fs.writeFile(path.join(outputDir, 'model.stl'), Buffer.from(stlB64, 'base64'))
        }
        // Save renders
        const renderPaths = {}
        for (const [view, b64] of Object.entries(result.renders || {})) {
          if (typeof b64 !== 'string') continue
          const fp = path.join(outputDir, `model_${view}.png`)
          await fs.writeFile(fp, Buffer.from(b64, 'base64'))
          renderPaths[view] = fp
        }
        // Update project state
        state.cad = { generated: true, description: toolInput.description, metrics: result.metrics ?? {} }
        if (state.stage === 'cad') state.stage = 'firmware'
        await saveProjectState(sessionId, state)
        // Save meta
        const meta = {
          id: sessionId, description: toolInput.description, timestamp: Date.now(),
          metrics: result.metrics ?? {}, printability: result.printability ?? {},
          code, renders: Object.keys(renderPaths),
        }
        await fs.writeFile(path.join(outputDir, 'meta.json'), JSON.stringify(meta, null, 2))
        sendEvent({ type: 'cad_update', sessionId, rounds: 1, metrics: result.metrics ?? {}, printability: result.printability ?? {}, renderViews: Object.keys(renderPaths) })
        sendEvent({ type: 'stage_update', stage: state.stage, state })
        return { ok: true, metrics: result.metrics, message: `3D model executed successfully. 3D viewer updated.` }
      }
      // On error, tell the agent what went wrong so it can fix the code
      return { ok: false, error: result.error, message: `OpenSCAD error: ${result.error}\nFix the code and call generate_cad_model again with corrected code.` }
    }

    case 'search_component': {
      // Use real LCSC API
      try {
        const { search } = await import('../hw-cli/src/adapters/lcsc.js')
        const result = await search(toolInput.query, { pageSize: 5 })
        const top = result.results.slice(0, 3).map(r => ({
          name: r.name,
          partNumber: r.partNumber,
          price: r.price,
          stock: r.stock,
          package: r.package,
          url: r.url,
        }))
        sendEvent({ type: 'component_search', query: toolInput.query, results: top })
        return {
          ok: true,
          query: toolInput.query,
          results: top,
          message: top.length
            ? `Found ${top.length} results for "${toolInput.query}". Top: ${top[0].name} (${top[0].partNumber}) $${top[0].price ?? 'N/A'}`
            : `No results found for "${toolInput.query}" on LCSC.`
        }
      } catch (e) {
        const url = `https://www.lcsc.com/search?q=${encodeURIComponent(toolInput.query)}`
        sendEvent({ type: 'lcsc_search', query: toolInput.query, url })
        return { ok: true, lcsc_url: url, message: `LCSC search URL generated (live search unavailable: ${e.message})` }
      }
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
      '-p', '--output-format', 'stream-json', '--verbose',
      '--append-system-prompt', appendSystemPrompt,
    ], { env })
    childProcs.add(child)
    child.on('close', () => childProcs.delete(child))

    const events = []
    let buf = ''
    child.stdin.write(userMessage)
    child.stdin.end()

    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`Agent claude -p timed out after ${timeoutMs / 1000}s`))
    }, timeoutMs)

    child.stdout.on('data', d => {
      buf += d.toString()
      const lines = buf.split('\n'); buf = lines.pop()
      for (const line of lines) {
        if (!line.trim()) continue
        try { events.push(JSON.parse(line)) } catch {}
      }
    })
    child.on('close', () => {
      clearTimeout(timer)
      const resultEvt = events.find(e => e.type === 'result')
      resolve({
        text:    resultEvt?.result ?? '',
        isError: resultEvt?.is_error ?? false,
      })
    })
    child.on('error', err => { clearTimeout(timer); reject(new Error(`claude spawn: ${err.message}`)) })
  })
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

When you want to use a tool output ONLY this block (nothing else in that turn):
${TC_OPEN}{"name":"tool_name","input":{...}}${TC_CLOSE}

After receiving the tool result, call the next tool or give your final response.
NEVER explain that you are calling a tool. NEVER wrap output in markdown.

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
      try { toolCall = JSON.parse(jsonStr) }
      catch { emit({ type: 'error', text: `工具解析失败: ${jsonStr.slice(0, 100)}` }); break }

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
