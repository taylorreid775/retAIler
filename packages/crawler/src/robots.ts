import robotsParser from 'robots-parser';
import { serverEnv } from '@retailer/core';

const cache = new Map<string, { robots: ReturnType<typeof robotsParser>; fetchedAt: number }>();
const TTL_MS = 6 * 60 * 60 * 1000; // 6h

/**
 * Loads and caches robots.txt for a host and answers allow/deny for our UA.
 * Politeness is the default; callers should only bypass with explicit,
 * reviewed per-retailer config.
 */
export async function isAllowed(targetUrl: string): Promise<boolean> {
  const ua = serverEnv().CRAWLER_USER_AGENT;
  const { origin } = new URL(targetUrl);
  const cached = cache.get(origin);

  let robots = cached?.robots;
  if (!robots || Date.now() - (cached?.fetchedAt ?? 0) > TTL_MS) {
    const robotsUrl = `${origin}/robots.txt`;
    try {
      const res = await fetch(robotsUrl, { headers: { 'user-agent': ua } });
      const body = res.ok ? await res.text() : '';
      robots = robotsParser(robotsUrl, body);
      cache.set(origin, { robots, fetchedAt: Date.now() });
    } catch {
      // If robots can't be fetched, fail closed for safety on this fetch.
      return false;
    }
  }

  const allowed = robots.isAllowed(targetUrl, ua);
  return allowed !== false;
}

export async function crawlDelay(targetUrl: string): Promise<number | undefined> {
  const ua = serverEnv().CRAWLER_USER_AGENT;
  const { origin } = new URL(targetUrl);
  const robots = cache.get(origin)?.robots;
  const delay = robots?.getCrawlDelay(ua);
  return typeof delay === 'number' ? delay * 1000 : undefined;
}
