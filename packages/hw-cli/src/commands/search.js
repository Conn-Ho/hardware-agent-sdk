import ora from 'ora'
import { searchAll, SOURCES } from '../adapters/index.js'
import { printTable, printJson, printSummary } from '../display.js'

const ALL_SOURCES = Object.keys(SOURCES)

export function registerSearch(program) {
  program
    .command('search <keyword>')
    .description('搜索硬件元件，跨平台比价')
    .option('-s, --sources <list>', '数据源，逗号分隔 (waveshare,lcsc)', ALL_SOURCES.join(','))
    .option('-n, --limit <n>', '每个平台最多显示条数', '10')
    .option('-f, --format <fmt>', '输出格式: table | json', 'table')
    .option('-p, --page <n>', '页码', '1')
    .action(async (keyword, opts) => {
      const sources = opts.sources.split(',').map(s => s.trim()).filter(s => SOURCES[s])
      const limit = parseInt(opts.limit)
      const page = parseInt(opts.page)

      const spinner = ora(`搜索 "${keyword}"...`).start()

      let allResults
      try {
        allResults = await searchAll(keyword, sources, { page, pageSize: limit })
        spinner.stop()
      } catch (err) {
        spinner.fail(err.message)
        process.exit(1)
      }

      if (opts.format === 'json') {
        printJson(allResults)
      } else {
        printSummary(allResults, keyword)
        printTable(allResults)
      }
    })
}
