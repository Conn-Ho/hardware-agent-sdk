/**
 * Flash compiled firmware to a board using arduino-cli upload.
 */

import { spawnSync } from 'node:child_process'

const FLASH_TIMEOUT = 60_000  // 1 min

/**
 * @param {string} sketchDir  - path to sketch folder
 * @param {string} fqbn       - board FQBN
 * @param {string} port       - serial port, e.g. '/dev/tty.usbmodem12301'
 * @param {object} opts
 * @param {boolean} [opts.verbose]
 * @returns {{ success: boolean, output: string, error?: string }}
 */
export function flash(sketchDir, fqbn, port, { verbose = false } = {}) {
  const args = ['upload', '--fqbn', fqbn, '--port', port]
  if (verbose) args.push('--verbose')
  args.push(sketchDir)

  const result = spawnSync('arduino-cli', args, {
    encoding: 'utf8',
    timeout: FLASH_TIMEOUT,
    cwd: sketchDir,
  })

  if (result.error) {
    return { success: false, output: '', error: `Failed to run arduino-cli: ${result.error.message}` }
  }

  const output = (result.stdout || '') + (result.stderr || '')
  const success = result.status === 0

  if (!success) {
    // Extract first meaningful error line
    const errLine = output.split('\n').find(l => /error|fail|not found/i.test(l))
    return { success: false, output, error: errLine?.trim() || output.slice(-200).trim() }
  }

  return { success: true, output }
}
