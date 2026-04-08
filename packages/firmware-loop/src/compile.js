/**
 * Compile an Arduino sketch using arduino-cli.
 */

import { spawnSync } from 'node:child_process'

const COMPILE_TIMEOUT = 120_000  // 2 min

/**
 * @param {string} sketchDir  - absolute path to sketch folder (containing .ino)
 * @param {string} fqbn       - fully qualified board name, e.g. 'esp32:esp32:esp32c3'
 * @param {object} opts
 * @param {boolean} [opts.verbose]
 * @returns {{ success: boolean, output: string, errors: string[], warnings: string[] }}
 */
export function compile(sketchDir, fqbn, { verbose = false } = {}) {
  const args = ['compile', '--fqbn', fqbn]
  if (verbose) args.push('--verbose')
  args.push(sketchDir)

  const result = spawnSync('arduino-cli', args, {
    encoding: 'utf8',
    timeout: COMPILE_TIMEOUT,
    cwd: sketchDir,
  })

  if (result.error) {
    return {
      success: false,
      output: '',
      errors: [`Failed to run arduino-cli: ${result.error.message}. Is arduino-cli installed?`],
      warnings: [],
    }
  }

  const stdout = result.stdout || ''
  const stderr = result.stderr || ''
  const output = stdout + stderr
  const success = result.status === 0

  return {
    success,
    output,
    errors: parseErrors(output),
    warnings: parseWarnings(output),
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseErrors(output) {
  const errors = []
  for (const line of output.split('\n')) {
    // e.g.: sketch.ino:42:5: error: 'xyz' was not declared in this scope
    if (/:\s*error:/.test(line) || /^Error\b/.test(line.trim())) {
      const clean = line.trim()
      if (clean && !errors.includes(clean)) errors.push(clean)
    }
  }
  return errors
}

function parseWarnings(output) {
  const warnings = []
  for (const line of output.split('\n')) {
    if (/:\s*warning:/.test(line)) {
      const clean = line.trim()
      if (clean && !warnings.includes(clean)) warnings.push(clean)
    }
  }
  return warnings
}
