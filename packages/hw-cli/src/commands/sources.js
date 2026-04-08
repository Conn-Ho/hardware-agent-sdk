import chalk from 'chalk'
import Table from 'cli-table3'
import { SOURCES } from '../adapters/index.js'

export function registerSources(program) {
  program
    .command('sources')
    .description('列出可用数据源')
    .action(() => {
      const table = new Table({
        head: [chalk.bold('ID'), chalk.bold('名称'), chalk.bold('货币'), chalk.bold('状态')],
        colWidths: [14, 20, 8, 10],
      })
      for (const [id, src] of Object.entries(SOURCES)) {
        table.push([id, src.label, src.currency, chalk.green('✓ 可用')])
      }
      table.push(['jd', '京东', 'CNY', chalk.gray('计划中')])
      table.push(['1688', '1688', 'CNY', chalk.gray('计划中')])
      console.log('\n' + table.toString() + '\n')
    })
}
