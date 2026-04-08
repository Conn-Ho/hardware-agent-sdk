#!/usr/bin/env node
import { Command } from 'commander'
import chalk from 'chalk'
import ora from 'ora'
import readline from 'node:readline/promises'
import fs from 'node:fs/promises'
import path from 'node:path'
import { CadLoop, checkExecutorHealth } from '../src/index.js'
import { claudePrompt } from '../src/claude-cli.js'
import { CODE_GEN_PROMPT } from '../src/prompts.js'

const program = new Command()

program
  .name('cad-skill')
  .description('AI-powered CAD generation loop — Build123d + claude CLI + Docker')
  .version('0.1.0')

// ── Helpers ───────────────────────────────────────────────────────────────────

function printMetrics(result) {
  const m = result.metrics ?? {}
  if (m.bounding_box) {
    const b = m.bounding_box
    console.log(chalk.bold('Bounding box:'), `${b.x} × ${b.y} × ${b.z} mm`)
  }
  if (m.volume_mm3) console.log(chalk.bold('Volume:      '), `${m.volume_mm3} mm³`)
}

function printPrintability(result) {
  const p = result.printability
  if (!p || p.error || Object.keys(p).length === 0) return

  console.log()
  console.log(chalk.bold('Printability:'))
  const watertightLabel = p.is_watertight ? chalk.green('✓ watertight') : chalk.red('✗ NOT watertight (holes in mesh)')
  console.log(' ', watertightLabel)

  if (p.needs_supports) {
    console.log(' ', chalk.yellow(`⚠ overhangs detected (${(p.overhang_ratio * 100).toFixed(1)}% of surface) — supports needed`))
  } else {
    console.log(' ', chalk.green('✓ no significant overhangs'))
  }

  if (p.body_count > 1) {
    console.log(' ', chalk.yellow(`⚠ ${p.body_count} disconnected bodies`))
  }
}

function printRenderPaths(renderPaths) {
  if (!renderPaths || Object.keys(renderPaths).length === 0) return
  console.log()
  console.log(chalk.bold('Renders saved:'))
  for (const [view, filePath] of Object.entries(renderPaths)) {
    console.log(`  ${chalk.gray(view.padEnd(10))} ${chalk.cyan(filePath)}`)
  }
  console.log(chalk.gray('  (Use Read tool to inspect renders with vision)'))
}

// ── code (no Docker needed) ───────────────────────────────────────────────

