import { StaticFetcher, type Fetcher } from '@retailer/crawler';
import { BrowserFetcher } from './browser-fetcher.js';

/** Lazily-created, shared fetchers (one browser instance is expensive). */
let staticFetcher: Fetcher | null = null;
let browserFetcher: BrowserFetcher | null = null;

export function fetcherFor(strategy: 'static' | 'browser' | 'jina_reader'): Fetcher {
  if (strategy === 'browser') {
    browserFetcher ??= new BrowserFetcher();
    return browserFetcher;
  }
  staticFetcher ??= new StaticFetcher();
  return staticFetcher;
}

export async function closeFetchers(): Promise<void> {
  await browserFetcher?.close();
  browserFetcher = null;
}
