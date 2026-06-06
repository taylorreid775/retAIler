import * as cheerio from 'cheerio';
import robotsParser from 'robots-parser';
import { createLogger } from '@retailer/core';
import { getSitemapChildren, walkSitemap } from './sitemap';
import { extractFromJsonLd } from './extract/structured';

const log = createLogger('crawler:discovery');

const DEFAULT_UA = 'RetAIlerBot/0.1 (+https://retailer.example/bot)';

/** Known product-detail path tokens — used ONLY as weak priors / tie-breakers. */
const PRODUCT_PATH_PRIORS = [
  'products',
  'product',
  'prod',
  'pd',
  'dp',
  'ip',
  'item',
  'items',
  'shop',
  'buy',
  'detail',
  'pdp',
  'sku',
  'p',
];

/** Best-effort agent / LLM manifest filenames to probe (metadata only). */
const AGENT_FILE_CANDIDATES = [
  'llms.txt',
  'llms-full.txt',
  'ai.txt',
  '.well-known/llms.txt',
  '.well-known/ai.txt',
  '.well-known/ai-plugin.json',
];

/** Fallback sitemap filenames, tried only when nothing authoritative is found. */
const SITEMAP_NAME_CANDIDATES = [
  'sitemap.xml',
  'sitemap_index.xml',
  'sitemap-index.xml',
  'sitemap.xml.gz',
  'sitemap',
];

export interface SiteDiscovery {
  /** Slugified host, used as retailers.key. */
  key: string;
  name: string;
  /** Host (e.g. www.example.com). */
  domain: string;
  /** Normalized origin the user effectively submitted. */
  homepageUrl: string;
  sitemapUrl: string | null;
  /** Regex source string identifying product-detail URLs (or null if unknown). */
  productUrlPattern: string | null;
  /** A few confirmed product URLs (evidence). */
  sampleProductUrls: string[];
  /** 0..1: share of sampled candidates confirmed as products. */
  confidence: number;
  fetchStrategy: 'static' | 'browser';
  crawlDelayMs: number | null;
  llmsTxtUrl: string | null;
  agentFiles: string[];
  /** Human-readable summary of what was / was not found. */
  notes: string;
}

export interface DiscoverSiteOptions {
  /**
   * Browser fetch fallback (Playwright), injected when available. Lets discovery
   * confirm products on JS-rendered sites and decide a `browser` fetch strategy.
   */
  fetchText?: (url: string) => Promise<string | null>;
  /** Max candidate pages to fetch + classify. Default 30. */
  sampleLimit?: number;
  /** Max URLs to pull into the corpus before sampling. Default 400. */
  corpusLimit?: number;
  userAgent?: string;
}

/**
 * Discover everything needed to crawl an arbitrary store from its homepage URL.
 * Evidence-driven: it gathers a URL corpus from many sources, confirms products
 * by page CONTENT, then derives the URL pattern + fetch strategy from the
 * confirmed pages. Filenames / path tokens are only weak priors.
 */
