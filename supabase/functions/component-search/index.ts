import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

interface SearchResult {
  source: string;
  partNumber: string;
  name: string;
  manufacturer?: string;
  package?: string;
  stock: number;
  price: number;
  currency: string;
  url: string;
}

async function searchLCSC(keyword: string): Promise<SearchResult[]> {
  try {
    const response = await fetch(
      'https://wmsc.lcsc.com/ftps/wm/product/query/list',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          Referer: 'https://www.lcsc.com/',
          Origin: 'https://www.lcsc.com',
        },
        body: JSON.stringify({
          keyword,
          currentPage: 1,
          pageSize: 20,
          searchSource: 'search',
        }),
      },
    );
    if (!response.ok) return [];
    const data = await response.json();
    const products = data?.result?.productList ?? [];
    return products.slice(0, 10).map((p: Record<string, unknown>) => ({
      source: 'lcsc',
      partNumber: String(p.productCode ?? ''),
      name: String(p.productModel ?? p.productIntroEn ?? ''),
      manufacturer: String(p.brandNameEn ?? ''),
      package: String(p.encapStandard ?? ''),
      stock: Number(p.stockNumber ?? 0),
      price: Number(p.usdPrice ?? p.productPrice ?? 0),
      currency: 'USD',
      url: `https://www.lcsc.com/product-detail/${p.productCode}.html`,
    }));
  } catch {
    return [];
  }
}

async function searchWaveshare(keyword: string): Promise<SearchResult[]> {
  try {
    const params = new URLSearchParams({
      kw: keyword,
      page: '1',
      pageSize: '10',
    });
    const response = await fetch(
      `https://www.waveshare.net/api/v1/search?${params}`,
      {
        headers: { 'User-Agent': 'Mozilla/5.0' },
      },
    );
    if (!response.ok) return [];
    const data = await response.json();
    const items = data?.data?.list ?? data?.list ?? [];
    return items.slice(0, 10).map((p: Record<string, unknown>) => ({
      source: 'waveshare',
      partNumber: String(p.spec_no ?? p.id ?? ''),
      name: String(p.title ?? '').replace(/<[^>]+>/g, ''),
      stock: 99,
      price: Number(p.sale_price ?? p.price ?? 0),
      currency: 'CNY',
      url: `https://www.waveshare.net${p.path_url ?? ''}`,
    }));
  } catch {
    return [];
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { query, sources = ['lcsc', 'waveshare'] } = await req.json();

    if (!query || typeof query !== 'string') {
      return new Response(JSON.stringify({ error: 'query is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const promises: Promise<SearchResult[]>[] = [];
    if (sources.includes('lcsc')) promises.push(searchLCSC(query));
    if (sources.includes('waveshare')) promises.push(searchWaveshare(query));

    const allResults = await Promise.allSettled(promises);
    const results: SearchResult[] = allResults
      .filter(
        (r): r is PromiseFulfilledResult<SearchResult[]> =>
          r.status === 'fulfilled',
      )
      .flatMap((r) => r.value);

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
