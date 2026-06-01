import { XMLParser } from 'fast-xml-parser';
import { serverEnv } from '@retailer/core';

const parser = new XMLParser({ ignoreAttributes: false });

interface SitemapNode {
  loc?: string;
}

/**
 * Recursively walks a sitemap (or sitemap index) and yields page URLs.
 * `urlFilter` lets adapters keep only product-detail URLs.
 */
export async function* walkSitemap(
  sitemapUrl: string,
  urlFilter: (url: string) => boolean,
  depth = 0,
): AsyncGenerator<string> {
  if (depth > 5) return;
  const ua = serverEnv().CRAWLER_USER_AGENT;
  let xml: string;
  try {
    const res = await fetch(sitemapUrl, { headers: { 'user-agent': ua } });
    if (!res.ok) return;
    xml = await res.text();
  } catch {
    return;
  }

  const doc = parser.parse(xml);

  // Sitemap index → recurse into child sitemaps.
  if (doc.sitemapindex?.sitemap) {
    const children = asArray<SitemapNode>(doc.sitemapindex.sitemap);
    for (const child of children) {
      if (child.loc) yield* walkSitemap(child.loc, urlFilter, depth + 1);
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
