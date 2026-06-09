import { createLogger } from '@retailer/core';
import { RateLimiter, sleep } from '../rate-limit';

const log = createLogger('crawler:jina');

const JINA_BASE = 'https://r.jina.ai/';
/** ~15 req/s global cap (Jina allows 1000/min). */
const JINA_DELAY_MS = 67;
const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_ATTEMPTS = 4;

const limiter = new RateLimiter(JINA_DELAY_MS);

export interface JinaFetchResult {
  markdown: string;
  status: number;
  /** Target URL passed in (not the Jina proxy URL). */
  finalUrl: string;
}

/** Build the Jina Reader proxy URL for a target page. */
export function jinaReaderUrl(targetUrl: string): string {
  return `${JINA_BASE}${targetUrl}`;
}

/**
 * Fetch a page as markdown via Jina Reader (https://r.jina.ai/{url}).
 * Rate-limited globally; retries on 429/5xx with exponential backoff.
 */
export async function fetchJinaMarkdown(
  targetUrl: string,
  opts: { attempts?: number; timeoutMs?: number } = {},
): Promise<JinaFetchResult | null> {
  const attempts = opts.attempts ?? DEFAULT_ATTEMPTS;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const jinaUrl = jinaReaderUrl(targetUrl);

  for (let i = 0; i < attempts; i++) {
    await limiter.wait('jina');

    try {
      const res = await fetch(jinaUrl, {
        headers: {
          accept: 'text/plain,text/markdown,*/*',
          'accept-language': 'en-CA,en;q=0.9',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (res.status === 429 || res.status >= 500) {
        const wait = Math.min(30_000, 3_000 * 2 ** i);
        log.warn('Jina fetch retryable error', { targetUrl, status: res.status, attempt: i + 1, wait });
        await sleep(wait);
        continue;
      }

      const markdown = await res.text();
      if (!res.ok) {
        log.warn('Jina fetch failed', { targetUrl, status: res.status, len: markdown.length });
        return null;
      }

      log.debug('Jina fetch ok', { targetUrl, status: res.status, len: markdown.length });
      return { markdown, status: res.status, finalUrl: targetUrl };
    } catch (err) {
      const wait = Math.min(30_000, 3_000 * 2 ** i);
      log.warn('Jina fetch error', { targetUrl, attempt: i + 1, err: String(err), wait });
      if (i < attempts - 1) await sleep(wait);
    }
  }

  return null;
}
