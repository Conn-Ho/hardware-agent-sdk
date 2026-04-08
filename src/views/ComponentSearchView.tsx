import { useState } from 'react';
import { Search, Package, ExternalLink, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface ComponentResult {
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

export function ComponentSearchView() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ComponentResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sources, setSources] = useState({
    lcsc: true,
    waveshare: true,
    dfrobot: true,
  });

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setIsLoading(true);
    setError(null);
    try {
      const activeSources = Object.entries(sources)
        .filter(([, v]) => v)
        .map(([k]) => k);
      const { data, error: fnError } = await supabase.functions.invoke(
        'component-search',
        {
          body: { query: query.trim(), sources: activeSources },
        },
      );
      if (fnError) throw new Error(fnError.message);
      setResults(data?.results ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setIsLoading(false);
    }
  };

  const sourceColors: Record<string, string> = {
    lcsc: 'text-blue-400 border-blue-400/30 bg-blue-400/10',
    waveshare: 'text-cyan-400 border-cyan-400/30 bg-cyan-400/10',
    dfrobot: 'text-orange-400 border-orange-400/30 bg-orange-400/10',
  };

  return (
    <div className="flex h-full flex-col bg-[#0a0a0a] p-6 font-mono">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-white">
          Component Search
        </h1>
        <p className="mt-1 text-sm text-white/40">
          Search LCSC · Waveshare · DFRobot for hardware components
        </p>
      </div>

      <form onSubmit={handleSearch} className="mb-6 space-y-4">
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ESP32-C3, ST7789 display, AMS1117..."
              className="w-full rounded-md border border-white/10 bg-black/50 py-2.5 pl-10 pr-4 text-sm text-white placeholder-white/30 outline-none transition-colors focus:border-[#60a5fa]/60"
            />
          </div>
          <button
            type="submit"
            disabled={isLoading || !query.trim()}
            className="flex items-center gap-2 rounded-md border border-[#60a5fa] px-5 py-2.5 text-sm text-[#60a5fa] transition-all hover:bg-[#60a5fa] hover:text-black disabled:opacity-40"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
            Search
          </button>
        </div>

        <div className="flex gap-4 text-xs">
          {Object.entries(sources).map(([src, active]) => (
            <label key={src} className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={active}
                onChange={(e) =>
                  setSources((s) => ({ ...s, [src]: e.target.checked }))
                }
                className="accent-[#60a5fa]"
              />
              <span className={active ? 'text-white/70' : 'text-white/30'}>
                {src.toUpperCase()}
              </span>
            </label>
          ))}
        </div>
      </form>

      {error && (
        <div className="mb-4 rounded-md border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {results.length > 0 && (
        <div className="flex-1 overflow-auto">
          <p className="mb-3 text-xs text-white/30">{results.length} results</p>
          <div className="space-y-2">
            {results.map((r, i) => (
              <div
                key={i}
                className="flex items-center justify-between rounded-md border border-white/5 bg-black/40 px-4 py-3 transition-colors hover:border-white/10"
              >
                <div className="flex items-center gap-4">
                  <span
                    className={`rounded border px-1.5 py-0.5 text-xs ${sourceColors[r.source] ?? 'border-white/10 text-white/40'}`}
                  >
                    {r.source}
                  </span>
                  <div>
                    <p className="text-sm text-white">{r.name}</p>
                    <p className="text-xs text-white/40">
                      {r.partNumber}
                      {r.manufacturer ? ` · ${r.manufacturer}` : ''}
                      {r.package ? ` · ${r.package}` : ''}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-6 text-right">
                  <div>
                    <p className="text-sm font-medium text-[#60a5fa]">
                      {r.currency === 'USD' ? '$' : '¥'}
                      {r.price.toFixed(2)}
                    </p>
                    <p className="text-xs text-white/40">
                      {r.stock > 0
                        ? `${r.stock.toLocaleString()} in stock`
                        : 'Out of stock'}
                    </p>
                  </div>
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-white/30 hover:text-white/70"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!isLoading && results.length === 0 && !error && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <Package className="h-12 w-12 text-white/10" />
          <p className="text-sm text-white/30">
            Search for components across Chinese electronics suppliers
          </p>
          <p className="text-xs text-white/20">LCSC · Waveshare · DFRobot</p>
        </div>
      )}
    </div>
  );
}
