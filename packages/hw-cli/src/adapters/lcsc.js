const BASE = 'https://wmsc.lcsc.com'
const HEADERS = {
  'Content-Type': 'application/json',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  'Referer': 'https://www.lcsc.com/',
  'Origin': 'https://www.lcsc.com',
}

function mapProduct(item) {
  return {
    source: 'lcsc',
    partNumber: item.productCode,
    name: item.title ?? item.productModel,
    manufacturer: item.brandNameEn ?? item.brandName,
    package: item.encapStandard ?? item.packageModel,
    stock: item.stockNumber ?? 0,
    currency: 'USD',
    price: item.productPriceList?.[0]?.usdPrice ?? null,
    priceBreaks: (item.productPriceList ?? []).map(p => ({
      qty: p.ladder,
      price: p.usdPrice,
    })),
    datasheet: item.pdfUrl ?? null,
    url: item.url ?? `https://www.lcsc.com/product-detail/${item.productCode}.html`,
  }
}

export async function search(keyword, { page = 1, pageSize = 20 } = {}) {
  // Use query/list — returns full catalog (25+ results for ST7789 vs 1 from global search)
  const res = await fetch(`${BASE}/ftps/wm/product/query/list`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({
      keyword,
      currentPage: page,
      pageSize,
      catalogId: '',
      paramData: [],
    }),
  })
  if (!res.ok) throw new Error(`LCSC API error: ${res.status}`)
  const data = await res.json()

  const list = data?.result?.dataList ?? []
  const total = data?.result?.totalRow ?? 0

  return {
    source: 'lcsc',
    total,
    page,
    results: list.map(mapProduct),
  }
}
