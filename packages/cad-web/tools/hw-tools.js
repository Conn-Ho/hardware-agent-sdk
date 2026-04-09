#!/usr/bin/env node
/**
 * Hardware Agent CLI Tools
 * Called by Claude Code via Bash tool during the agent loop.
 *
 * Usage:
 *   SESSION_ID=<id> OUTPUT_BASE=<path> node hw-tools.js <tool> '<json-input>'
 *
 * Returns JSON to stdout.
 */

import fs   from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname   = path.dirname(fileURLToPath(import.meta.url))
const SESSION_ID  = process.env.SESSION_ID
const OUTPUT_BASE = process.env.OUTPUT_BASE || path.join(__dirname, '..', 'output')

if (!SESSION_ID) { console.log(JSON.stringify({ ok: false, error: 'SESSION_ID not set' })); process.exit(1) }

const STATE_FILE  = path.join(OUTPUT_BASE, SESSION_ID, 'project-state.json')

async function readState() {
  try { return JSON.parse(await fs.readFile(STATE_FILE, 'utf8')) }
  catch { return { stage: 'requirements', summary: '', requirements: [], architecture: '', bom: [], cad: { generated: false }, firmware: { generated: false } } }
}

async function writeState(state) {
  await fs.mkdir(path.dirname(STATE_FILE), { recursive: true })
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2))
}

const [,, toolName, jsonArg] = process.argv
let input
try { input = JSON.parse(jsonArg || '{}') }
catch { console.log(JSON.stringify({ ok: false, error: `Invalid JSON: ${jsonArg}` })); process.exit(1) }

async function main() {
  switch (toolName) {

    case 'set_project_plan': {
      const state = await readState()
      state.summary      = input.summary      || state.summary
      state.requirements = input.requirements || state.requirements
      state.architecture = input.architecture || state.architecture
      if (state.stage === 'requirements') state.stage = 'components'
      await writeState(state)
      console.log(JSON.stringify({
        ok: true, stage: state.stage,
        message: `Project plan saved. Stage → ${state.stage}`,
        summary: state.summary, requirements: state.requirements,
      }))
      break
    }

    case 'add_to_bom': {
      const state = await readState()
      const added = []
      for (const item of (input.items || [])) {
        if (!state.bom.find(b => b.name.toLowerCase() === item.name.toLowerCase())) {
          state.bom.push(item); added.push(item.name)
        }
      }
      if (state.stage === 'components' && state.bom.length >= 2) state.stage = 'cad'
      await writeState(state)
      console.log(JSON.stringify({
        ok: true, stage: state.stage, added, bom_total: state.bom.length,
        message: `Added ${added.length} item(s) to BOM (total: ${state.bom.length}). Stage → ${state.stage}`,
        bom: state.bom,
      }))
      break
    }

    case 'search_component': {
      try {
        const { search } = await import('../../hw-cli/src/adapters/lcsc.js')
        const result = await search(input.query, { pageSize: 5 })
        const top = result.results.slice(0, 3).map(r => ({
          name: r.name, partNumber: r.partNumber,
          price: r.price, stock: r.stock, package: r.package,
        }))
        console.log(JSON.stringify({
          ok: true, query: input.query, results: top,
          message: top.length
            ? `Found ${top.length} results. Top: ${top[0].name} (${top[0].partNumber}) ¥${top[0].price ?? 'N/A'}`
            : `No results for "${input.query}"`,
        }))
      } catch (e) {
        console.log(JSON.stringify({
          ok: true, query: input.query, results: [],
          message: `Search unavailable: ${e.message}. Try LCSC manually.`,
        }))
      }
      break
    }

    case 'generate_cad_model': {
      // CAD generation is heavy — call the cad-skill loop
      try {
        const { CadLoop } = await import('../../cad-skill/src/index.js')
        const aiCfgFile = path.join(__dirname, '..', 'ai-config.json')
        let aiCfg = {}
        try { aiCfg = JSON.parse(await fs.readFile(aiCfgFile, 'utf8')) } catch {}

        const outputDir = path.join(OUTPUT_BASE, SESSION_ID)
        const loop = new CadLoop({
          outputDir, verbose: false,
          provider: aiCfg.provider, model: aiCfg.model,
          baseUrl: aiCfg.baseUrl, apiKey: aiCfg.apiKey,
          onProgress: (msg) => process.stderr.write(`[CAD] ${msg}\n`),
          onCode:     () => {},
        })
        const { code, result, rounds } = await loop.generate(input.description)
        if (result.success) {
          try { await loop.export('stl', 'model') } catch {}
          // Update project state
          const state = await readState()
          state.cad = { generated: true, description: input.description, metrics: result.metrics ?? {} }
          if (state.stage === 'cad') state.stage = 'firmware'
          await writeState(state)
          // Save meta for UI
          const meta = {
            id: SESSION_ID, description: input.description, timestamp: Date.now(),
            metrics: result.metrics ?? {}, printability: result.printability ?? {},
            code: code ?? '', renders: [],
          }
          await fs.mkdir(outputDir, { recursive: true })
          await fs.writeFile(path.join(outputDir, 'meta.json'), JSON.stringify(meta, null, 2))
          console.log(JSON.stringify({
            ok: true, sessionId: SESSION_ID, rounds,
            metrics: result.metrics, stage: state.stage,
            message: `3D model generated in ${rounds} round(s). SessionId: ${SESSION_ID}`,
          }))
        } else {
          console.log(JSON.stringify({ ok: false, error: result.error, message: `CAD failed: ${result.error}` }))
        }
      } catch (e) {
        console.log(JSON.stringify({ ok: false, error: e.message }))
      }
      break
    }

    default:
      console.log(JSON.stringify({ ok: false, error: `Unknown tool: ${toolName}` }))
  }
}

main().catch(e => { console.log(JSON.stringify({ ok: false, error: e.message })); process.exit(1) })
