import {
  computeHealthScore,
  type CrawlHealthInput,
  type HealthAnomaly,
} from '@retailer/schema';
import type { CrawlRecipe } from '@retailer/schema';

export interface CrawlRunMetrics {
  urlsDiscovered: number;
  urlsFetched: number;
  productsExtracted: number;
  errorCount: number;
  discoveryMode: CrawlRecipe['discoveryMode'] | null;
}

export interface HealthMetricContext {
  run: CrawlRunMetrics;
  /** Catalog size from the prior crawl health report, if any. */
  previousCatalogSize: number;
  /** Discovery-time estimate from recipe validation (first-crawl baseline). */
  discoveryBaselineCatalogSize: number;
  productsWithPrice: number;
  productsIngested: number;
}

function resolveCoverageBaseline(ctx: HealthMetricContext): number {
  if (ctx.previousCatalogSize > 0) return ctx.previousCatalogSize;
  if (ctx.discoveryBaselineCatalogSize > 0) return ctx.discoveryBaselineCatalogSize;
  return 0;
}

/** Derive weighted health inputs from crawl run counters. */
export function buildCrawlHealthInput(ctx: HealthMetricContext): CrawlHealthInput {
  const { run, productsWithPrice, productsIngested } = ctx;
  const catalogSize = run.productsExtracted || run.urlsDiscovered;
  const coverageBaseline = resolveCoverageBaseline(ctx);
  const catalogCoverageRatio =
    coverageBaseline > 0 ? Math.min(1, catalogSize / coverageBaseline) : catalogSize > 0 ? 1 : 0;

  const isDirectIngest =
    run.discoveryMode === 'api' || run.discoveryMode === 'jina_categories';

  let endpointSuccessRate = 1;
  if (isDirectIngest) {
    const attempts = Math.max(run.urlsDiscovered, catalogSize, 1);
    endpointSuccessRate = Math.max(0, 1 - run.errorCount / attempts);
  } else if (run.urlsDiscovered > 0) {
    endpointSuccessRate = Math.min(1, run.urlsFetched / run.urlsDiscovered);
  }

  let extractionSuccessRate = 1;
  if (isDirectIngest) {
    extractionSuccessRate = catalogSize > 0 ? 1 : 0;
  } else if (run.urlsFetched > 0) {
    extractionSuccessRate = Math.min(1, run.productsExtracted / run.urlsFetched);
  }

  const priceFieldPresence =
    productsIngested > 0 ? Math.min(1, productsWithPrice / productsIngested) : 0;

  return {
    catalogCoverageRatio,
    endpointSuccessRate,
    extractionSuccessRate,
    priceFieldPresence,
  };
}

export function evaluateCrawlHealth(ctx: HealthMetricContext): {
  input: CrawlHealthInput;
  healthScore: number;
  anomalies: HealthAnomaly[];
  catalogSize: number;
  previousCatalogSize: number;
} {
  const input = buildCrawlHealthInput(ctx);
  const healthScore = computeHealthScore(input);
  const catalogSize = ctx.run.productsExtracted || ctx.run.urlsDiscovered;
  const previousCatalogSize = resolveCoverageBaseline(ctx);
  const anomalies = detectHealthAnomalies(ctx, input, healthScore);

  return {
    input,
    healthScore,
    anomalies,
    catalogSize,
    previousCatalogSize,
  };
}

/** Health evaluation for failed or zero-yield terminal crawls. */
export function evaluateDegradedCrawlHealth(
  ctx: HealthMetricContext & { failureReason: string },
): ReturnType<typeof evaluateCrawlHealth> {
  const catalogSize = ctx.run.productsExtracted || ctx.run.urlsDiscovered;
  const previousCatalogSize = resolveCoverageBaseline(ctx);
  const input: CrawlHealthInput = {
    catalogCoverageRatio: 0,
    endpointSuccessRate: 0,
    extractionSuccessRate: 0,
    priceFieldPresence: 0,
  };
  const anomalies: HealthAnomaly[] = [
    {
      type: catalogSize === 0 ? 'catalog_drop' : 'endpoint_5xx',
      severity: 'critical',
      details: ctx.failureReason,
    },
  ];
  return {
    input,
    healthScore: 0,
    anomalies,
    catalogSize,
    previousCatalogSize,
  };
}

function detectHealthAnomalies(
  ctx: HealthMetricContext,
  input: CrawlHealthInput,
  healthScore: number,
): HealthAnomaly[] {
  const anomalies: HealthAnomaly[] = [];
  const { run } = ctx;
  const catalogSize = run.productsExtracted || run.urlsDiscovered;

  const coverageBaseline = resolveCoverageBaseline(ctx);
  if (coverageBaseline > 0 && catalogSize < coverageBaseline * 0.7) {
    anomalies.push({
      type: 'catalog_drop',
      severity: catalogSize < coverageBaseline * 0.5 ? 'critical' : 'warning',
      details: `Catalog size dropped from ${coverageBaseline} to ${catalogSize}`,
    });
  }

  if (input.endpointSuccessRate < 0.5) {
    anomalies.push({
      type: run.errorCount > 0 ? 'endpoint_4xx' : 'endpoint_5xx',
      severity: input.endpointSuccessRate < 0.3 ? 'critical' : 'warning',
      details: `Endpoint success rate ${(input.endpointSuccessRate * 100).toFixed(0)}% (${run.errorCount} errors)`,
    });
  }

  if (input.extractionSuccessRate < 0.5 && run.urlsFetched > 0) {
    anomalies.push({
      type: 'extraction_rate_drop',
      severity: 'warning',
      details: `Extraction rate ${(input.extractionSuccessRate * 100).toFixed(0)}% (${run.productsExtracted}/${run.urlsFetched})`,
    });
  }

  if (input.priceFieldPresence < 0.7 && ctx.productsIngested > 0) {
    anomalies.push({
      type: 'field_missing',
      severity: 'warning',
      details: `Price present on ${(input.priceFieldPresence * 100).toFixed(0)}% of ingested products`,
    });
  }

  if (input.catalogCoverageRatio < 0.7 && run.discoveryMode === 'api') {
    anomalies.push({
      type: 'pagination_break',
      severity: 'warning',
      details: 'API crawl returned fewer products than baseline — pagination may be broken',
    });
  }

  if (healthScore < 0.4 && anomalies.length === 0) {
    anomalies.push({
      type: 'catalog_drop',
      severity: 'critical',
      details: `Composite health score ${healthScore.toFixed(2)} below critical threshold`,
    });
  }

  return anomalies;
}
