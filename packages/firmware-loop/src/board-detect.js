/**
 * Board detection — reads .ino file for board hints, queries arduino-cli for connected boards.
 */

import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

// Map friendly board names → arduino-cli FQBN
const BOARD_FQBN_MAP = {
  'esp32-c3 super mini':  'esp32:esp32:esp32c3',
  'esp32-c3':             'esp32:esp32:esp32c3',
  'esp32 devkit':         'esp32:esp32:esp32dev',
  'esp32 dev':            'esp32:esp32:esp32dev',
  'esp32':                'esp32:esp32:esp32dev',
  'esp8266':              'esp8266:esp8266:generic',
  'nodemcu':              'esp8266:esp8266:nodemcuv2',
  'arduino nano':         'arduino:avr:nano',
  'arduino uno':          'arduino:avr:uno',
  'arduino mega':         'arduino:avr:mega',
  'arduino pro mini':     'arduino:avr:pro',
  'raspberry pi pico':    'rp2040:rp2040:rpipico',
  'rp2040':               'rp2040:rp2040:rpipico',
  'seeed xiao esp32c3':   'esp32:esp32:XIAO_ESP32C3',
  'seeed xiao':           'esp32:esp32:XIAO_ESP32C3',
}

/**
 * Extract board hint from .ino file comments.
 * Looks for: // Board: ESP32-C3 Super Mini
 */
export function detectBoardFromCode(code) {
  const match = code.match(/\/\/\s*[Bb]oard\s*:\s*(.+)/m)
  if (!match) return null
  const hint = match[1].trim().toLowerCase()
  for (const [key, fqbn] of Object.entries(BOARD_FQBN_MAP)) {
    if (hint.includes(key)) return { name: match[1].trim(), fqbn }
  }
  return { name: match[1].trim(), fqbn: null }
}

/**
 * List connected boards via arduino-cli board list.
 * Returns [{ address, fqbn, name }]
 */
export function listConnectedBoards() {
  const r = spawnSync('arduino-cli', ['board', 'list', '--format', 'json'], { encoding: 'utf8', timeout: 10_000 })
  if (r.status !== 0) return []
  try {
    const data = JSON.parse(r.stdout || '[]')
    const boards = []
    for (const item of (Array.isArray(data) ? data : data.detected_ports ?? [])) {
      const port   = item.port?.address || item.address || ''
      const boards2 = item.matching_boards || item.boards || []
      if (boards2.length > 0) {
        for (const b of boards2) {
          boards.push({ address: port, fqbn: b.fqbn || '', name: b.name || '' })
        }
      } else if (port) {
        // Port found but board not identified (might still be flashable)
        boards.push({ address: port, fqbn: '', name: 'Unknown' })
      }
    }
    return boards
  } catch { return [] }
}

/**
 * Find all .ino files under a directory (non-recursive, or in a sketch folder).
 */
export function findSketch(dir) {
  try {
    const entries = readdirSync(dir)
    // First look for .ino directly in dir
    for (const e of entries) {
      if (e.endsWith('.ino')) return path.join(dir, e)
    }
    // Then look one level deep
    for (const e of entries) {
      const sub = path.join(dir, e)
      if (statSync(sub).isDirectory()) {
        try {
          for (const f of readdirSync(sub)) {
            if (f.endsWith('.ino')) return path.join(sub, f)
          }
        } catch {}
      }
    }
  } catch {}
  return null
}

/**
 * Auto-detect everything needed to compile/flash.
 * Returns { inoFile, sketchDir, fqbn, port, boardName }
 */
export function autoDetect(startDir = process.cwd()) {
  const inoFile = findSketch(startDir)
  const sketchDir = inoFile ? path.dirname(inoFile) : startDir

  let fqbn = null
  let boardName = null

  // Try to read board from .ino source
  if (inoFile) {
    try {
      const code = readFileSync(inoFile, 'utf8')
      const detected = detectBoardFromCode(code)
      if (detected?.fqbn) { fqbn = detected.fqbn; boardName = detected.name }
    } catch {}
  }

  // Try connected boards
  const connected = listConnectedBoards()
  const port = connected[0]?.address || null
  if (!fqbn && connected[0]?.fqbn) {
    fqbn = connected[0].fqbn
    boardName = connected[0].name
  }

  return { inoFile, sketchDir, fqbn, port, boardName }
}
