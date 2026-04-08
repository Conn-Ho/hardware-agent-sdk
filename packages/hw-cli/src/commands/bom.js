import { readFileSync } from 'fs'
import ora from 'ora'
import chalk from 'chalk'
import Table from 'cli-table3'
import { searchAll, SOURCES } from '../adapters/index.js'
import { printJson } from '../display.js'

export function registerBom(program) {
  program
    .command('bom <file>')
    .description('解析 BOM 文件，自动查询各元件最低价')
    .option('-s, --sources <list>', '数据源', Object.keys(SOURCES).join(','))
    .option('--prefer <source>', '优先平台 (waveshare|lcsc)', 'lcsc')
    .option('-f, --format <fmt>', '输出格式: table | json', 'table')
    .action(async (file, opts) => {
      let bom
      try {
        bom = JSON.parse(readFileSync(file, 'utf8'))
      } catch {
        console.error(chalk.red(`无法读取 BOM 文件: ${file}`))
        process.exit(1)
      }

      const sources = opts.sources.split(',').map(s => s.trim()).filter(s => SOURCES[s])
      const spinner = ora(`解析 ${bom.length} 个元件...`).start()

      const resolved = []
      for (const item of bom) {
        spinner.text = `查询 ${item.name ?? item.query}...`
        const results = await searchAll(item.query ?? item.name, sources, { pageSize: 5 })
        const candidates = results.flatMap(g => g.results ?? [])

        const preferred = candidates.find(r => r.source === opts.prefer) ?? candidates[0]

        resolved.push({
          ...item,
          match: preferred ?? null,
          allMatches: candidates.slice(0, 3),
        })
      }
      spinner.stop()

      if (opts.format === 'json') {
        printJson(resolved)
        return
      }

      const table = new Table({
        head: [chalk.bold('元件'), chalk.bold('数量'), chalk.bold('型号'), chalk.bold('来源'), chalk.bold('单价'), chalk.bold('小计')],
        colWidths: [22, 6, 24, 12, 10, 10],
        wordWrap: true,
      })

      let totalCNY = 0
      for (const item of resolved) {
        const qty = item.qty ?? 1
        if (!item.match) {
          table.push([item.name, qty, chalk.gray('未找到'), '—', '—', '—'])
          continue
        }
        const price = item.match.price ?? 0
        const currency = item.match.currency === 'CNY' ? '¥' : '$'
        const subtotal = price * qty
        if (item.match.currency === 'CNY') totalCNY += subtotal
        table.push([
          item.name,
          qty,
          item.match.partNumber,
          item.match.source,
          `${currency}${price.toFixed(2)}`,
          chalk.green(`${currency}${subtotal.toFixed(2)}`),
        ])
      }

      console.log('\n' + table.toString())
      console.log(chalk.bold(`\n  CNY 合计: ¥${totalCNY.toFixed(2)}\n`))
    })
}
