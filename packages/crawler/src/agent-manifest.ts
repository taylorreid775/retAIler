import type { CrawlRecipe } from '@retailer/schema';

/** Filenames to try, most informative first. */
export const AGENT_FILE_CANDIDATES = [
  'llms-full.txt',
  'llms.txt',
  '.well-known/llms.txt',
  'ai.txt',
  '.well-known/ai.txt',
  '.well-known/ai-plugin.json',
] as const;

export interface AgentManifestHints {
  agentFileUrl: string;
  sitemapUrls: string[];
  productUrlPatterns: string[];
  listingUrlPatterns: string[];
  sampleProductUrls: string[];
  apiUrls: string[];
  platform: CrawlRecipe['platform'];
  extractionStrategy: CrawlRecipe['extractionStrategy'];
  extractionHints: CrawlRecipe['extractionHints'];
  prefersBrowser: boolean;
  notes: string[];
}

const URL_RE = /https?:\/\/[^\s)\]"'<>]+/gi;
const PRODUCT_PATH_TOKENS = ['products', 'product', 'ip', 'p', 'item', 'sku', 'dp', 'pd'];

/**
 * Fetch and parse the best available agent manifest (llms.txt, etc.).
 * Returns null when no file exists or content is empty.
 */
export async function fetchAgentManifest(
  origin: string,
  fetchText: (url: string) => Promise<string | null>,
): Promise<AgentManifestHints | null> {
  for (const name of AGENT_FILE_CANDIDATES) {
    const url = `${origin}/${name}`;
    const text = await fetchText(url);
    if (!text || text.length < 20) continue;
    const hints = parseAgentManifest(text, origin, url);
    if (hints.sitemapUrls.length || hints.productUrlPatterns.length || hints.sampleProductUrls.length) {
      return hints;
    }
    // Keep a weak hit (file exists) for notes even if sparse.
    if (text.length > 80) return hints;
  }
  return null;
}

