import { z } from 'zod';

/** How a retailer's pages should be fetched. */
export const FetchStrategySchema = z.enum(['static', 'browser', 'jina_reader']);
export type FetchStrategy = z.infer<typeof FetchStrategySchema>;

/** Per-retailer crawl policy. Keep polite-by-default. */
export const CrawlPolicySchema = z.object({
  /** Whether crawling is currently enabled. */
  enabled: z.boolean().default(true),
  /** Minimum delay between requests, ms. */
  requestDelayMs: z.number().int().min(0).default(2000),
  /** Max concurrent in-flight requests for this retailer. */
  maxConcurrency: z.number().int().min(1).default(2),
  /** Respect robots.txt (should remain true outside narrow exceptions). */
  respectRobotsTxt: z.boolean().default(true),
  /** static (cheerio) or browser (playwright). */
  fetchStrategy: FetchStrategySchema.default('static'),
  /** Use the configured proxy pool for this retailer. */
  useProxy: z.boolean().default(false),
  /** Cron expression for scheduled full crawls. */
  crawlSchedule: z.string().default('0 6 * * *'),
});
export type CrawlPolicy = z.infer<typeof CrawlPolicySchema>;

export const RetailerSchema = z.object({
  id: z.string().uuid(),
  /** Stable machine key, e.g. "sportchek". */
  key: z.string().min(2),
  name: z.string().min(1),
  domain: z.string().min(3),
  country: z.string().length(2).default('CA'),
  /** Affiliate program tag/id for consumer link-out. */
  affiliateTag: z.string().nullable().default(null),
  policy: CrawlPolicySchema,
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Retailer = z.infer<typeof RetailerSchema>;

export const NewRetailerSchema = RetailerSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type NewRetailer = z.infer<typeof NewRetailerSchema>;
