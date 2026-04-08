/**
 * FirmwareLoop — autonomous compile → flash → monitor → AI-fix loop.
 *
 * Flow:
 *   1. Detect .ino file, board FQBN, serial port
 *   2. Compile  →  if error, AI fix → retry  (up to MAX_COMPILE)
 *   3. Flash    →  if error, report  (up to MAX_FLASH)
 *   4. Monitor  →  if crash, AI fix → recompile → reflash  (up to MAX_MONITOR)
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { autoDetect } from './board-detect.js'
import { compile } from './compile.js'
import { flash } from './flash.js'
import { monitorSerial } from './monitor.js'
import { fixCompileErrors, fixRuntimeError, applyFix } from './auto-fix.js'

const MAX_COMPILE  = 10
const MAX_FLASH    = 3
const MAX_MONITOR  = 5

export { autoDetect } from './board-detect.js'
export { compile }    from './compile.js'
export { flash }      from './flash.js'
export { monitorSerial } from './monitor.js'

export class FirmwareLoop {
  /**
   * @param {object} opts
   * @param {string}   [opts.sketchDir]   - path to sketch dir (defaults to cwd)
   * @param {string}   [opts.inoFile]     - explicit .ino path (auto-detected if not set)
   * @param {string}   [opts.fqbn]        - board FQBN (auto-detected if not set)
   * @param {string}   [opts.port]        - serial port (auto-detected if not set)
   * @param {number}   [opts.monitorMs]   - serial capture duration per round (default 10s)
   * @param {object}   [opts.aiOpts]      - ai-client options (provider, model, apiKey…)
   * @param {function} [opts.onLog]       - callback(msg) for progress messages
   */
  constructor({
    sketchDir,
    inoFile,
    fqbn,
    port,
    monitorMs = 10_000,
    aiOpts    = {},
    onLog     = console.log,
  } = {}) {
    this.sketchDir = sketchDir || process.cwd()
    this._inoFile  = inoFile  || null
    this._fqbn     = fqbn     || null
    this._port     = port     || null
    this.monitorMs = monitorMs
    this.aiOpts    = aiOpts
    this.onLog     = onLog
  }

  log(msg) { this.onLog(msg) }

  // ── Auto-detect board info ─────────────────────────────────────────────────

  detect() {
    if (this._inoFile && this._fqbn) {
      return { inoFile: this._inoFile, sketchDir: this.sketchDir, fqbn: this._fqbn, port: this._port, boardName: '' }
    }
    const detected = autoDetect(this.sketchDir)
    return {
      inoFile:    this._inoFile  || detected.inoFile,
      sketchDir:  detected.sketchDir || this.sketchDir,
      fqbn:       this._fqbn    || detected.fqbn,
      port:       this._port    || detected.port,
      boardName:  detected.boardName,
    }
  }

  // ── Compile loop ───────────────────────────────────────────────────────────

  async compileLoop(sketchDir, fqbn, inoFile) {
    for (let round = 1; round <= MAX_COMPILE; round++) {
      this.log(`[编译 ${round}/${MAX_COMPILE}] 编译中…`)
      const result = compile(sketchDir, fqbn)

      if (result.success) {
        this.log(`✅ 编译成功`)
        return { success: true, rounds: round }
      }

      this.log(`❌ 编译失败 (${result.errors.length} 个错误)`)
      for (const e of result.errors.slice(0, 5)) this.log(`   ${e}`)

      if (round === MAX_COMPILE) {
        this.log(`❌ 达到最大编译次数 (${MAX_COMPILE})，停止`)
        return { success: false, rounds: round, errors: result.errors }
      }

      this.log(`🤖 AI 修复中…`)
      try {
        const code    = readFileSync(inoFile, 'utf8')
        const fixed   = await fixCompileErrors(code, result.errors, this.aiOpts)
        writeFileSync(inoFile, fixed, 'utf8')
        this.log(`💾 已应用 AI 修复，重新编译`)
      } catch (e) {
        this.log(`⚠️ AI 修复失败: ${e.message}`)
        return { success: false, rounds: round, errors: result.errors }
      }
    }
  }

  // ── Flash loop ─────────────────────────────────────────────────────────────

  async flashLoop(sketchDir, fqbn, port) {
    for (let round = 1; round <= MAX_FLASH; round++) {
      this.log(`[烧录 ${round}/${MAX_FLASH}] 烧录到 ${port}…`)
      const result = flash(sketchDir, fqbn, port)

      if (result.success) {
        this.log(`✅ 烧录成功`)
        return { success: true, rounds: round }
      }

      this.log(`❌ 烧录失败: ${result.error || ''}`)

      if (round === MAX_FLASH) {
        this.log(`❌ 达到最大烧录次数 (${MAX_FLASH})，停止`)
        return { success: false, rounds: round, error: result.error }
      }

      this.log(`⏳ 等待 3 秒后重试…`)
      await sleep(3000)
    }
  }

  // ── Monitor + runtime fix loop ─────────────────────────────────────────────

  async monitorLoop(sketchDir, fqbn, port, inoFile) {
    for (let round = 1; round <= MAX_MONITOR; round++) {
      this.log(`[监控 ${round}/${MAX_MONITOR}] 读取串口 ${this.monitorMs / 1000}s…`)
      const { output, lines, errorPatterns } = await monitorSerial(port, this.monitorMs)

      // Print first 20 lines of output
      for (const line of lines.slice(0, 20)) this.log(`   > ${line}`)
      if (lines.length > 20) this.log(`   … (${lines.length - 20} 行已省略)`)

      if (errorPatterns.length === 0) {
        this.log(`✅ 串口输出正常，未检测到崩溃`)
        return { success: true, output, rounds: round }
      }

      this.log(`❌ 检测到运行时错误: ${errorPatterns[0]}`)

      if (round === MAX_MONITOR) {
        this.log(`❌ 达到最大监控次数 (${MAX_MONITOR})，停止`)
        return { success: false, output, errorPatterns, rounds: round }
      }

      this.log(`🤖 AI 分析崩溃原因并修复…`)
      try {
        const code   = readFileSync(inoFile, 'utf8')
        const fixed  = await fixRuntimeError(code, output, this.aiOpts)
        writeFileSync(inoFile, fixed, 'utf8')
        this.log(`💾 已应用修复`)
      } catch (e) {
        this.log(`⚠️ AI 修复失败: ${e.message}`)
        return { success: false, output, errorPatterns, rounds: round }
      }

      // Recompile and re-flash after fix
      this.log(`🔄 重新编译…`)
      const compileResult = await this.compileLoop(sketchDir, fqbn, inoFile)
      if (!compileResult.success) {
        return { success: false, error: '修复后编译失败', rounds: round }
      }

      this.log(`🔄 重新烧录…`)
      const flashResult = await this.flashLoop(sketchDir, fqbn, port)
      if (!flashResult.success) {
        return { success: false, error: '修复后烧录失败', rounds: round }
      }

      this.log(`⏳ 等待设备启动…`)
      await sleep(3000)
    }
  }

  // ── Full loop entry ────────────────────────────────────────────────────────

  async run() {
    const { inoFile, sketchDir, fqbn, port, boardName } = this.detect()

    if (!inoFile) {
      this.log(`❌ 未找到 .ino 文件（在 ${this.sketchDir} 中搜索）`)
      return { success: false, error: 'No .ino file found' }
    }
    this.log(`📁 草图: ${inoFile}`)

    if (!fqbn) {
      this.log(`❌ 无法检测板型。请用 --fqbn 指定，例如 --fqbn esp32:esp32:esp32c3`)
      return { success: false, error: 'Board FQBN not detected' }
    }
    this.log(`🔧 板型: ${boardName || fqbn}  (${fqbn})`)

    // ── Stage 1: Compile ──────────────────────────────────────────────────────
    const compileResult = await this.compileLoop(sketchDir, fqbn, inoFile)
    if (!compileResult.success) return compileResult

    // ── Stage 2: Flash (optional if no port) ─────────────────────────────────
    if (!port) {
      this.log(`⚠️  未检测到串口，跳过烧录和监控步骤`)
      this.log(`   插入开发板后用 --port 参数指定端口`)
      return { success: true, compileOnly: true }
    }
    this.log(`🔌 端口: ${port}`)

    const flashResult = await this.flashLoop(sketchDir, fqbn, port)
    if (!flashResult.success) return flashResult

    // ── Stage 3: Monitor ──────────────────────────────────────────────────────
    this.log(`⏳ 等待设备启动…`)
    await sleep(2000)

    const monitorResult = await this.monitorLoop(sketchDir, fqbn, port, inoFile)
    return monitorResult
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }
