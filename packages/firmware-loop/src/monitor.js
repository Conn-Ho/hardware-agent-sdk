/**
 * Serial monitor — captures serial output from a connected board for N seconds.
 * Uses arduino-cli monitor as subprocess with a kill timeout.
 */

import { spawn } from 'node:child_process'

const DEFAULT_BAUD = 115200
const DEFAULT_DURATION = 10_000  // 10 seconds

// Patterns that indicate a runtime error / crash
const ERROR_PATTERNS = [
  /Guru Meditation Error/i,
  /LoadProhibited|StoreProhibited|InstrFetchProhibited/i,
  /Backtrace:/i,
  /abort\(\) was called/i,
  /assert failed/i,
  /Exception \(\d+\):/i,
  /ets Jun  8 2016.*rst:/i,   // ESP8266 boot loop
  /Fatal exception \d+/i,
  /Stack smashing detect/i,
  /DRAM .*IRAM .* stack/i,
]

/**
 * Capture serial output from a port.
 * @param {string} port          - e.g. '/dev/tty.usbmodem12301'
 * @param {number} durationMs    - how long to listen (default 10s)
 * @param {number} [baud]        - baud rate (default 115200)
 * @returns {Promise<{ output: string, lines: string[], errorPatterns: string[] }>}
 */
export function monitorSerial(port, durationMs = DEFAULT_DURATION, baud = DEFAULT_BAUD) {
  return new Promise(resolve => {
    const args = [
      'monitor',
      '--port', port,
      '--config', `baudrate=${baud}`,
      '--quiet',
    ]

    const child = spawn('arduino-cli', args, { encoding: 'utf8' })

    let output = ''
    const lines = []

    child.stdout.on('data', d => {
      const text = d.toString()
      output += text
      lines.push(...text.split('\n').filter(l => l.trim()))
    })

    child.stderr.on('data', d => {
      output += d.toString()
    })

    const timer = setTimeout(() => {
      child.kill('SIGTERM')
    }, durationMs)

    child.on('close', () => {
      clearTimeout(timer)
      const errorPatterns = findErrorPatterns(output)
      resolve({ output, lines, errorPatterns })
    })

    child.on('error', err => {
      clearTimeout(timer)
      resolve({
        output: `Monitor failed: ${err.message}`,
        lines: [],
        errorPatterns: [`Monitor failed: ${err.message}`],
      })
    })
  })
}

function findErrorPatterns(output) {
  const found = []
  for (const pattern of ERROR_PATTERNS) {
    const match = output.match(pattern)
    if (match) found.push(match[0])
  }
  return found
}
