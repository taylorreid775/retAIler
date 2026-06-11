import * as cheerio from 'cheerio';
import robotsParser from 'robots-parser';
import { createLogger } from '@retailer/core';
import type { CrawlRecipe } from '@retailer/schema';
import { AGENT_FILE_CANDIDATES, buildCrawlRecipe, fetchAgentManifest } from './agent-manifest';
import { deriveRetailerKey, normalizeRetailerDomain } from './domain.js';
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

/** Fallback sitemap filenames, tried only when nothing authoritative is found. */
const SITEMAP_NAME_CANDIDATES = [
  'sitemap.xml',
  'sitemap_index.xml',
  'sitemap-index.xml',
  'sitemap.xml.gz',
  'sitemap',
  'media/sitemaps/sitemap.xml',
];

export interface SiteDiscovery {
  /** Slugified host, used as retailers.key. */
  key: string;
  name: string;
  /** Host (e.g. www.example.com). */
  domain: string;
  /** Normalized origin the user effectively submitted. */
  homepageUrl: string;
  /** Primary product-bearing sitemap (for display / back-compat). */
  sitemapUrl: string | null;
  /** All sitemaps confirmed to contain products — the crawl walks every one. */
  sitemapUrls: string[];
  /** Regex source string identifying product-detail URLs (or null if unknown). */
  productUrlPattern: string | null;
  /** A few confirmed product URLs (evidence). */
  sampleProductUrls: string[];
  /** 0..1: share of sampled candidates confirmed as products. */
  confidence: number;
  fetchStrategy: 'static' | 'browser' | 'jina_reader';
  crawlDelayMs: number | null;
  llmsTxtUrl: string | null;
  agentFiles: string[];
  /** Persisted crawl + extraction recipe for future scrapes. */
  crawlRecipe: CrawlRecipe;
  /** Human-readable summary of what was / was not found. */
  notes: string;
  /** Homepage HTML used for fingerprinting (not persisted). */
  homepageHtml: string | null;
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

  const origin = resolveStoreOrigin(inputUrl);
  const host = new URL(origin).host;
  const domain = normalizeRetailerDomain(host);
  const notes: string[] = [];

  // ── robots.txt: sitemaps + crawl delay ──
  const robotsText = await fetchText(`${origin}/robots.txt`, ua);
  const robots = robotsText != null ? robotsParser(`${origin}/robots.txt`, robotsText) : null;
  const crawlDelaySec = robots?.getCrawlDelay(ua);
  const crawlDelayMs = typeof crawlDelaySec === 'number' ? crawlDelaySec * 1000 : null;
  const robotsSitemaps = robotsText ? parseRobotsSitemaps(robotsText) : [];
  if (robotsSitemaps.length) notes.push(`robots.txt listed ${robotsSitemaps.length} sitemap(s)`);

  // ── agent manifest (llms.txt): authoritative sitemap + product hints ──
  const fetchAgentFile = (u: string) => fetchAgentFileText(u, ua, opts.fetchText);
  const agentManifest = await fetchAgentManifest(origin, fetchAgentFile);
  if (agentManifest) {
    notes.push(`parsed agent manifest at ${agentManifest.agentFileUrl}`);
    if (agentManifest.sitemapUrls.length) {
      notes.push(`agent manifest listed ${agentManifest.sitemapUrls.length} sitemap(s)`);
    }
  }

  // ── homepage: <link rel="sitemap"> + same-host nav links ──
  const homepageHtml = await fetchHtml(origin, ua, opts.fetchText);
  const homepageLinks: string[] = [];
  const linkRelSitemaps: string[] = [];
  if (homepageHtml) {
    const shutdown = detectSiteShutdown(homepageHtml);
    if (shutdown) notes.push(shutdown);
    const $ = cheerio.load(homepageHtml);
    $('link[rel="sitemap"]').each((_, el) => {
      const href = $(el).attr('href');
      if (href) linkRelSitemaps.push(absolute(href, origin));
    });
    homepageLinks.push(...sameHostAnchors($, origin, host));
    homepageLinks.push(...scrapeProductPathUrls(homepageHtml, origin, host));
  } else {
    notes.push('homepage fetch returned no HTML');
  }