export async function discoverSite(
  inputUrl: string,
  opts: DiscoverSiteOptions = {},
): Promise<SiteDiscovery> {
  const ua = opts.userAgent ?? DEFAULT_UA;
  const sampleLimit = opts.sampleLimit ?? 30;
  const corpusLimit = opts.corpusLimit ?? 400;

  const origin = normalizeOrigin(inputUrl);
  const host = new URL(origin).host;
  const notes: string[] = [];

  // ── robots.txt: sitemaps + crawl delay ──
  const robotsText = await fetchText(`${origin}/robots.txt`, ua);
  const robots = robotsText != null ? robotsParser(`${origin}/robots.txt`, robotsText) : null;
  const crawlDelaySec = robots?.getCrawlDelay(ua);
  const crawlDelayMs = typeof crawlDelaySec === 'number' ? crawlDelaySec * 1000 : null;
  const robotsSitemaps = robotsText ? parseRobotsSitemaps(robotsText) : [];
  if (robotsSitemaps.length) notes.push(`robots.txt listed ${robotsSitemaps.length} sitemap(s)`);

  // ── homepage: <link rel="sitemap"> + same-host nav links ──
  const homepageHtml = await fetchHtml(origin, ua, opts.fetchText);
  const homepageLinks: string[] = [];
  const linkRelSitemaps: string[] = [];
  if (homepageHtml) {
    const $ = cheerio.load(homepageHtml);
    $('link[rel="sitemap"]').each((_, el) => {
      const href = $(el).attr('href');
      if (href) linkRelSitemaps.push(absolute(href, origin));
    });
    homepageLinks.push(...sameHostAnchors($, origin, host));
  } else {
    notes.push('homepage fetch returned no HTML');
  }

  // ── resolve a working sitemap (authoritative first, then probe) ──
  const sitemapCandidates = dedupe([
    ...robotsSitemaps,
    ...linkRelSitemaps,
    ...SITEMAP_NAME_CANDIDATES.map((n) => `${origin}/${n}`),
  ]);

  let sitemapUrl: string | null = null;
  let corpus: string[] = [];
  for (const candidate of sitemapCandidates) {
    const urls = await collectFromSitemap(candidate, corpusLimit, opts.fetchText, ua);
    if (urls.length > 0) {
      sitemapUrl = candidate;
      corpus = urls;
      notes.push(`sitemap ${candidate} yielded ${urls.length} URL(s)`);
      break;
    }
  }

  // ── fallback: shallow BFS from the homepage when no sitemap works ──
  if (corpus.length === 0) {
    notes.push('no usable sitemap; falling back to homepage link crawl');
    corpus = await shallowCrawl(origin, host, ua, opts.fetchText, homepageLinks, corpusLimit);
  }

  // ── classify a spread of candidates by content ──
  const sample = spread(corpus, sampleLimit);
  const confirmed: string[] = [];
  let confirmedViaBrowserOnly = false;
  let staticConfirmed = false;

  for (const url of sample) {
    const staticHtml = await fetchText(url, ua);
    if (staticHtml && hasProductSignals(staticHtml, url)) {
      confirmed.push(url);
      staticConfirmed = true;
      continue;
    }
    if (opts.fetchText) {
      const renderedHtml = await opts.fetchText(url);
      if (renderedHtml && hasProductSignals(renderedHtml, url)) {
        confirmed.push(url);
        confirmedViaBrowserOnly = true;
      }
    }
  }

  const confidence = sample.length ? confirmed.length / sample.length : 0;
  const productUrlPattern = deriveProductPattern(confirmed);
  const fetchStrategy: 'static' | 'browser' =
    staticConfirmed || (!confirmedViaBrowserOnly && !opts.fetchText) ? 'static' : 'browser';

  if (confirmed.length === 0) {
    notes.push('no product pages confirmed in sampled candidates');
  } else {
    notes.push(
      `confirmed ${confirmed.length}/${sample.length} sampled page(s) as products` +
        (productUrlPattern ? ` (pattern ${productUrlPattern})` : ''),
    );
  }

  // ── best-effort agent / LLM files (metadata only) ──
  const agentFiles: string[] = [];
  for (const name of AGENT_FILE_CANDIDATES) {
    const fileUrl = `${origin}/${name}`;
    if (await urlExists(fileUrl, ua)) agentFiles.push(fileUrl);
  }
  const llmsTxtUrl = agentFiles.find((f) => /llms\.txt$/i.test(f)) ?? null;
  if (agentFiles.length) notes.push(`found agent file(s): ${agentFiles.join(', ')}`);

  return {
    key: slugifyHost(host),
    name: prettyName(host),
    domain: host,
    homepageUrl: origin,
    sitemapUrl,
    productUrlPattern,
    sampleProductUrls: confirmed.slice(0, 5),
    confidence,
    fetchStrategy,
    crawlDelayMs,
    llmsTxtUrl,
    agentFiles,
    notes: notes.join('; '),
  };
}

// ─── URL corpus helpers ───────────────────────────────────────────────────

async function collectFromSitemap(
  sitemapUrl: string,
  limit: number,
  fetchTextOverride: ((url: string) => Promise<string | null>) | undefined,
  ua: string,
): Promise<string[]> {
  const walkOpts = { fetchText: fetchTextOverride, userAgent: ua };
  try {
    // For a sitemap index, sample evenly across child sitemaps so the corpus
    // spans products / brands / categories instead of just the first section.
    const children = await getSitemapChildren(sitemapUrl, walkOpts);
    if (children && children.length > 1) {
      const MAX_CHILDREN = 12;
      const chosen = spread(children, MAX_CHILDREN);
      const perChild = Math.max(5, Math.ceil(limit / chosen.length));
      const out: string[] = [];
      for (const child of chosen) {
        let n = 0;
        for await (const url of walkSitemap(child, () => true, walkOpts)) {
          out.push(url);
          if (++n >= perChild || out.length >= limit) break;
        }
        if (out.length >= limit) break;
      }
      return out;
    }

    const out: string[] = [];
    for await (const url of walkSitemap(sitemapUrl, () => true, walkOpts)) {
      out.push(url);
      if (out.length >= limit) break;
    }
    return out;
  } catch (err) {
    log.warn('sitemap collection failed', { sitemapUrl, err: String(err) });
    return [];
  }
}

