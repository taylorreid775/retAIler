import { z } from 'zod';

/** Queue names used across the platform. */
export const QueueName = {
  DiscoverConfig: 'store-discover-config',
  Discover: 'crawl-discover',
  Fetch: 'crawl-fetch',
  Extract: 'pipeline-extract',
  Match: 'pipeline-match',
  Analytics: 'analytics-compute',
  Reports: 'reports-send',
  CrawlHealth: 'crawl-health',
  DiscoverRepair: 'store-discover-repair',
} as const;
export type QueueName = (typeof QueueName)[keyof typeof QueueName];

/** Discover a self-serve store's crawl config in the background (browser-capable). */
export const DiscoverConfigJobSchema = z.object({
  onboardingId: z.string().uuid(),
});
export type DiscoverConfigJob = z.infer<typeof DiscoverConfigJobSchema>;

/** Discover URLs to crawl for a retailer (sitemaps / category walk). */
export const DiscoverJobSchema = z.object({
  retailerKey: z.string(),
  /** Optional category path filter to scope a partial crawl. */
  categoryFilter: z.array(z.string()).optional(),
  /** crawlRunId ties all jobs of one scheduled run together. */
  crawlRunId: z.string().uuid(),
});
export type DiscoverJob = z.infer<typeof DiscoverJobSchema>;

/** Fetch + snapshot a single product URL. */
export const FetchJobSchema = z.object({
  retailerKey: z.string(),
  url: z.string().url(),
  crawlRunId: z.string().uuid(),
});
export type FetchJob = z.infer<typeof FetchJobSchema>;

/** Extract structured product data from a stored snapshot. */
export const ExtractJobSchema = z.object({
  retailerKey: z.string(),
  url: z.string().url(),
  /** Vercel Blob key for the raw HTML snapshot. */
  snapshotKey: z.string(),
  /** Public URL to download the snapshot (absent when Blob unconfigured → re-fetch). */
  snapshotUrl: z.string().url().optional(),
  crawlRunId: z.string().uuid(),
});
export type ExtractJob = z.infer<typeof ExtractJobSchema>;

/** Match a retailer product to a canonical product. */
export const MatchJobSchema = z.object({
  retailerProductId: z.string().uuid(),
});
export type MatchJob = z.infer<typeof MatchJobSchema>;

export const AnalyticsJobSchema = z.object({
  /** Compute signals for a window ending now. */
  windowDays: z.number().int().positive().default(1),
});
export type AnalyticsJob = z.infer<typeof AnalyticsJobSchema>;

export const ReportJobSchema = z.object({
  orgId: z.string().uuid(),
  periodStart: z.coerce.date(),
  periodEnd: z.coerce.date(),
});
export type ReportJob = z.infer<typeof ReportJobSchema>;

/** Post-crawl health evaluation. */
export const CrawlHealthJobSchema = z.object({
  retailerKey: z.string(),
  crawlRunId: z.string().uuid(),
});
export type CrawlHealthJob = z.infer<typeof CrawlHealthJobSchema>;

/** Incremental crawl config repair after health degradation. */
export const DiscoverRepairJobSchema = z.object({
  retailerKey: z.string(),
  trigger: z.enum(['health_drop', 'endpoint_failure', 'schema_drift', 'manual']),
  healthReportId: z.string().uuid().optional(),
});
export type DiscoverRepairJob = z.infer<typeof DiscoverRepairJobSchema>;