  // ── resolve candidate sitemaps (authoritative first, then probe) ──
  // robots.txt often lists MANY sitemaps (categories, brands, products, …) as
  // separate top-level entries, so we must sample across all of them — not stop
  // at the first. Product-looking names are tried first to confirm quickly.
  const ctProductSitemap = host.endsWith('.ca')
    ? [`${origin}/sitemap_Product-en_CA-CAD.xml`, `${origin}/sitemap_product-en_CA-CAD.xml`]
    : [];

  const sitemapCandidates = prioritizeProductSitemaps(
    dedupe([
      ...ctProductSitemap,
      ...(agentManifest?.sitemapUrls ?? []),
      ...robotsSitemaps,
      ...linkRelSitemaps,
      ...SITEMAP_NAME_CANDIDATES.map((n) => `${origin}/${n}`),
    ]),
  );

  // ── build a corpus spread across multiple sitemaps, tracking provenance ──
  const MAX_SITEMAPS = 20;
  const chosenSitemaps = sitemapCandidates.slice(0, MAX_SITEMAPS);
  const perSitemap = Math.max(20, Math.ceil(corpusLimit / Math.max(1, chosenSitemaps.length)));
  const corpus: { url: string; sitemap: string }[] = [];
  const usedSitemaps = new Set<string>();
  for (const candidate of chosenSitemaps) {
    if (corpus.length >= corpusLimit) break;
    // Prefer static sitemap fetch; escalate to browser when static returns a
    // bot-wall HTML page (Atmosphere/Mark's index) while PDPs still need Playwright.
    const urls = await collectFromSitemap(candidate, perSitemap, opts.fetchText, ua);
    for (const u of urls) {
      corpus.push({ url: u, sitemap: candidate });
      usedSitemaps.add(candidate);
      if (corpus.length >= corpusLimit) break;
    }
  }
  if (usedSitemaps.size) {
    notes.push(`sampled ${corpus.length} URL(s) across ${usedSitemaps.size} sitemap(s)`);
  }

  // ── fallback: shallow BFS from the homepage when no sitemap works ──
  if (corpus.length === 0) {
    notes.push('no usable sitemap; falling back to homepage link crawl');
    const localeSeeds = host.endsWith('.ca') ? [`${origin}/en-CA`, `${origin}/fr-CA`] : [];
    const crawlSeeds = dedupe([origin, ...localeSeeds, ...homepageLinks]);
    const links = await shallowCrawl(origin, host, ua, opts.fetchText, crawlSeeds, corpusLimit);
    for (const u of links) corpus.push({ url: u, sitemap: '' });
  }

  // ── classify a spread of candidates by content ──
  const sample = spread(corpus, sampleLimit);
  const confirmed: string[] = [];
  const productSitemaps = new Set<string>();
  let confirmedViaBrowserOnly = false;
  let staticConfirmed = false;

  for (const entry of sample) {
    const staticHtml = await fetchText(entry.url, ua);
    if (staticHtml && hasProductSignals(staticHtml, entry.url)) {
      confirmed.push(entry.url);
      if (entry.sitemap) productSitemaps.add(entry.sitemap);
      staticConfirmed = true;
      continue;
    }
    if (opts.fetchText) {
      const renderedHtml = await opts.fetchText(entry.url);
      if (renderedHtml && hasProductSignals(renderedHtml, entry.url)) {
        confirmed.push(entry.url);
        if (entry.sitemap) productSitemaps.add(entry.sitemap);
        confirmedViaBrowserOnly = true;
      }
    }
  }

