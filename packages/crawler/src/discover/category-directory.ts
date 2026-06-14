import { generateObject } from 'ai';
import { extractionModel, createLogger } from '@retailer/core';
import {
  ListingPaginationSchema,
  type CrawlRecipe,
  type ListingPagination,
} from '@retailer/schema';
import { z } from 'zod';
import { fetchJinaMarkdown } from '../jina/fetcher';

const log = createLogger('crawler:category-directory');

export const CategoryEntrySchema = z.object({
  name: z.string(),
  url: z.string().url(),
  parentName: z.string().nullable().default(null),
});

export const CategoryDirectorySchema = z.object({
  categories: z.array(CategoryEntrySchema).min(1),
  productUrlPattern: z.string(),
  pagination: ListingPaginationSchema,
  confidence: z.number().min(0).max(1),
  notes: z.string().optional(),
});

export type CategoryDirectory = z.infer<typeof CategoryDirectorySchema>;

/** AI-safe schema — OpenAI structured output rejects z.string().url() and optional fields with defaults. */
const PaginationInferenceSchema = z.object({
  style: z.enum(['query_param', 'path_segment', 'link_rel', 'none']),
  paramName: z.union([z.string(), z.null()]),
  pathTemplate: z.union([z.string(), z.null()]),
  startPage: z.number().int().positive(),
  maxPages: z.number().int().positive(),
});

const CategoryDirectoryInferenceSchema = z.object({
  categories: z
    .array(
      z.object({
        name: z.string().describe('Display name of the category'),
        url: z.string().describe('Absolute HTTPS URL of the category listing page'),
        parentName: z.union([z.string(), z.null()]).describe('Parent category name, or null'),
      }),
    )
    .min(1),
  productUrlPattern: z
    .string()
    .describe('JavaScript regex source matching product detail URLs, not category pages'),
  pagination: PaginationInferenceSchema,
  confidence: z.number().min(0).max(1),
  notes: z.union([z.string(), z.null()]),
});

const CATEGORY_PATH_RE =
  /\/(cat|categories|collections|category|shop\/all|shop-all)\/|\/en\/cat\/|\/c\/(?!lp\/)/i;
const CATEGORY_EXCLUDE_RE =
  /(cart|wishlist|account|login|sign-?in|customer-service|check-order|\/pdp\/|truefit|affiliate|privacy|terms|robots|sitemap|\/lp\/|about-|application|sustainability|innovation)/i;
const MAX_HEURISTIC_CATEGORIES = 120;

export type CategoryDirectoryResult = {
  directory: CategoryDirectory;
  crawlRecipe: CrawlRecipe;
  usage?: { totalTokens: number };
};

export interface DiscoverCategoryDirectoryOptions {
  homepageUrl: string;
  domain: string;
  /** Pre-fetched homepage markdown; fetched via Jina when omitted. */
  homepageMarkdown?: string;
  /** Spot-check up to N category pages via Jina. Default 2. */
  spotCheckLimit?: number;
}

/**
 * Use AI + Jina homepage markdown to discover category/collection URLs and
 * site-wide pagination + product URL patterns.
 */
