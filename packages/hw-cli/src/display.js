import chalk from 'chalk'
import Table from 'cli-table3'

const SOURCE_COLOR = {
  waveshare: chalk.cyan,
  lcsc: chalk.yellow,
  jd: chalk.red,
}

function fmtPrice(price, currency) {
  if (price == null) return chalk.gray('—')
  const sym = currency === 'CNY' ? '¥' : '$'
  return `${sym}${price.toFixed(2)}`
}

function fmtStock(stock) {
  if (stock == null) return chalk.gray('—')
  if (stock === 0) return chalk.red('缺货')
  if (stock < 10) return chalk.yellow(`${stock}`)
  return chalk.green(`${stock}`)
}

export function printTable(allResults) {
  const table = new Table({
    head: [
      chalk.bold('来源'),
      chalk.bold('型号'),
      chalk.bold('名称'),
      chalk.bold('单价'),
      chalk.bold('库存'),
    ],
    colWidths: [12, 28, 42, 12, 8],
    wordWrap: true,
    style: { head: [], border: [] },
  })

  for (const group of allResults) {
    if (group.error) {
      table.push([{ colSpan: 5, content: chalk.red(`${group.source}: ${group.error}`) }])
      continue
    }
    const color = SOURCE_COLOR[group.source] ?? chalk.white
    for (const item of group.results) {
      table.push([
        color(group.source),
        item.partNumber ?? '—',
        item.name.slice(0, 40),
        fmtPrice(item.price, item.currency),
        fmtStock(item.stock),
      ])
    }
    if (group.results.length === 0) {
      table.push([{ colSpan: 5, content: chalk.gray(`${group.source}: 无结果`) }])
    }
  }

  console.log(table.toString())
}

export function printPriceBreaks(item) {
  console.log(chalk.bold(`\n${item.name}`))
  console.log(chalk.gray(`来源: ${item.source}  型号: ${item.partNumber}`))
  if (item.manufacturer) console.log(chalk.gray(`制造商: ${item.manufacturer}  封装: ${item.package}`))
  if (item.url) console.log(chalk.blue(item.url))

  if (item.priceBreaks?.length) {
    console.log(chalk.bold('\n价格阶梯:'))
    const t = new Table({ head: ['数量', '单价'], colWidths: [10, 12] })
    for (const pb of item.priceBreaks) {
      t.push([`≥${pb.qty}`, fmtPrice(pb.price, item.currency)])
    }
    console.log(t.toString())
  }
}

export function printJson(data) {
  console.log(JSON.stringify(data, null, 2))
}

export function printSummary(allResults, keyword) {
  const total = allResults.reduce((n, g) => n + (g.results?.length ?? 0), 0)
  console.log(chalk.gray(`\n搜索 "${keyword}"  共 ${total} 条结果\n`))
}
