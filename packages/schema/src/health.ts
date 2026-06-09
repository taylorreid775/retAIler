import { z } from 'zod';

export const HealthAnomalyTypeSchema = z.enum([
  'catalog_drop',
  'endpoint_4xx',
  'endpoint_5xx',
  'pagination_break',
  'field_missing',
  'extraction_rate_drop',
  'bot_wall',
  'rate_limited',
]);

export type HealthAnomalyType = z.infer<typeof HealthAnomalyTypeSchema>;

export const HealthAnomalySeveritySchema = z.enum(['warning', 'critical']);

export const HealthAnomalySchema = z.object({
  type: HealthAnomalyTypeSchema,
  severity: HealthAnomalySeveritySchema,
  details: z.string(),
});

export type HealthAnomaly = z.infer<typeof HealthAnomalySchema>;

/** Inputs for composite crawl health scoring (FAILURE-RECOVERY.md weights). */
export interface CrawlHealthInput {
  catalogCoverageRatio: number;
  endpointSuccessRate: number;
  extractionSuccessRate: number;
  priceFieldPresence: number;
}

export function computeHealthScore(input: CrawlHealthInput): number {
  const score =
    input.catalogCoverageRatio * 0.3 +
    input.endpointSuccessRate * 0.3 +
    input.extractionSuccessRate * 0.2 +
    input.priceFieldPresence * 0.2;
  return Math.max(0, Math.min(1, score));
}
