/**
 * AI-powered firmware error fixer.
 * Sends code + errors to the configured AI provider and returns fixed code.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { aiPrompt } from '../../cad-skill/src/ai-client.js'

const SYSTEM_PROMPT = `You are an embedded systems expert who fixes Arduino/ESP32 firmware bugs.
When given code and an error message, output ONLY the corrected .ino code — no explanation, no markdown fences, no prose.
Preserve all existing functionality. Only fix what is broken.
Keep all #include, #define, setup(), loop() intact.`

/**
 * Ask AI to fix compile errors.
 * @param {string} code      - current .ino source code
 * @param {string[]} errors  - compiler error lines
 * @param {object} aiOpts    - provider/model/apiKey etc.
 * @returns {Promise<string>} - fixed source code
 */
export async function fixCompileErrors(code, errors, aiOpts = {}) {
  const errorBlock = errors.slice(0, 20).join('\n')
  const prompt =
    `Fix the following Arduino compile errors.\n\n` +
    `ERRORS:\n${errorBlock}\n\n` +
    `CODE:\n${code}\n\n` +
    `Output ONLY the corrected .ino code, nothing else.`

  const fixed = await aiPrompt(prompt, { systemPrompt: SYSTEM_PROMPT, ...aiOpts })
  return extractCode(fixed, code)
}

/**
 * Ask AI to fix a runtime crash / error from serial output.
 * @param {string} code           - current .ino source code
 * @param {string} serialOutput   - captured serial output containing the error
 * @param {object} aiOpts
 * @returns {Promise<string>} - fixed source code
 */
export async function fixRuntimeError(code, serialOutput, aiOpts = {}) {
  // Extract the crash section from serial output (last 50 lines)
  const crashSection = serialOutput.split('\n').slice(-50).join('\n')

  const prompt =
    `An ESP32/Arduino device crashed with the following serial output:\n\n` +
    `SERIAL OUTPUT:\n${crashSection}\n\n` +
    `SOURCE CODE:\n${code}\n\n` +
    `Diagnose the crash and output the fixed .ino code. Output ONLY the code, nothing else.`

  const fixed = await aiPrompt(prompt, { systemPrompt: SYSTEM_PROMPT, ...aiOpts })
  return extractCode(fixed, code)
}

/**
 * Write fixed code back to the .ino file.
 */
export function applyFix(inoFile, fixedCode) {
  writeFileSync(inoFile, fixedCode, 'utf8')
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractCode(response, fallback) {
  if (!response?.trim()) return fallback

  // Strip markdown fences if present
  const fenced = response.match(/```(?:cpp|arduino|ino|c\+\+)?\s*\n?([\s\S]*?)```/)
  if (fenced) return fenced[1].trim()

  // If it looks like code (has #include or setup() or loop()), return as-is
  if (/#include|void\s+setup|void\s+loop/.test(response)) return response.trim()

  return fallback
}
