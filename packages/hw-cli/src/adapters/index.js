import { search as waveshareSearch } from './waveshare.js'
import { search as lcscSearch } from './lcsc.js'

export const SOURCES = {
  waveshare: { search: waveshareSearch, label: 'Waveshare 微雪', currency: 'CNY' },
  lcsc:      { search: lcscSearch,      label: 'LCSC 立创',      currency: 'USD' },
}

export async function searchAll(keyword, sources, opts = {}) {
  const adapters = sources.map(s => SOURCES[s]).filter(Boolean)
  const results = await Promise.allSettled(
    adapters.map(a => a.search(keyword, opts))
  )
  return results.map((r, i) => {
    if (r.status === 'fulfilled') return r.value
    return { source: sources[i], error: r.reason.message, results: [] }
  })
}
