const BASE = 'https://www.waveshare.net/api/v1'
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  'Referer': 'https://www.waveshare.net/',
}

export async function search(keyword, { page = 1, pageSize = 20 } = {}) {
  const url = `${BASE}/search?kw=${encodeURIComponent(keyword)}&page=${page}&pageSize=${pageSize}`
  const res = await fetch(url, { headers: HEADERS })
  if (!res.ok) throw new Error(`Waveshare API error: ${res.status}`)
  const data = await res.json()

  return {
    source: 'waveshare',
    total: data.total ?? 0,
    page,
    results: (data.list ?? []).map(item => ({
      source: 'waveshare',
      partNumber: item.spec_no,
      name: item.title.replace(/<[^>]+>/g, ''),
      price: typeof item.sale_price === 'number' ? item.sale_price : parseFloat(item.sale_price) || null,
      currency: 'CNY',
      priceBreaks: item.sale_price ? [{ qty: 1, price: parseFloat(item.sale_price) }] : [],
      stock: null,
      url: `https://www.waveshare.net${item.path_url}`,
      image: item.photo ? `https://www.waveshare.net${item.photo}` : null,
    })),
  }
}
