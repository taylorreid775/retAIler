import { serverEnv } from '@retailer/core';

export interface FetchResult {
  url: string;
  status: number;
  html: string;
  /** Final URL after redirects. */
  finalUrl: string;
}

/**
 * A Fetcher retrieves a page's HTML. Static pages use `StaticFetcher`
 * (plain HTTP); JS-rendered retailers use a browser fetcher implemented in
 * the worker (Playwright) and injected via this interface.
 */
export interface Fetcher {
  readonly kind: 'static' | 'browser';
  fetch(url: string): Promise<FetchResult>;
  close?(): Promise<void>;
}

/** Plain HTTP fetcher using the platform `fetch`. */
export class StaticFetcher implements Fetcher {
  readonly kind = 'static' as const;

  constructor(private readonly userAgent = serverEnv().CRAWLER_USER_AGENT) {}

  async fetch(url: string): Promise<FetchResult> {
    const res = await fetch(url, {
      headers: {
        'user-agent': this.userAgent,
        accept: 'text/html,application/xhtml+xml',
        'accept-language': 'en-CA,en;q=0.9',
      },
      redirect: 'follow',
    });
    const html = await res.text();
    return { url, status: res.status, html, finalUrl: res.url || url };
  }
}
