import type { BrowserFetcher } from './browser-fetcher.js';

export interface ApiFetchInit {
  method?: 'GET' | 'POST';
  body?: string;
}

/** JSON fetch used for API recipe validation and crawl — same transport for both. */
export function createApiFetchJson(opts: {
  fetchStrategy: 'static' | 'browser' | 'jina_reader';
  browserFetcher?: BrowserFetcher | null;
}): (
  url: string,
  headers?: Record<string, string>,
  init?: ApiFetchInit,
) => Promise<unknown | null> {
  const useBrowser = opts.fetchStrategy === 'browser' && opts.browserFetcher;

  return async (url: string, headers: Record<string, string> = {}, init?: ApiFetchInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body;

    if (useBrowser) {
      const res = await opts.browserFetcher!.fetchApi(url, { headers, method, body });
      if (res.status < 200 || res.status >= 300) return null;
      try {
        return JSON.parse(res.text) as unknown;
      } catch {
        return null;
      }
    }

    try {
      const res = await fetch(url, {
        method,
        headers,
        body: method === 'POST' ? body : undefined,
        signal: AbortSignal.timeout(45_000),
      });
      if (!res.ok) return null;
      return (await res.json()) as unknown;
    } catch {
      return null;
    }
  };
}