/** Parse llms.txt / agent manifest markdown into crawl hints. */
export function parseAgentManifest(text: string, origin: string, fileUrl: string): AgentManifestHints {
  const notes: string[] = [];
  const urls = extractUrls(text, origin);
  const lower = text.toLowerCase();

  const sitemapUrls = dedupe(urls.filter(isSitemapUrl));
  const apiUrls = dedupe(urls.filter((u) => /\/api\/|graphql|\.json(?:\?|$)/i.test(u)));

  const productUrlPatterns = dedupe([
    ...extractPathPatterns(text),
    ...urls
      .filter((u) => isProductDetailUrl(u) && !isSitemapUrl(u))
      .map((u) => pathPatternFromUrl(u)),
  ]).filter(Boolean) as string[];

  const sampleProductUrls = dedupe(urls.filter(isProductDetailUrl)).slice(0, 8);
  const listingUrlPatterns = dedupe(
    urls
      .filter((u) => /\/(collections?|categories|shop|browse)\//i.test(u))
      .map((u) => pathPatternFromUrl(u)),
  ).filter(Boolean) as string[];

  const platform = detectPlatform(lower, urls);
  if (platform !== 'unknown') notes.push(`platform: ${platform}`);

  const extractionStrategy: CrawlRecipe['extractionStrategy'] =
    lower.includes('__next_data__') || lower.includes('next.js') || platform === 'bigcommerce'
      ? 'next_data'
      : lower.includes('json-ld') || lower.includes('schema.org')
        ? 'json_ld'
        : 'json_ld';

  const extractionHints = defaultExtractionHints(platform);
  const prefersBrowser =
    lower.includes('javascript') ||
    lower.includes('client-rendered') ||
    lower.includes('playwright') ||
    platform === 'bigcommerce';

  if (sitemapUrls.length) notes.push(`agent manifest listed ${sitemapUrls.length} sitemap(s)`);
  if (productUrlPatterns.length) notes.push(`agent manifest suggested product pattern(s)`);

  return {
    agentFileUrl: fileUrl,
    sitemapUrls,
    productUrlPatterns,
    listingUrlPatterns,
    sampleProductUrls,
    apiUrls,
    platform,
    extractionStrategy,
    extractionHints,
    prefersBrowser,
    notes,
  };
}

/** Merge agent hints + evidence-driven discovery into a persisted crawl recipe. */
export function buildCrawlRecipe(params: {
  agent: AgentManifestHints | null;
  robotsSitemapCount: number;
  sitemapUrls: string[];
  productUrlPattern: string | null;
  sampleProductUrls: string[];
  fetchStrategy: 'static' | 'browser';
  confidence: number;
}): CrawlRecipe {
  const sources: CrawlRecipe['sources'] = [];
  const notes: string[] = [];

  if (params.agent) {
    sources.push('llms_txt');
    notes.push(...params.agent.notes);
  }
  if (params.robotsSitemapCount > 0) sources.push('robots_txt');
  sources.push('discovery');
  if (params.agent?.platform && params.agent.platform !== 'unknown') {
    sources.push('platform');
  }

  const sitemapUrls = dedupe([
    ...(params.agent?.sitemapUrls ?? []),
    ...params.sitemapUrls,
  ]);

  const productUrlPattern =
    params.productUrlPattern ?? params.agent?.productUrlPatterns[0] ?? null;

  const fetchStrategy =
    params.fetchStrategy === 'browser' || params.agent?.prefersBrowser
      ? 'browser'
      : params.fetchStrategy;

  let discoveryMode: CrawlRecipe['discoveryMode'] = 'sitemap';
  if (sitemapUrls.length === 0 && (params.agent?.listingUrlPatterns.length ?? 0) > 0) {
    discoveryMode = 'listing_pages';
  }
  if ((params.agent?.apiUrls.length ?? 0) > 0 && sitemapUrls.length === 0) {
    discoveryMode = 'api';
  }

  const agentBoost = params.agent && (params.agent.sitemapUrls.length > 0 || params.agent.productUrlPatterns.length > 0) ? 0.15 : 0;
  const confidence = Math.min(1, params.confidence + agentBoost);

  return {
    version: 1,
    sources,
    discoveryMode,
    sitemapUrls,
    productUrlPattern,
    listingUrlPattern: params.agent?.listingUrlPatterns[0] ?? null,
    fetchStrategy,
    extractionStrategy: params.agent?.extractionStrategy ?? 'json_ld',
    platform: params.agent?.platform ?? null,
    extractionHints: params.agent?.extractionHints ?? { imageJsonPaths: [], priceJsonPaths: [] },
    sampleProductUrls: dedupe([...params.sampleProductUrls, ...(params.agent?.sampleProductUrls ?? [])]).slice(0, 8),
    agentFileUrl: params.agent?.agentFileUrl ?? null,
    notes,
    confidence,
    api: null,
  };
}

function defaultExtractionHints(platform: CrawlRecipe['platform']): CrawlRecipe['extractionHints'] {
  if (platform === 'bigcommerce') {
    return {
      imageJsonPaths: ['images.0.urlOriginal', 'images.0.url_standard', 'images.0.url_zoom'],
      priceJsonPaths: ['price.value', 'customerGroupPrices.guest.price.lowPrice.value'],
    };
  }
  if (platform === 'shopify') {
    return {
      imageJsonPaths: ['featured_image', 'images.0', 'media.0.src'],
      priceJsonPaths: ['price', 'compare_at_price'],
    };
  }
  return { imageJsonPaths: [], priceJsonPaths: [] };
}

function detectPlatform(lower: string, urls: string[]): CrawlRecipe['platform'] {
  if (lower.includes('bigcommerce') || urls.some((u) => u.includes('bigcommerce.com'))) return 'bigcommerce';
  if (lower.includes('shopify') || urls.some((u) => u.includes('myshopify.com') || u.includes('cdn.shopify.com')))
    return 'shopify';
  if (lower.includes('salesforce') || lower.includes('demandware')) return 'salesforce';
  return 'unknown';
}

function extractUrls(text: string, origin: string): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(URL_RE)) {
    found.push(m[0]!.replace(/[.,;]+$/, ''));
  }
  // Markdown links: [label](url)
  for (const m of text.matchAll(/\]\(([^)]+)\)/g)) {
    const href = m[1]!.trim();
    found.push(absoluteUrl(href, origin));
  }
  return dedupe(found.filter((u) => u.startsWith('http')));
}

function extractPathPatterns(text: string): string[] {
  const patterns = new Set<string>();
  for (const m of text.matchAll(/\/[a-z0-9_*-]+(?:\/[a-z0-9_*-]+)+\/?/gi)) {
    const p = m[0]!;
    if (PRODUCT_PATH_TOKENS.some((t) => p.toLowerCase().includes(`/${t}/`))) {
      patterns.add(p.length > 40 ? p.slice(0, 40) : p);
    }
  }
  // Explicit pattern lines: /products/{handle}, /en/product/{sku}/
  for (const m of text.matchAll(/(?:product|pdp|detail)[^\n]*?(\/[\w/{}\[\]-]+)/gi)) {
    patterns.add(m[1]!.replace(/\{[^}]+\}/g, ''));
  }
  return [...patterns];
}

function isSitemapUrl(url: string): boolean {
  return /sitemap/i.test(url) || /\.xml(?:\.gz)?(?:\?|$)/i.test(url);
}

function isProductDetailUrl(url: string): boolean {
  try {
    const path = new URL(url).pathname.toLowerCase();
    return PRODUCT_PATH_TOKENS.some((t) => path.includes(`/${t}/`));
  } catch {
    return false;
  }
}

function pathPatternFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    // Keep first two segments as pattern anchor: /en/product, /products
    return `/${parts.slice(0, 2).join('/')}/`;
  } catch {
    return null;
  }
}

function absoluteUrl(href: string, origin: string): string {
  if (href.startsWith('http')) return href;
  if (href.startsWith('/')) return `${origin}${href}`;
  return `${origin}/${href}`;
}

function dedupe<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}
