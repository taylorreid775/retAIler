import { gunzipSync } from 'node:zlib';
import { XMLParser } from 'fast-xml-parser';
import { createLogger } from '@retailer/core';

const parser = new XMLParser({
  ignoreAttributes: false,
  maxNestedTags: 10_000,
  processEntities: false,
});
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
 * Recursively walks a sitemap and yields page URLs. Handles the common shapes
 * found in the wild, since user-onboarded sites vary widely:
 *  - XML sitemap index (<sitemapindex>/<sitemap>/<loc>) — recursed into
 *  - XML URL set (<urlset>/<url>/<loc>)
 *  - RSS (<rss>/<channel>/<item>/<link>) and Atom (<feed>/<entry>/<link href>)
 *  - Plain-text sitemaps (one URL per line)
 *  - Gzipped variants of any of the above (.xml.gz / gzip body)
 *
 * `urlFilter` lets callers keep only product-detail URLs.
 */
export async function* walkSitemap(
  sitemapUrl: string,
  urlFilter: (url: string) => boolean,
  opts: WalkSitemapOptions = {},
): AsyncGenerator<string> {
  const depth = opts.depth ?? 0;
  if (depth > 5) return;

  const text = await fetchSitemapText(sitemapUrl, opts);
  if (text == null) return;

  // Plain-text sitemap: not XML, just URLs separated by newlines.
  if (!looksLikeXml(text)) {
    for (const url of parsePlainText(text)) {
      if (urlFilter(url)) yield url;
    }
    return;
  }

  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(text) as Record<string, unknown>;
  } catch (err) {
    log.warn('sitemap parse error, trying loc fallback', { sitemapUrl, err: String(err) });
    for (const url of parseLocFallback(text)) {
      if (urlFilter(url)) yield url;
    }
    return;
  }

  // Sitemap index → recurse into child sitemaps.
  const sitemapindex = doc.sitemapindex as { sitemap?: SitemapNode | SitemapNode[] } | undefined;
  if (sitemapindex?.sitemap) {
    const children = asArray<SitemapNode>(sitemapindex.sitemap);
    for (const child of children) {
      if (child.loc) {
        yield* walkSitemap(child.loc, urlFilter, { ...opts, depth: depth + 1 });
      }
    }
    return;
  }

  // Standard URL set → yield matching page URLs.
  const urlset = doc.urlset as { url?: SitemapNode | SitemapNode[] } | undefined;
  if (urlset?.url) {
    const urls = asArray<SitemapNode>(urlset.url);
    for (const u of urls) {
      if (u.loc && urlFilter(u.loc)) yield u.loc;
    }
    return;
  }

  // RSS feed used as a sitemap.
  const rss = doc.rss as { channel?: { item?: unknown } } | undefined;
  if (rss?.channel?.item) {
    for (const item of asArray<{ link?: unknown }>(rss.channel.item)) {
      const link = firstString(item.link);
      if (link && urlFilter(link)) yield link;
    }
    return;
  }

  // Atom feed used as a sitemap.
  const feed = doc.feed as { entry?: unknown } | undefined;
  if (feed?.entry) {
    for (const entry of asArray<{ link?: unknown }>(feed.entry)) {
      const link = atomLink(entry.link);
      if (link && urlFilter(link)) yield link;
    }
    return;
  }

  const fallback = parseLocFallback(text);
  if (fallback.length) {
    for (const url of fallback) {
      if (urlFilter(url)) yield url;
    }
    return;
  }

  log.warn('sitemap had no recognized URL container', { sitemapUrl });
}

/**
 * If `sitemapUrl` is a sitemap INDEX, return its child sitemap URLs; otherwise
 * return null. Lets callers sample across children for a diverse URL corpus
 * instead of draining the first child (which is often all one section).
 */
export async function getSitemapChildren(
  sitemapUrl: string,
  opts: WalkSitemapOptions = {},
): Promise<string[] | null> {
  const text = await fetchSitemapText(sitemapUrl, opts);
  if (text == null || !looksLikeXml(text)) return null;
  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
  const sitemapindex = doc.sitemapindex as { sitemap?: SitemapNode | SitemapNode[] } | undefined;
  if (!sitemapindex?.sitemap) return null;
  return asArray<SitemapNode>(sitemapindex.sitemap)
    .map((s) => s.loc)
    .filter((loc): loc is string => typeof loc === 'string');
}

/** Fetch a sitemap body as text, transparently gunzipping when needed. */
async function fetchSitemapText(
  sitemapUrl: string,
  opts: WalkSitemapOptions,
): Promise<string | null> {
  const browserFetch = opts.fetchText;

  try {
    const res = await fetch(sitemapUrl, {
      headers: {
        'user-agent': opts.userAgent ?? 'RetAIlerBot/0.1',
        accept: 'application/xml,text/xml,application/gzip,text/plain,*/*',
      },
    });
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      const decoded = decodeMaybeGzip(buf, sitemapUrl);
      if (looksLikeXml(decoded)) return decoded;
    }
  } catch (err) {
    log.warn('sitemap fetch error', { sitemapUrl, err: String(err) });
  }

  if (browserFetch) {
    try {
      const text = await browserFetch(sitemapUrl);
      if (text) return text;
    } catch (err) {
      log.warn('sitemap fetch error', { sitemapUrl, via: 'browser', err: String(err) });
    }
  }

  return null;
}

/** Gunzip when the body is a `.xml.gz` file or starts with the gzip magic bytes. */
function decodeMaybeGzip(buf: Buffer, url: string): string {
  const isGzip = buf.length > 1 && buf[0] === 0x1f && buf[1] === 0x8b;
  if (isGzip || /\.gz($|\?)/i.test(url)) {
    try {
      return gunzipSync(buf).toString('utf8');
    } catch (err) {
      log.warn('sitemap gunzip failed', { url, err: String(err) });
      // Fall through: maybe it wasn't actually gzipped.
    }
  }
  return buf.toString('utf8');
}

function looksLikeXml(text: string): boolean {
  const head = text.slice(0, 512).trimStart();
  return head.startsWith('<');
}

/** Regex fallback when fast-xml-parser chokes on huge Magento sitemaps. */
function parseLocFallback(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)) {
    const loc = m[1]?.trim();
    if (loc) out.push(loc);
  }
  return out;
}

function parsePlainText(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^https?:\/\//i.test(line));
}

/** RSS <item><link> is a plain string; Atom links are handled separately. */
function firstString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(firstString).find((v): v is string => !!v);
  return undefined;
}

/**
 * Atom <link> may be a string, an object with @_href, or an array of those.
 * Prefer rel="alternate" (the canonical page link) when present.
 */
function atomLink(value: unknown): string | undefined {
  const links = asArray<unknown>(value);
  const objs = links.filter((l): l is Record<string, unknown> => typeof l === 'object' && l !== null);
  const alternate = objs.find((l) => l['@_rel'] === 'alternate' || l['@_rel'] === undefined);
  const chosen = alternate ?? objs[0];
  if (chosen && typeof chosen['@_href'] === 'string') return chosen['@_href'];
  return firstString(value);
}

function asArray<T>(value: T | T[]): T[] {
  return Array.isArray(value) ? value : [value];
}