export async function discoverCategoryDirectory(
  opts: DiscoverCategoryDirectoryOptions,
): Promise<(CategoryDirectoryResult & { usage?: { totalTokens: number } }) | null> {
  const spotCheckLimit = opts.spotCheckLimit ?? 2;
  let markdown = opts.homepageMarkdown;

  if (!markdown) {
    const fetched = await fetchJinaMarkdown(opts.homepageUrl);
    if (!fetched?.markdown) {
      log.warn('Jina homepage fetch failed', { url: opts.homepageUrl });
      return null;
    }
    markdown = fetched.markdown;
  }

  const heuristic = extractCategoriesHeuristic(markdown, opts.domain);
  const trimmed = markdown.slice(0, 24_000);

  let directory: CategoryDirectory | null = null;
  let aiUsage: { totalTokens: number } | undefined;
  try {
    const { object, usage } = await generateObject({
      model: extractionModel(),
      schema: CategoryDirectoryInferenceSchema,
      system:
        'You analyze retail website navigation markdown and extract product category/collection ' +
        'listing URLs. Include top-level nav categories and major subcategories (max ~40). ' +
        'Exclude account, cart, blog, help, and non-shopping pages. ' +
        'productUrlPattern must be a JavaScript regex source string matching product detail pages ' +
        '(not category pages). Infer pagination style from how the site likely paginates listings.',
      prompt:
        `Retailer domain: ${opts.domain}\n` +
        `Homepage: ${opts.homepageUrl}\n\n` +
        `HEURISTIC HINT (${heuristic.categories.length} nav links found):\n` +
        heuristic.categories
          .slice(0, 25)
          .map((c) => `- ${c.name}: ${c.url}`)
          .join('\n') +
        `\n\nHOMEPAGE MARKDOWN:\n${trimmed}`,
    });
    directory = normalizeInferredDirectory(object);
    if (usage?.totalTokens) aiUsage = { totalTokens: usage.totalTokens };
  } catch (err) {
    log.warn('category directory AI failed, using heuristic fallback', { err: String(err) });
    directory = heuristic.categories.length >= 3 ? heuristic : null;
  }

  if (!directory) return null;

  const filtered = filterCategories(directory, opts.domain);
  if (!filtered.categories.length) {
    log.warn('no categories after host filter', { domain: opts.domain });
    return null;
  }

  if (!validateProductPattern(filtered.productUrlPattern)) {
    log.warn('invalid productUrlPattern', { pattern: filtered.productUrlPattern });
    return null;
  }

  const spotChecked = await spotCheckCategories(
    filtered,
    opts.domain,
    spotCheckLimit,
  );
  if (!spotChecked) {
    log.warn('category spot-check failed', { domain: opts.domain });
    return null;
  }

  const crawlRecipe: CrawlRecipe = {
    version: 1,
    sources: ['jina_reader'],
    discoveryMode: 'jina_categories',
    sitemapUrls: [],
    productUrlPattern: spotChecked.productUrlPattern,
    listingUrlPattern: null,
    fetchStrategy: 'jina_reader',
    extractionStrategy: 'json_ld',
    platform: null,
    extractionHints: { imageJsonPaths: [], priceJsonPaths: [] },
    sampleProductUrls: [],
    agentFileUrl: null,
    notes: spotChecked.notes ? [spotChecked.notes] : [],
    confidence: spotChecked.confidence,
    api: null,
    jina: {
      productUrlPattern: spotChecked.productUrlPattern,
      pagination: spotChecked.pagination,
      lastDiscoveredAt: new Date(),
    },
  };

  return { directory: spotChecked, crawlRecipe, usage: aiUsage };
}

/**
 * Extract category listing URLs from Jina homepage markdown without AI.
 * Parses nav markdown links and filters to likely product-listing paths.
 */
