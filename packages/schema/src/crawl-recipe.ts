import { z } from 'zod';

export const CrawlRecipeSchema = z.object({
  version: z.literal(1).default(1),
  /** Which signals contributed to this recipe. */
  sources: z
    .array(z.enum(['llms_txt', 'robots_txt', 'discovery', 'platform']))
    .default([]),
  discoveryMode: z.enum(['sitemap', 'listing_pages', 'api']).default('sitemap'),
  sitemapUrls: z.array(z.string().url()).default([]),
  productUrlPattern: z.string().nullable().default(null),
  listingUrlPattern: z.string().nullable().default(null),
  fetchStrategy: z.enum(['static', 'browser']).nullable().default(null),
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
});

export type CrawlRecipe = z.infer<typeof CrawlRecipeSchema>;
