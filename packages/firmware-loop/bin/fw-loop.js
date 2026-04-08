#!/usr/bin/env node
/**
 * fw-loop CLI — autonomous firmware compile/flash/debug
 *
 * Usage:
 *   fw-loop [sketch-dir]
 *   fw-loop --fqbn esp32:esp32:esp32c3 --port /dev/tty.usbmodem12301 ./my-sketch
 */

import { program } from 'commander'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { FirmwareLoop, autoDetect } from '../src/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(
  createRequire(import.meta.url)('../package.json', { assert: { type: 'json' } }) ??
  '{"version":"0.1.0"}'
)

program
  .name('fw-loop')
  .description('Autonomous firmware compile → flash → monitor → AI-fix loop')
  .version('0.1.0')
  .argument('[sketch-dir]', 'Path to sketch directory (defaults to cwd)')
  .option('--fqbn <fqbn>',       'Board FQBN, e.g. esp32:esp32:esp32c3')
  .option('--port <port>',       'Serial port, e.g. /dev/tty.usbmodem12301')
  .option('--monitor-ms <ms>',   'Serial monitor duration per round (ms)', '10000')
  .option('--provider <name>',   'AI provider: claude-cli | anthropic | gemini | openai', 'claude-cli')
  .option('--model <model>',     'AI model name')
  .option('--api-key <key>',     'API key for the AI provider')
  .option('--compile-only',      'Only compile, do not flash or monitor')
  .option('--detect',            'Just detect board info and exit')
  .parse()

const opts      = program.opts()
const sketchDir = path.resolve(program.args[0] || process.cwd())

if (opts.detect) {
  const info = autoDetect(sketchDir)
  console.log('\nBoard detection:')
  console.log(`  .ino file  : ${info.inoFile ?? '(not found)'}`)
  console.log(`  FQBN       : ${info.fqbn    ?? '(not detected — use --fqbn)'}`)
  console.log(`  Port       : ${info.port    ?? '(not connected)'}`)
  console.log(`  Board name : ${info.boardName ?? '(unknown)'}`)
  process.exit(0)
}

const loop = new FirmwareLoop({
  sketchDir,
  fqbn:      opts.fqbn  || undefined,
  port:      opts.port  || undefined,
  monitorMs: parseInt(opts.monitorMs, 10),
  aiOpts: {
    provider: opts.provider,
    model:    opts.model   || undefined,
    apiKey:   opts.apiKey  || process.env.AI_API_KEY || process.env.ANTHROPIC_API_KEY || undefined,
  },
  onLog: msg => console.log(msg),
})

// If compile-only, monkey-patch to skip flash+monitor
if (opts.compileOnly) {
  loop._port = null
}

const result = await loop.run()
process.exit(result.success ? 0 : 1)
