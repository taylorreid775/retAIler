import { serverEnv } from '@retailer/core';

/**
 * A small pool of realistic desktop user agents. Rotating the UA (alongside our
 * identifiable bot UA where required) reduces naive fingerprint-based blocking.
 * Keep the bot UA as the default for retailers that expect identification.
 */
const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
];

let uaIdx = 0;
export function nextUserAgent(): string {
  const ua = USER_AGENTS[uaIdx % USER_AGENTS.length]!;
  uaIdx += 1;
  return ua;
}

/** Parse CRAWLER_PROXY_URL (comma-separated for a rotating pool). */
export function proxyPool(): string[] {
  const raw = serverEnv().CRAWLER_PROXY_URL;
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

let proxyIdx = 0;
export function nextProxy(): string | undefined {
  const pool = proxyPool();
  if (pool.length === 0) return undefined;
  const p = pool[proxyIdx % pool.length];
  proxyIdx += 1;
  return p;
}

/** Error that asks the queue to retry after a delay (e.g. on HTTP 429). */
export class RetryAfterError extends Error {
  constructor(
    message: string,
    public readonly delayMs: number,
  ) {
    super(message);
    this.name = 'RetryAfterError';
  }
}