  // Bot-walled retailers (e.g. Walmart) block static and headless-browser
  // fetches with HTTP-200 challenge pages. When browser discovery was requested
  // and content checks found nothing, accept strong URL-path evidence from
  // product-named sitemaps (e.g. /en/ip/... from sitemap-product-*.xml).
  if (confirmed.length === 0) {
    let evidence = pickBestProductUrls(corpus, sampleLimit);
    if (evidence.length < 3) {
      const htmlUrls = confirmFromHtmlProductEvidence(corpus, sampleLimit);
      evidence = pickBestProductUrls(
        htmlUrls.map((url) => ({ url, sitemap: '' })),
        sampleLimit,
      );
    }
    if (evidence.length >= 3) {
      const reachable = await resolveReachableSamples(evidence, ua);
      const finalEvidence = reachable.length >= 3 ? reachable : evidence;
      if (reachable.length < evidence.length) {
        notes.push(
          `dropped ${evidence.length - reachable.length} unreachable short product URL(s); using canonical paths`,
        );
      }
      for (const url of finalEvidence) {
        confirmed.push(url);
        const entry = corpus.find((e) => e.url === url);
        if (entry?.sitemap) productSitemaps.add(entry.sitemap);
      }
      if (!staticConfirmed && opts.fetchText) confirmedViaBrowserOnly = true;
      notes.push(
        `confirmed ${finalEvidence.length} URL(s) via sitemap path evidence (content fetch blocked)`,
      );
    }
  }

  const confidence =
    confirmed.length > 0
      ? sample.length
        ? confirmed.length / sample.length
        : 1
      : 0;
  const productUrlPattern =
    deriveProductPattern(confirmed) ??
    (confirmed.length === 0 ? null : agentManifest?.productUrlPatterns[0]) ??
    null;

  // Sitemaps that produced a confirmed product are what the crawl should walk.
  const sitemapUrls = [...productSitemaps];
  const sitemapUrl = sitemapUrls[0] ?? [...usedSitemaps][0] ?? null;
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

  const agentFiles = await listAgentFiles(origin, fetchAgentFile);
  const llmsTxtUrl =
    agentManifest?.agentFileUrl ??
    agentFiles.find((f) => /llms(-full)?\.txt$/i.test(f)) ??
    null;

  const crawlRecipe = buildCrawlRecipe({
    agent: agentManifest,
    robotsSitemapCount: robotsSitemaps.length,
    sitemapUrls,
    productUrlPattern,
    sampleProductUrls: confirmed.slice(0, 5),
    fetchStrategy,
    confidence,
  });

  return {
    key: deriveRetailerKey(domain),
    name: prettyName(host),
    domain,
    homepageUrl: origin,
    sitemapUrl,
    sitemapUrls,
    productUrlPattern,
    sampleProductUrls: confirmed.slice(0, 5),
    confidence,
    fetchStrategy,
    crawlDelayMs,
    llmsTxtUrl,
    agentFiles,
    crawlRecipe,
    notes: notes.join('; '),
    homepageHtml,
  };
}

async function listAgentFiles(
  origin: string,
  fetchAgentFile: (url: string) => Promise<string | null>,
): Promise<string[]> {
  const agentFiles: string[] = [];
  for (const name of AGENT_FILE_CANDIDATES) {
    const fileUrl = `${origin}/${name}`;
    const text = await fetchAgentFile(fileUrl);
    if (text && text.length >= 20) agentFiles.push(fileUrl);
  }
  return agentFiles;
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
      const ranked = [...children].sort((a, b) => scoreSitemapChild(b) - scoreSitemapChild(a));
      const chosen = spread(ranked, MAX_CHILDREN);
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
    for (const link of scrapeProductPathUrls(html, origin, host)) {
      found.add(link);
      if (found.size >= limit) break;
    }
  }
  return [...found];
}

/**
 * Extract product-detail URLs embedded in JS bundles or JSON (e.g. Sports
 * Experts `/en-CA/p-{slug}/{id}/{variant}`) when anchors are not present.
 */