program
  .command('code <description>')
  .description('Generate Build123d Python code (no Docker required)')
  .option('-o, --output <file>', 'Save code to .py file')
  .option('--model <model>', 'Claude model override')
  .action(async (description, opts) => {
    const spinner = ora('Generating Build123d code...').start()
    try {
      let raw = await claudePrompt(description, {
        systemPrompt: CODE_GEN_PROMPT,
        model: opts.model,
      })

      const code = raw
        .replace(/^```python\s*/m, '')
        .replace(/^```\s*/m, '')
        .replace(/```\s*$/m, '')
        .trim()

      spinner.succeed('Code generated')
      console.log()

      if (opts.output) {
        await fs.writeFile(opts.output, code)
        console.log(chalk.green(`✓ Saved to: ${opts.output}`))
      } else {
        console.log(chalk.gray('─'.repeat(60)))
        console.log(chalk.cyan(code))
        console.log(chalk.gray('─'.repeat(60)))
      }
    } catch (err) {
      spinner.fail(err.message)
      process.exit(1)
    }
  })

// ── generate (needs Docker) ───────────────────────────────────────────────

program
  .command('generate <description>')
  .description('Generate + execute model, export STL (requires Docker executor)')
  .option('-o, --output <path>', 'Output STL path', './output/model.stl')
  .option('--model <model>', 'Claude model override')
  .option('-v, --verbose', 'Show execution details')
  .action(async (description, opts) => {
    const healthy = await checkExecutorHealth()
    if (!healthy) {
      console.error(chalk.red('✗ CAD executor not running.'))
      console.error(chalk.yellow('  Start it:'))
      console.error(chalk.cyan('  cd packages/cad-skill && npm run build-docker'))
      console.error(chalk.cyan('  docker run -p 8765:8765 hardware-sdk-cad'))
      console.error()
      console.error(chalk.gray('  Tip: use `cad-skill code` to generate code without Docker.'))
      process.exit(1)
    }

    const outDir = path.dirname(path.resolve(opts.output))
    const loop = new CadLoop({ outputDir: outDir, verbose: opts.verbose, model: opts.model })

    const spinner = ora(`Generating: ${description.slice(0, 60)}...`).start()
    try {
      const { code, result, rounds, renderPaths } = await loop.generate(description)
      spinner.succeed(`Done (${rounds} execution round${rounds > 1 ? 's' : ''})`)
      console.log()

      if (result.success) {
        printMetrics(result)
        printPrintability(result)

        try {
          const stlPath = await loop.export('stl', path.basename(opts.output, '.stl'))
          console.log(chalk.green(`\n✓ STL saved to: ${stlPath}`))
        } catch {
          const codePath = opts.output.replace(/\.stl$/, '.py')
          await fs.mkdir(outDir, { recursive: true })
          await fs.writeFile(codePath, code ?? '')
          console.log(chalk.green(`✓ Build123d code saved to: ${codePath}`))
        }

        printRenderPaths(renderPaths)
      } else {
        console.log(chalk.red('✗ Execution failed after all correction rounds:'))
        console.log(chalk.gray(result.error?.slice(0, 400)))
        console.log()
        console.log(chalk.yellow('Generated code (may have issues):'))
        console.log(chalk.gray('─'.repeat(60)))
        console.log(chalk.cyan(code))
      }
    } catch (err) {
      spinner.fail(err.message)
      process.exit(1)
    }
  })

// ── chat ──────────────────────────────────────────────────────────────────

program
  .command('chat')
  .description('Interactive CAD design session')
  .option('-o, --output-dir <dir>', 'Output directory', './output')
  .option('--model <model>', 'Claude model override')
  .option('-v, --verbose', 'Show execution details')
  .action(async (opts) => {
    const loop = new CadLoop({ outputDir: opts.outputDir, verbose: opts.verbose, model: opts.model })

    console.log(chalk.bold.cyan('CAD Design Session'))
    console.log(chalk.gray('Describe what you want to build. Commands: export stl | export step | quit\n'))

    const healthy = await checkExecutorHealth()
    if (!healthy) {
      console.log(chalk.yellow('⚠ Docker executor not running — code will be generated but not executed.'))
      console.log(chalk.gray('  Start it: docker run -p 8765:8765 hardware-sdk-cad\n'))
    }

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

    while (true) {
      const input = (await rl.question(chalk.green('You: '))).trim()
      if (!input || input === 'quit' || input === 'exit') break

      if (input.startsWith('export ')) {
        const fmt = input.split(' ')[1]
        if (!loop.currentCode) {
          console.log(chalk.yellow('No model yet. Describe something first.\n'))
          continue
        }
        const spinner = ora(`Exporting ${fmt}...`).start()
        try {
          const p = await loop.export(fmt, 'model')
          spinner.succeed(`Exported: ${p}`)
        } catch (err) {
          spinner.fail(err.message)
        }
        console.log()
        continue
      }

      const isFirst = !loop.currentCode
      const spinner = ora(isFirst ? 'Generating...' : 'Refining...').start()

      try {
        const fn = isFirst ? loop.generate.bind(loop) : loop.refine.bind(loop)
        const { result, rounds, renderPaths } = await fn(input)
        spinner.succeed(result.success
          ? `Done (${rounds} round${rounds > 1 ? 's' : ''})`
          : `Generated code (execution failed)`)

        if (result.success) {
          if (result.metrics?.bounding_box) {
            const b = result.metrics.bounding_box
            console.log(chalk.gray(`  Bounding box: ${b.x}×${b.y}×${b.z}mm`))
          }
          printPrintability(result)
          printRenderPaths(renderPaths)
        } else {
          console.log(chalk.yellow('  Code generated but execution failed. Try: export stl (saves code)'))
        }
        console.log(chalk.gray('\n[Type a change description to refine, or "export stl" to save]\n'))
      } catch (err) {
        spinner.fail(err.message)
      }
    }

    rl.close()
    console.log(chalk.gray('Session ended.'))
  })

program.parse()
