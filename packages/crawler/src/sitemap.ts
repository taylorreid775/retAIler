import { XMLParser } from 'fast-xml-parser';
import { createLogger } from '@retailer/core';

const parser = new XMLParser({ ignoreAttributes: false });
const log = createLogger('crawler:sitemap');

interface SitemapNode {
  loc?: string;
}

export interface WalkSitemapOptions {
  depth?: number;
  /** Override fetch (Playwright for Cloudflare-protected sites). */
  fetchText?: (url: string) => Promise<string | null>;
  userAgent?: string;
}

/**
 * Recursively walks a sitemap (or sitemap index) and yields page URLs.
 * `urlFilter` lets adapters keep only product-detail URLs.
 */
export async function* walkSitemap(
  sitemapUrl: string,
  urlFilter: (url: string) => boolean,
  opts: WalkSitemapOptions = {},
): AsyncGenerator<string> {
  const depth = opts.depth ?? 0;
  if (depth > 5) return;

  let xml: string;
  try {
    if (opts.fetchText) {
      const text = await opts.fetchText(sitemapUrl);
      if (!text) {
        log.warn('sitemap fetch failed', { sitemapUrl, via: 'custom' });
        return;
      }
      xml = text;
    } else {
      const res = await fetch(sitemapUrl, {
        headers: {
          'user-agent': opts.userAgent ?? 'RetAIlerBot/0.1',
          accept: 'application/xml,text/xml,*/*',
        },
      });
      if (!res.ok) {
        log.warn('sitemap fetch failed', { sitemapUrl, status: res.status });
        return;
      }
      xml = await res.text();
    }
  } catch (err) {
    log.warn('sitemap fetch error', { sitemapUrl, err: String(err) });
    return;
  }

  const doc = parser.parse(xml);

  // Sitemap index → recurse into child sitemaps.
  if (doc.sitemapindex?.sitemap) {
    const children = asArray<SitemapNode>(doc.sitemapindex.sitemap);
    for (const child of children) {
      if (child.loc) {
        yield* walkSitemap(child.loc, urlFilter, { ...opts, depth: depth + 1 });
      }
    }
    return;
  }

  // URL set → yield matching page URLs.
  if (doc.urlset?.url) {
    const urls = asArray<SitemapNode>(doc.urlset.url);
    for (const u of urls) {
      if (u.loc && urlFilter(u.loc)) yield u.loc;
    }
  }
}

function asArray<T>(value: T | T[]): T[] {
  return Array.isArray(value) ? value : [value];
}