function scrapeProductPathUrls(html: string, origin: string, host: string): string[] {
  const out = new Set<string>();
  const re = /\/(?:[a-z]{2}-[A-Z]{2}\/)?p-[a-z0-9][\w-]*(?:\/\d+)+/gi;
  for (const match of html.matchAll(re)) {
    try {
      const abs = new URL(match[0], origin);
      if (abs.host === host) out.add(abs.toString());
    } catch {
      // ignore
    }
  }
  return [...out];
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

  // 2) Category-nested PDPs (Salesforce / Canadian Tire family: /en/cat/dept/.../slug.html).
  const catCount = segArrays.filter((arr) => arr.includes('cat')).length;
  if (catCount >= majority) {
    const catPrefixes = segArrays
      .filter((arr) => arr.includes('cat'))
      .map((arr) => {
        const idx = arr.indexOf('cat');
        return arr.slice(idx, Math.min(idx + 2, arr.length - 1));
      });
    const catLcp = longestCommonPrefix(catPrefixes);
    if (catLcp.length >= 1) return `/${catLcp.join('/')}/`;
    return '/cat/';
  }

  // 3) Sports Experts / similar: segment starts with p- (e.g. /fr-CA/p-hikelite.../id/id).
  const pSlugCount = segArrays.filter((arr) => arr.some((s) => s.startsWith('p-'))).length;
  if (pSlugCount >= majority) return '/p-/';

  // 4) Highest-frequency known product token present in a majority of URLs.
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

  // 5) Fall back to the (possibly short) common prefix if there was one.
  if (lcp.length > 0) return `/${lcp.join('/')}/`;

  // 6) Any non-trivial segment shared by a majority of URLs.
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

/** Agent manifests (llms.txt) are often short — do not use the HTML length gate. */
async function fetchAgentFileText(
  url: string,
  ua: string,
  fetchTextOverride: ((url: string) => Promise<string | null>) | undefined,
): Promise<string | null> {
  const staticText = await fetchText(url, ua, 25_000);
  if (staticText && staticText.length >= 20) return staticText;
  if (fetchTextOverride) {
    const rendered = await fetchTextOverride(url);
    if (rendered && rendered.length >= 20) return rendered;
  }
  return staticText;
}

async function fetchText(
  url: string,
  ua: string,
  timeoutMs = 15_000,
): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': ua, accept: 'text/html,application/xhtml+xml,text/plain,*/*' },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
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

// ─── Misc utilities ────────────────────────────────────────────────────────

/**
 * Order sitemap URLs so product-looking ones are sampled first (e.g.
 * `sitemap-product-1p-en.xml` before `sitemap-categories.xml`). Pure ordering
 * hint — non-product sitemaps are still sampled, just later.
 */
/** Product-detail path tokens seen across major retailers. */
const PRODUCT_PATH_RE = /\/(?:p-|p\/|pdp\/|products?\/|ip\/|item\/|sku\/)/i;

/** Common user typos / marketing-site → shop redirects. */
const DOMAIN_ALIASES: Record<string, string> = {
  'www.national-sports.com': 'https://www.nationalsports.com',
  'national-sports.com': 'https://www.nationalsports.com',
  'www.runningroom.com': 'https://ca.shop.runningroom.com',
  'runningroom.com': 'https://ca.shop.runningroom.com',
};

/** Score product URL candidates — prefer category-nested canonical paths over short /pdp/ stubs. */
export function rankProductCandidateUrl(url: string, sitemap = ''): number {
  try {
    const path = new URL(url).pathname.toLowerCase();
    const segs = path.split('/').filter(Boolean);
    let score = Math.min(segs.length, 10);
    if (segs.includes('cat') || /\/cat\//.test(path)) score += 50;
    if (/\.html?$/.test(path)) score += 8;
    if (/\/pdp\//.test(path) && segs.length <= 3) score -= 35;
    if (sitemap && /product/i.test(sitemap)) score += 5;
    return score;
  } catch {
    return -100;
  }
}

function productSlugKey(url: string): string | null {
  try {
    const leaf = new URL(url).pathname.split('/').filter(Boolean).pop() ?? '';
    const id = leaf.match(/(\d{6,}[a-z]?)(?:\.html?)?$/i);
    if (id) return id[1]!.toLowerCase();
    return leaf.toLowerCase() || null;
  } catch {
    return null;
  }
}

/**
 * When PDP HTML cannot be fetched (bot wall), pick the best URL per product id
 * from sitemap corpus — canonical /cat/... paths beat broken /pdp/ shortcuts.
 */
function pickBestProductUrls(
  corpus: { url: string; sitemap: string }[],
  limit: number,
): string[] {
  const candidates = corpus.filter((e) => {
    if (!PRODUCT_PATH_RE.test(e.url)) return false;
    if (!e.sitemap || /product/i.test(e.sitemap)) return true;
    // Index sitemaps (sitemap.xml) often embed product URLs alongside other types.
    return /\/cat\//.test(e.url) || rankProductCandidateUrl(e.url, e.sitemap) >= 10;
  });
  const bestByKey = new Map<string, { url: string; score: number }>();
  for (const e of candidates) {
    const key = productSlugKey(e.url) ?? e.url;
    const score = rankProductCandidateUrl(e.url, e.sitemap);
    const prev = bestByKey.get(key);
    if (!prev || score > prev.score) bestByKey.set(key, { url: e.url, score });
  }
  const ranked = [...bestByKey.values()]
    .sort((a, b) => b.score - a.score)
    .map((e) => e.url);
  if (ranked.length < 3) return [];
  return spread(ranked, Math.min(limit, 10));
}

async function resolveReachableSamples(urls: string[], ua: string): Promise<string[]> {
  const out: string[] = [];
  for (const url of urls) {
    if (await urlReturnsOk(url, ua)) out.push(url);
  }
  return out;
}

async function urlReturnsOk(url: string, ua: string): Promise<boolean> {
  try {
    let res = await fetch(url, {
      method: 'HEAD',
      headers: { 'user-agent': ua },
      redirect: 'follow',
      signal: AbortSignal.timeout(12_000),
    });
    if (res.status === 405 || res.status === 501) {
      res = await fetch(url, {
        method: 'GET',
        headers: { 'user-agent': ua, Range: 'bytes=0-0' },
        redirect: 'follow',
        signal: AbortSignal.timeout(12_000),
      });
    }
    return res.ok;
  } catch {
    return false;
  }
}

const CATEGORY_HTML_TOKENS =
  /\/(brands|sale|apparel|gear|men|women|kids|accessories|nutrition|clearance|store-locator|our-story|rr)\//i;

/** Magento-style flat .html product URLs (Running Room and similar). */
function confirmFromHtmlProductEvidence(
  corpus: { url: string; sitemap: string }[],
  limit: number,
): string[] {
  const urls = dedupe(
    corpus
      .filter((e) => {
        try {
          const u = new URL(e.url);
          const path = u.pathname.toLowerCase();
          const segs = path.split('/').filter(Boolean);
          const leaf = segs[segs.length - 1] ?? '';
          return (
            /\.html?(\?|$)/.test(path) &&
            !CATEGORY_HTML_TOKENS.test(path) &&
            !/\/(c\/|category|catalogsearch|checkout|customer|cart|account)\//.test(path) &&
            segs.length >= 2 &&
            segs.length <= 4 &&
            leaf.length >= 12 &&
            !/^(brands|sale|index)\.html$/.test(leaf)
          );
        } catch {
          return false;
        }
      })
      .map((e) => e.url),
  );
  if (urls.length < 5) return [];
  return spread(urls, Math.min(limit, 10));
}

function detectSiteShutdown(html: string): string | null {
  const head = html.slice(0, 8000).toLowerCase();
  if (head.includes('consolidation notice') || head.includes('no longer operating')) {
    return 'site appears closed or consolidated (store may no longer sell products online)';
  }
  return null;
}

/** Prefer product-bearing child sitemaps (e.g. sitemap_Product-en_CA-CAD.xml). */
function scoreSitemapChild(url: string): number {
  const u = url.toLowerCase();
  if (/(product|\/pdp|item-detail)/.test(u)) return 3;
  if (/(category|brand|collection|page)/.test(u)) return 0;
  return 1;
}

function prioritizeProductSitemaps(candidates: string[]): string[] {
  const score = (url: string): number => {
    const u = url.toLowerCase();
    if (/(product|\/ip[-/]|item|\/p[-/]|pdp|\bsku\b)/.test(u)) return 0;
    if (/(category|categories|collection|brand|page|topic|article|blog)/.test(u)) return 2;
    return 1;
  };
  return [...candidates].sort((a, b) => score(a) - score(b));
}

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

/** Map marketing domains to the storefront origin users intend to track. */
function resolveStoreOrigin(input: string): string {
  const withProto = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  const host = new URL(withProto).host.toLowerCase();
  const alias = DOMAIN_ALIASES[host];
  if (alias) return new URL(alias).origin;
  return normalizeOrigin(input);
}

function absolute(href: string, origin: string): string {
  try {
    return new URL(href, origin).toString();
  } catch {
    return href;
  }
}

function prettyName(host: string): string {
  const base = normalizeRetailerDomain(host).split('.')[0] ?? host;
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
