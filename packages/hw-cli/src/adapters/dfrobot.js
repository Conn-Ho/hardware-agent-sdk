/**
 * DFRobot 创客商城 adapter (dfrobot.com.cn)
 * Specializes in dev boards, Arduino/ESP32 kits, sensors, robots.
 * Scrapes search results from search_elastic.php.
 */

const BASE = 'https://www.dfrobot.com.cn'
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  'Referer': 'https://www.dfrobot.com.cn/',
  'Accept-Language': 'zh-CN,zh;q=0.9',
}

export async function search(keyword, { pageSize = 20 } = {}) {
  const url = `${BASE}/search_elastic.php?keywords=${encodeURIComponent(keyword)}`
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`DFRobot search error: ${res.status}`)

  const html = await res.text()
  const results = parseResults(html).slice(0, pageSize)

  return {
    source: 'dfrobot',
    total: results.length,
    page: 1,
    results,
  }
}

function parseResults(html) {
  const results = []

  // Match each product block: data-price + name link + product URL
  // Pattern: class="name ..." href="goods-NNNN.html" ...>PRODUCT NAME</a>
  const nameRe = /class="name[^"]*"\s+href="(goods-\d+\.html)"[^>]*>\s*([^<]{2,100}?)\s*<\/a>/g
  const priceRe = /data-price="([^"]+)"/g
  const imgRe   = /<a class="goodImg" href="goods-\d+\.html">\s*<img src="([^"]+)"/g

  const names  = [...html.matchAll(nameRe)]
  const prices = [...html.matchAll(priceRe)]
  const imgs   = [...html.matchAll(imgRe)]

  for (let i = 0; i < names.length; i++) {
    const [, path, name] = names[i]
    const priceRaw = prices[i]?.[1] ?? ''
    const imgSrc   = imgs[i]?.[1]  ?? null
    const price    = parseFloat(priceRaw.replace(/[￥¥,]/g, '')) || null
    const id       = path.match(/goods-(\d+)/)?.[1]

    results.push({
      source:      'dfrobot',
      partNumber:  id ? `DFR-${id}` : null,
      name:        name.trim(),
      price,
      currency:    'CNY',
      priceBreaks: price ? [{ qty: 1, price }] : [],
      stock:       null,
      url:         `${BASE}/${path}`,
      image:       imgSrc,
    })
  }

  return results
}