/** Depth<=2 BFS from the homepage, bounded by a small page cap. */
async function shallowCrawl(
  origin: string,
  host: string,
  ua: string,
  fetchTextOverride: ((url: string) => Promise<string | null>) | undefined,
  seedLinks: string[],
  limit: number,
): Promise<string[]> {
  const PAGE_FETCH_CAP = 8;
  const found = new Set<string>(seedLinks);
  const frontier = seedLinks.slice(0, PAGE_FETCH_CAP);
  let fetches = 0;

  for (const pageUrl of frontier) {
    if (fetches >= PAGE_FETCH_CAP || found.size >= limit) break;
    fetches += 1;
    const html = (await fetchText(pageUrl, ua)) ?? (await fetchTextOverride?.(pageUrl)) ?? null;
    if (!html) continue;
    const $ = cheerio.load(html);
    for (const link of sameHostAnchors($, origin, host)) {
      found.add(link);
      if (found.size >= limit) break;
    }
  }
  return [...found];
}

function sameHostAnchors($: cheerio.CheerioAPI, origin: string, host: string): string[] {
  const links = new Set<string>();
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:'))
      return;
    try {
      const abs = new URL(href, origin);
      if (abs.host === host && /^https?:$/.test(abs.protocol)) {
        abs.hash = '';
        links.add(abs.toString());
      }
    } catch {
      // ignore malformed hrefs
    }
  });
  return [...links];
}

// ─── Product classification ─────────────────────────────────────────────

/**
 * Content signals that a page is a *product detail page* (not a listing/brand
 * page). We require evidence of a single purchasable product — a Product with a
 * price — which is what the crawler's extractor can actually turn into a row.
 * Loose "mentions a Product type" matching wrongly accepts category/brand pages
 * that embed an ItemList of products.
 */
export function hasProductSignals(html: string, url = 'about:blank'): boolean {
  const $ = cheerio.load(html);

  // Strongest signal: schema.org Product / ProductGroup with a price (covers
  // Shopify-style ProductGroup + variant offers, which the row extractor skips).
  const ldBlocks = $('script[type="application/ld+json"]')
    .map((_, el) => $(el).contents().text())
    .get();
  for (const raw of ldBlocks) {
    if (jsonLdHasPricedProduct(raw)) return true;
  }

  // Fallback: the row extractor parses a Product with a price.
  const extracted = extractFromJsonLd(html, url, 'discovery');
  if (extracted && extracted.price != null) return true;

  // Open Graph product type backed by a price meta (specific to PDPs).
  const ogType = $('meta[property="og:type"]').attr('content')?.toLowerCase() ?? '';
  const hasPriceMeta =
    $('meta[property="product:price:amount"], meta[property="og:price:amount"]').length > 0;
  if (ogType.includes('product') && hasPriceMeta) return true;

  return false;
}

function jsonLdHasPricedProduct(raw: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }
  return findPricedProduct(parsed);
}

function findPricedProduct(node: unknown, depth = 0): boolean {
  if (depth > 7 || !node || typeof node !== 'object') return false;
  if (Array.isArray(node)) return node.some((n) => findPricedProduct(n, depth + 1));
  const obj = node as Record<string, unknown>;

  const type = obj['@type'];
  const types = (Array.isArray(type) ? type : [type]).filter(
    (t): t is string => typeof t === 'string',
  );
  const isProduct = types.some((t) => /^Product(Group|Model)?$/i.test(t));
  if (isProduct && hasPriceSomewhere(obj)) return true;

  const graph = obj['@graph'];
  if (graph && findPricedProduct(graph, depth + 1)) return true;
  return false;
}

/** A price in offers / aggregateOffer / variant offers signals a real PDP. */
function hasPriceSomewhere(node: unknown, depth = 0): boolean {
  if (depth > 6 || !node || typeof node !== 'object') return false;
  if (Array.isArray(node)) return node.some((n) => hasPriceSomewhere(n, depth + 1));
  const obj = node as Record<string, unknown>;
  for (const key of ['price', 'lowPrice', 'highPrice']) {
    const v = obj[key];
    if ((typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.trim() !== ''))
      return true;
  }
  for (const key of ['offers', 'hasVariant', 'aggregateOffer', 'aggregateOffers']) {
    if (key in obj && hasPriceSomewhere(obj[key], depth + 1)) return true;
  }
  return false;
}

// ─── Pattern derivation ───────────────────────────────────────────────────

/** Two-letter language or locale segment, e.g. `en`, `fr`, `en-ca`, `en_us`. */
const LOCALE_SEG = /^[a-z]{2}([-_][a-z]{2})?$/;