export function extractCategoriesHeuristic(markdown: string, domain: string): CategoryDirectory {
  const rootDomain = domain.split('.').slice(-2).join('.');
  const origin = `https://${domain}`;
  const categories: CategoryDirectory['categories'] = [];
  const seen = new Set<string>();

  for (const m of markdown.matchAll(/\[([^\]]{1,120})\]\(([^)]+)\)/g)) {
    const name = m[1]?.trim().replace(/\s+/g, ' ');
    const href = m[2]?.trim();
    if (!name || !href || name.length < 2) continue;
    if (/^(skip|search|sign in|wishlist|support|email sign up|order status)$/i.test(name)) {
      continue;
    }

    let url: string;
    try {
      url = href.startsWith('http') ? href : new URL(href, origin).toString();
      const host = new URL(url).host;
      if (!host.includes(rootDomain)) continue;
    } catch {
      continue;
    }

    if (CATEGORY_EXCLUDE_RE.test(url)) continue;
    if (!CATEGORY_PATH_RE.test(url)) continue;

    const norm = (url.split('#')[0] ?? url).replace(/\/$/, '');
    if (seen.has(norm)) continue;
    seen.add(norm);
    categories.push({ name, url: norm, parentName: null });
  }

  // Prefer deeper paths (more specific listing pages) and cap volume.
  categories.sort((a, b) => b.url.split('/').length - a.url.split('/').length);
  const capped = categories.slice(0, MAX_HEURISTIC_CATEGORIES);

  const pdpHits = (markdown.match(/\/pdp\//gi) ?? []).length;
  const productsHits = (markdown.match(/\/products\//gi) ?? []).length;
  const productUrlPattern =
    pdpHits >= productsHits && pdpHits > 0
      ? '/pdp/'
      : productsHits > 0
        ? '/products/'
        : '/product/';

  return {
    categories: capped,
    productUrlPattern,
    pagination: ListingPaginationSchema.parse({
      style: 'query_param',
      paramName: 'page',
      startPage: 1,
      maxPages: 50,
    }),
    confidence: capped.length >= 20 ? 0.85 : capped.length >= 5 ? 0.7 : 0.4,
    notes: `heuristic: ${capped.length} categories from Jina nav markdown`,
  };
}

function normalizeInferredDirectory(
  raw: z.infer<typeof CategoryDirectoryInferenceSchema>,
): CategoryDirectory {
  const categories = raw.categories
    .map((c) => {
      try {
        const u = new URL(c.url);
        return { ...c, url: u.toString().split('#')[0] ?? c.url };
      } catch {
        return null;
      }
    })
    .filter((c): c is CategoryDirectory['categories'][number] => c != null);

  const pagination = ListingPaginationSchema.parse({
    style: raw.pagination.style,
    paramName: raw.pagination.paramName,
    pathTemplate: raw.pagination.pathTemplate,
    startPage: raw.pagination.startPage,
    maxPages: raw.pagination.maxPages,
  });

  return {
    categories,
    productUrlPattern: raw.productUrlPattern,
    pagination,
    confidence: raw.confidence,
    notes: raw.notes ?? undefined,
  };
}

function filterCategories(directory: CategoryDirectory, domain: string): CategoryDirectory {
  const seen = new Set<string>();
  const categories = directory.categories.filter((c) => {
    try {
      const host = new URL(c.url).host;
      if (!host.includes(domain.replace(/^www\./, '')) && !domain.includes(host.replace(/^www\./, ''))) {
        return false;
      }
    } catch {
      return false;
    }
    const key = c.url.replace(/\/$/, '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { ...directory, categories };
}

function validateProductPattern(pattern: string): boolean {
  try {
    new RegExp(pattern, 'i');
    return pattern.length > 2;
  } catch {
    return false;
  }
}

/** Confirm 1–2 category pages contain links matching productUrlPattern. */
async function spotCheckCategories(
  directory: CategoryDirectory,
  domain: string,
  limit: number,
): Promise<CategoryDirectory | null> {
  const pattern = new RegExp(directory.productUrlPattern, 'i');
  // Prefer standard /cat/ listing pages over /shop-all/ mirrors for spot-check.
  const samples = [
    ...directory.categories.filter((c) => !/\/shop-all\//i.test(c.url)),
    ...directory.categories.filter((c) => /\/shop-all\//i.test(c.url)),
  ].slice(0, limit);
  let hits = 0;

  for (const cat of samples) {
    const fetched = await fetchJinaMarkdown(cat.url);
    if (!fetched?.markdown) continue;
    const links = extractMarkdownLinks(fetched.markdown);
    const productLinks = links.filter((u) => {
      try {
        return pattern.test(u) && new URL(u).host.includes(domain.split('.').slice(-2).join('.'));
      } catch {
        return false;
      }
    });
    // Also accept /pdp/ tokens embedded in markdown (nested Sport Chek cards).
    const pdpInMd = (fetched.markdown.match(new RegExp(pattern.source, 'i')) ?? []).length;
    if (productLinks.length > 0 || pdpInMd >= 3) hits += 1;
  }

  // Allow one spot-check miss (Jina 503s); require majority when multiple samples.
  const minHits = samples.length <= 1 ? 1 : Math.ceil(samples.length / 2);
  if (samples.length > 0 && hits < minHits) return null;

  const confidence =
    samples.length === 0
      ? directory.confidence
      : Math.min(directory.confidence, hits / samples.length);

  return { ...directory, confidence };
}

function extractMarkdownLinks(markdown: string): string[] {
  const urls: string[] = [];
  for (const m of markdown.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const u = m[1]?.trim();
    if (u?.startsWith('http')) urls.push(u);
  }
  return urls;
}

export function mergeJinaIntoCrawlRecipe(
  existing: CrawlRecipe,
  directory: CategoryDirectory,
): CrawlRecipe {
  return {
    ...existing,
    sources: [...new Set([...existing.sources, 'jina_reader' as const])],
    discoveryMode: 'jina_categories',
    productUrlPattern: directory.productUrlPattern,
    fetchStrategy: 'jina_reader',
    confidence: Math.max(existing.confidence, directory.confidence),
    notes: directory.notes ? [...existing.notes, directory.notes] : existing.notes,
    jina: {
      productUrlPattern: directory.productUrlPattern,
      pagination: directory.pagination,
      lastDiscoveredAt: new Date(),
    },
  };
}

export type { ListingPagination };
