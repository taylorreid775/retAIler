import { z } from 'zod';
import { CurrencySchema } from './common';

/** Pagination settings for API-based catalog discovery. */
export const ApiPaginationSchema = z.object({
  /** `page` increments 1,2,3…; `offset` uses (page-1)*itemsPerPage for start/offset params. */
  style: z.enum(['page', 'offset']).default('page'),
  pageParam: z.string().default('page'),
  itemsPerPage: z.number().int().positive().optional(),
  /** Dot-path to total page count (e.g. pagination.total). */
  totalPagesPath: z.string().nullable().optional(),
  maxPages: z.number().int().positive().default(100),
  delayMs: z.number().int().nonnegative().default(500),
});

export const ApiCategoryValueSchema = z.object({
  value: z.string(),
  label: z.string().optional(),
  key: z.string().optional(),
});

/** Optional dimension to iterate (e.g. Sport Chek `group=MEN`). */
export const ApiCategoryParamSchema = z.object({
  name: z.string(),
  values: z.array(ApiCategoryValueSchema).min(1),
});

/**
 * Generic replay config for retailer catalog/search APIs discovered at
 * onboarding (network sniff or manual recipe). No per-site TypeScript required.
 */
export const ApiRecipeSchema = z.object({
  baseUrl: z.string().url(),
  method: z.enum(['GET', 'POST']).default('GET'),
  headers: z.record(z.string()).default({}),
  /** Query params merged on every request. Values `{VAR}` resolve from env. */
  staticQuery: z.record(z.string()).default({}),
  categoryParam: ApiCategoryParamSchema.optional(),
  pagination: ApiPaginationSchema.default({}),
  /** Dot-path to the products array in the JSON response. */
  productsPath: z.string().default('products'),
  /**
   * Map RawExtractedProduct fields to dot-paths in each product object.
   * Value may be a fallback list (first non-empty wins).
   */
  fieldMap: z.record(z.union([z.string(), z.array(z.string())])),
  /** Prefix relative product URLs (e.g. https://www.sportchek.ca). */
  urlPrefix: z.string().url().optional(),
  currency: CurrencySchema.default('CAD'),
});

export type ApiRecipe = z.infer<typeof ApiRecipeSchema>;

/** Pagination for Jina listing-page crawls (discovered once per site). */
export const ListingPaginationSchema = z.object({
  style: z.enum(['query_param', 'path_segment', 'link_rel', 'none']).default('none'),
  paramName: z.string().nullable().default(null),
  pathTemplate: z.string().nullable().default(null),
  startPage: z.number().int().positive().default(1),
  maxPages: z.number().int().positive().default(50),
});

export type ListingPagination = z.infer<typeof ListingPaginationSchema>;

/** Jina Reader crawl config persisted on the retailer crawl recipe. */
export const JinaRecipeSchema = z.object({
  productUrlPattern: z.string().nullable().default(null),
  pagination: ListingPaginationSchema.default({}),
  lastDiscoveredAt: z.coerce.date().nullable().default(null),
});

export type JinaRecipe = z.infer<typeof JinaRecipeSchema>;

export const CrawlRecipeSchema = z.object({
  version: z.literal(1).default(1),
  /** Which signals contributed to this recipe. */
  sources: z
    .array(
      z.enum(['llms_txt', 'robots_txt', 'discovery', 'platform', 'network_sniff', 'jina_reader']),
    )
    .default([]),
  discoveryMode: z
    .enum(['sitemap', 'listing_pages', 'api', 'jina_categories'])
    .default('sitemap'),
  sitemapUrls: z.array(z.string().url()).default([]),
  productUrlPattern: z.string().nullable().default(null),
  listingUrlPattern: z.string().nullable().default(null),
  fetchStrategy: z.enum(['static', 'browser', 'jina_reader']).nullable().default(null),
  extractionStrategy: z
    .enum(['json_ld', 'next_data', 'og_meta', 'llm_fallback'])
    .default('json_ld'),
  platform: z.enum(['shopify', 'bigcommerce', 'salesforce', 'unknown']).nullable().default(null),
  extractionHints: z
    .object({
      imageJsonPaths: z.array(z.string()).default([]),
      priceJsonPaths: z.array(z.string()).default([]),
    })
    .default({ imageJsonPaths: [], priceJsonPaths: [] }),
  sampleProductUrls: z.array(z.string().url()).default([]),
  agentFileUrl: z.string().url().nullable().default(null),
  notes: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1).default(0),
  /** Present when discoveryMode is `api`. */
  api: ApiRecipeSchema.nullable().optional().default(null),
  /** Present when discoveryMode is `jina_categories`. */
  jina: JinaRecipeSchema.nullable().optional().default(null),
});

export type CrawlRecipe = z.infer<typeof CrawlRecipeSchema>;
