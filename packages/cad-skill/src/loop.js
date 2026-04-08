/**
 * CAD generation feedback loop using claude -p CLI (no API key needed).
 *
 * Flow:
 *   1. Generate Build123d Python code from description
 *   2. Execute in Docker → get metrics + renders + printability + STL
 *   3. On error → ask claude to fix → retry (up to MAX_ROUNDS)
 *   4. On success → save renders to outputDir, return code + result
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { aiPrompt } from './ai-client.js'
import { CODE_GEN_PROMPT } from './prompts.js'
import { executeCadCode } from './executor.js'

const MAX_CORRECTION_ROUNDS = 4

/**
 * Extract pure OpenSCAD code from an LLM response.
 *
 * Priority:
 *  1. Content inside the first ```openscad … ``` or ``` … ``` fence
 *  2. Lines from the first OpenSCAD-looking line onward
 */
function extractOpenSCADCode(raw) {
  if (!raw) return ''

  // Strategy 1 — fenced code block
  const fenced = raw.match(/```(?:openscad|scad)?\s*\n?([\s\S]*?)```/)
  if (fenced) return fenced[1].trim()

  // Strategy 2 — strip leading prose, find first code line
  // OpenSCAD lines typically start with: //, variable=, module, function, cube, cylinder, difference, union, translate, rotate, etc.
  const lines = raw.split('\n')
  const codeStart = /^(\/\/|[a-zA-Z_$][a-zA-Z0-9_$]*\s*[=(]|difference|union|intersection|translate|rotate|scale|mirror|module|function|\$fn)/
  const start = lines.findIndex(l => codeStart.test(l.trim()))
  if (start !== -1) return lines.slice(start).join('\n').trim()

  // Fallback
  return raw.replace(/^```\w*\s*/m, '').replace(/```\s*$/m, '').trim()
}

export class CadLoop {
  constructor({ outputDir = './output', verbose = false, model, provider, baseUrl, apiKey, onProgress, onCode } = {}) {
    this.outputDir = outputDir
    this.verbose = verbose
    this.aiOpts = { model, provider, baseUrl, apiKey }
    this.onProgress = onProgress ?? (() => {})
    this.onCode     = onCode     ?? (() => {})
    this.currentCode = null
    this._lastResult = null   // cached last successful executor result
  }

  // ── Code generation ──────────────────────────────────────────────────────

  async generateCode(prompt, existingCode = null, imageBase64 = null, imageMimeType = null) {
    this.onProgress(existingCode ? 'Refining code...' : 'Generating Build123d code...')

    const fullPrompt = existingCode
      ? `Modify this OpenSCAD code:\n${existingCode}\n\nChange required: ${prompt}\n\nOutput only the modified OpenSCAD code, no explanation.`
      : prompt

    const raw = await aiPrompt(fullPrompt, {
      systemPrompt: CODE_GEN_PROMPT,
      ...this.aiOpts,
      ...(imageBase64 ? { imageBase64, imageMimeType: imageMimeType || 'image/png' } : {}),
    })

    const code = extractOpenSCADCode(raw)

    this.onCode(code)
    return code
  }

  // ── Save renders from base64 to disk ────────────────────────────────────

  async saveRenders(renders, prefix = 'model') {
    if (!renders || typeof renders !== 'object' || renders.error) return {}
    await fs.mkdir(this.outputDir, { recursive: true })
    const paths = {}
    for (const [view, b64] of Object.entries(renders)) {
      const filePath = path.join(this.outputDir, `${prefix}_${view}.png`)
      await fs.writeFile(filePath, Buffer.from(b64, 'base64'))
      paths[view] = filePath
    }
    return paths
  }

  // ── Inner correction loop ────────────────────────────────────────────────

  async executeWithCorrection(initialCode) {
    let code = initialCode

    for (let round = 0; round < MAX_CORRECTION_ROUNDS; round++) {
      this.onProgress(`Executing in Docker (round ${round + 1}/${MAX_CORRECTION_ROUNDS})...`)
      if (this.verbose) process.stderr.write(`  [exec round ${round + 1}/${MAX_CORRECTION_ROUNDS}] `)

      const result = await executeCadCode(code)

      if (result.success) {
        if (this.verbose) process.stderr.write('✓\n')
        this.currentCode = code
        this._lastResult = result   // cache for export()

        const renderPaths = await this.saveRenders(result.renders)
        return { code, result, rounds: round + 1, renderPaths }
      }

      const errMsg = `${result.error ?? 'unknown error'}\n${result.traceback ?? ''}`.trim()
      if (this.verbose) process.stderr.write(`✗ ${errMsg.slice(0, 80)}\n`)

      if (round === MAX_CORRECTION_ROUNDS - 1) {
        return { code, result, rounds: round + 1, renderPaths: {} }
      }

      this.onProgress(`Execution failed — asking Claude to fix (round ${round + 1})...`)

      const fixPrompt =
        `Fix this OpenSCAD code. Output ONLY the corrected OpenSCAD — no explanation, no prose, no markdown fences.\n\n` +
        `Error:\n${errMsg.slice(0, 1000)}\n\n` +
        `Code:\n${code}`

      code = await this.generateCode(fixPrompt)
    }
  }

  // ── Generate + execute ───────────────────────────────────────────────────

  async generate(description, imageBase64 = null, imageMimeType = null) {
    if (this.verbose) process.stderr.write(`Generating code for: ${description.slice(0, 80)}...\n`)
    const code = await this.generateCode(description, null, imageBase64, imageMimeType)
    return this.executeWithCorrection(code)
  }

  // ── Refine existing model ────────────────────────────────────────────────

  async refine(changes) {
    if (!this.currentCode) throw new Error('No current model. Call generate() first.')
    if (this.verbose) process.stderr.write(`Refining: ${changes.slice(0, 80)}...\n`)
    const code = await this.generateCode(changes, this.currentCode)
    return this.executeWithCorrection(code)
  }

  // ── Export ────────────────────────────────────────────────────────────────

  async export(format = 'stl', filename = 'model') {
    if (!this.currentCode) throw new Error('No current model. Call generate() first.')

    // Use cached result to avoid re-executing
    let result = this._lastResult
    if (!result?.success) {
      result = await executeCadCode(this.currentCode)
      if (!result.success) throw new Error(`Re-execution failed: ${result.error}`)
    }

    await fs.mkdir(this.outputDir, { recursive: true })
    const outPath = path.join(this.outputDir, `${filename}.${format}`)

    const b64 = result.exports?.[`${format}_b64`]
    if (!b64) throw new Error(`Format ${format} not available in executor output`)

    await fs.writeFile(outPath, Buffer.from(b64, 'base64'))
    return outPath
  }
}
