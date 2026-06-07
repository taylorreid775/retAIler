import { createLogger, type Logger } from '@retailer/core';
import { fetcherFor } from './fetchers.js';
import { BrowserFetcher } from './browser-fetcher.js';

const defaultLog = createLogger('worker:discover-fetch');

export function isSitemapLikeUrl(url: string): boolean {
  return /\.(xml|gz)(\?|$)|\/robots\.txt$/i.test(url);
}

/** Sites like MEC/Walmart return HTTP 200 with a challenge page instead of a 403. */
export function looksLikeBotWall(html: string, finalUrl?: string): boolean {
  if (finalUrl && /\/blocked(\?|$)/i.test(finalUrl)) return true;
  const head = html.slice(0, 4000).toLowerCase();
  return (
    head.includes('just a moment') ||
    head.includes('cf-browser-verification') ||
    head.includes('verify your identity') ||
    head.includes('captcha') ||
    head.includes('px-captcha') ||
    head.includes('access denied') ||
    head.includes('robot or human')
  );
}

function looksLikeXml(text: string): boolean {
  return text.slice(0, 512).trimStart().startsWith('<');
}

/**
 * Fetch helper for discovery: static-first with browser fallback when the
 * retailer needs JS/Cloudflare bypass, or when a 2xx response is a bot wall.
 */
export function createDiscoverFetchText(opts: {
  fetchStrategy: 'static' | 'browser';
  log?: Logger;
}): (url: string) => Promise<string | null> {
  const log = opts.log ?? defaultLog;
  const staticFetcher = fetcherFor('static');
  const browserFetcher =
    opts.fetchStrategy === 'browser' ? (fetcherFor('browser') as BrowserFetcher) : null;

  return async (url: string): Promise<string | null> => {
    const tryStatic = async () => {
      try {
        const res = await staticFetcher.fetch(url);
        if (res.status >= 200 && res.status < 300) return res;
      } catch (err) {
        log.warn('static fetch error', { url, err: String(err) });
      }
      return null;
    };

    const tryBrowser = async (): Promise<string | null> => {
      if (!browserFetcher) return null;
      try {
        const res = await browserFetcher.fetch(url);
        return res.status >= 200 && res.status < 300 ? res.html : null;
      } catch (err) {
        log.warn('browser fetch error', { url, err: String(err) });
        return null;
      }
    };

    if (isSitemapLikeUrl(url)) {
      const staticRes = await tryStatic();
      const staticBody = staticRes?.html;
      if (staticBody && looksLikeXml(staticBody) && !looksLikeBotWall(staticBody, staticRes?.finalUrl)) {
        return staticBody;
      }
      const browserBody = await tryBrowser();
      if (browserBody && looksLikeXml(browserBody)) return browserBody;
      return null;
    }

    const staticRes = await tryStatic();
    if (
      staticRes &&
      !looksLikeBotWall(staticRes.html, staticRes.finalUrl) &&
      staticRes.html.length >= 200
    ) {
      return staticRes.html;
    }

    return tryBrowser();
  };
}
