import type { BrowserFetcher } from './browser-fetcher.js';

/** JSON fetch used for API recipe validation and crawl — same transport for both. */
export function createApiFetchJson(opts: {
  fetchStrategy: 'static' | 'browser' | 'jina_reader';
  browserFetcher?: BrowserFetcher | null;
}): (url: string, headers?: Record<string, string>) => Promise<unknown | null> {
  const useBrowser = opts.fetchStrategy === 'browser' && opts.browserFetcher;

  return async (url: string, headers: Record<string, string> = {}) => {
    if (useBrowser) {
      const res = await opts.browserFetcher!.fetchJson(url, headers);
      if (res.status < 200 || res.status >= 300) return null;
      try {
        return JSON.parse(res.text) as unknown;
      } catch {
        return null;
      }
    }
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(45_000) });
      if (!res.ok) return null;
      return (await res.json()) as unknown;
    } catch {
      return null;
    }
  };
}