/** Derive a product-URL regex source from the CONFIRMED product URLs. */
export function deriveProductPattern(confirmedUrls: string[]): string | null {
  if (confirmedUrls.length === 0) return null;

  const segArrays: string[][] = [];
  for (const u of confirmedUrls) {
    try {
      const segs = new URL(u).pathname
        .split('/')
        .filter(Boolean)
        .map((s) => s.toLowerCase());
      // Drop a leading locale segment so /en/p/x and /fr/p/x align. The chosen
      // pattern is still a substring match, so it keeps matching localized URLs.
      if (segs.length > 1 && LOCALE_SEG.test(segs[0]!)) segs.shift();
      segArrays.push(segs);
    } catch {
      // skip
    }
  }
  if (segArrays.length === 0) return null;

  const counts = new Map<string, number>();
  for (const segs of segArrays) {
    for (const s of new Set(segs)) counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  const majority = Math.ceil(segArrays.length / 2);

  // 1) Longest common leading path segments (e.g. /shop/item/...), but reject a
  //    prefix that is just one short/generic segment — that's usually a section
  //    (locale, /en/, /c/) rather than a product marker.
  const lcp = longestCommonPrefix(segArrays);
  const lcpSpecific = lcp.length >= 2 || (lcp.length === 1 && lcp[0]!.length >= 4);
  if (lcpSpecific) return `/${lcp.join('/')}/`;

  // 2) Highest-frequency known product token present in a majority of URLs.
  let best: string | null = null;
  let bestCount = -1;
  for (const prior of PRODUCT_PATH_PRIORS) {
    const c = counts.get(prior) ?? 0;
    if (c >= majority && c > bestCount) {
      best = prior;
      bestCount = c;
    }
  }
  if (best) return `/${best}/`;

  // 3) Fall back to the (possibly short) common prefix if there was one.
  if (lcp.length > 0) return `/${lcp.join('/')}/`;

  // 4) Any non-trivial segment shared by a majority of URLs.
  for (const [seg, c] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    if (c >= majority && seg.length >= 2) return `/${seg}/`;
  }

  return null;
}

function longestCommonPrefix(segArrays: string[][]): string[] {
  if (segArrays.length === 0) return [];
  const first = segArrays[0]!;
  const prefix: string[] = [];
  for (let i = 0; i < first.length; i += 1) {
    const seg = first[i]!;
    if (segArrays.every((arr) => arr[i] === seg)) prefix.push(seg);
    else break;
  }
  // Drop a trailing slug-like segment that happened to match (rare); keep it
  // only if all URLs share more than the slug. A pure LCP equal to full paths
  // means identical URLs — guard against that.
  if (prefix.length === first.length) prefix.pop();
  return prefix;
}

// ─── Low-level fetch helpers ───────────────────────────────────────────────

async function fetchText(url: string, ua: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': ua, accept: 'text/html,application/xhtml+xml,text/plain,*/*' },
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/** Fetch HTML, escalating to the browser fallback when static looks like a JS shell. */
async function fetchHtml(
  url: string,
  ua: string,
  fetchTextOverride: ((url: string) => Promise<string | null>) | undefined,
): Promise<string | null> {
  const staticHtml = await fetchText(url, ua);
  if (staticHtml && staticHtml.length > 1000) return staticHtml;
  if (fetchTextOverride) {
    const rendered = await fetchTextOverride(url);
    if (rendered) return rendered;
  }
  return staticHtml;
}

async function urlExists(url: string, ua: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'user-agent': ua },
      redirect: 'follow',
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ─── Misc utilities ────────────────────────────────────────────────────────

function parseRobotsSitemaps(robotsText: string): string[] {
  const out: string[] = [];
  const re = /^\s*sitemap:\s*(\S+)\s*$/gim;
  let m: RegExpExecArray | null;
  while ((m = re.exec(robotsText)) !== null) {
    if (m[1]) out.push(m[1]);
  }
  return out;
}

function normalizeOrigin(input: string): string {
  const withProto = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  return new URL(withProto).origin;
}

function absolute(href: string, origin: string): string {
  try {
    return new URL(href, origin).toString();
  } catch {
    return href;
  }
}

function slugifyHost(host: string): string {
  return host
    .replace(/^www\./i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function prettyName(host: string): string {
  const base = host.replace(/^www\./i, '').split('.')[0] ?? host;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function dedupe(items: string[]): string[] {
  return [...new Set(items)];
}

/** Evenly sample up to `n` items spread across the array. */
function spread<T>(items: T[], n: number): T[] {
  if (items.length <= n) return [...items];
  const step = items.length / n;
  const out: T[] = [];
  for (let i = 0; i < n; i += 1) out.push(items[Math.floor(i * step)]!);
  return out;
}
