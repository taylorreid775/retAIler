import type { CrawlRecipe, HealthAnomaly, RetailerFingerprint } from '@retailer/schema';
import type { DiscoverContext } from '../../adapters/types.js';
import type { SiteDiscovery } from '../../discovery.js';
import { validateApiRecipe, type ApiRecipeValidation } from '../validate-api-recipe.js';
import { refreshApiHeaders } from './header-refresh.js';
import { tryFixPagination } from './pagination-fix.js';
import { trySwapEndpoint } from './endpoint-swap.js';

export type RepairStrategyName = 'header_refresh' | 'pagination_fix' | 'endpoint_swap';

export interface RepairContext {
  retailerKey: string;
  domain: string;
  homepageUrl: string;
  homepageHtml?: string;
  crawlRecipe: CrawlRecipe;
  fingerprint: RetailerFingerprint | null;
  anomalies: HealthAnomaly[];
  fetchJson: NonNullable<DiscoverContext['fetchJson']>;
  captureHeaders: (url: string) => Promise<Record<string, string>>;
}

export interface RepairAttemptResult {
  strategy: RepairStrategyName;
  patched: CrawlRecipe | null;
  validation: ApiRecipeValidation | null;
}

/** Map health anomalies to ordered repair strategies (deterministic first). */
export function selectRepairStrategies(
  anomalies: HealthAnomaly[],
  crawlRecipe: CrawlRecipe,
): RepairStrategyName[] {
  if (crawlRecipe.discoveryMode !== 'api' || !crawlRecipe.api) return [];

  const types = new Set(anomalies.map((a) => a.type));
  const strategies: RepairStrategyName[] = [];

  if (types.has('endpoint_4xx') || types.has('endpoint_5xx')) {
    strategies.push('header_refresh', 'endpoint_swap');
  }
  if (types.has('pagination_break') || types.has('catalog_drop')) {
    strategies.push('pagination_fix');
  }
  if (types.has('field_missing')) {
    strategies.push('header_refresh');
  }

  if (!strategies.length && anomalies.length > 0) {
    strategies.push('header_refresh', 'pagination_fix', 'endpoint_swap');
  }

  return [...new Set(strategies)];
}

export async function applyRepairStrategy(
  strategy: RepairStrategyName,
  ctx: RepairContext,
): Promise<RepairAttemptResult> {
  let patched: CrawlRecipe | null = null;

  switch (strategy) {
    case 'header_refresh': {
      const probeUrl = ctx.crawlRecipe.api?.baseUrl ?? ctx.homepageUrl;
      const captured = await ctx.captureHeaders(probeUrl);
      patched = refreshApiHeaders(ctx.crawlRecipe, captured);
      break;
    }
    case 'pagination_fix':
      patched = await tryFixPagination(ctx.crawlRecipe, ctx.fetchJson);
      break;
    case 'endpoint_swap':
      if (ctx.fingerprint) {
        patched = await trySwapEndpoint({
          discovery: {
            key: ctx.retailerKey,
            domain: ctx.domain,
            homepageUrl: ctx.homepageUrl,
            homepageHtml: ctx.homepageHtml ?? null,
            confidence: ctx.crawlRecipe.confidence,
            crawlRecipe: ctx.crawlRecipe,
            productUrlPattern: ctx.crawlRecipe.productUrlPattern ?? null,
            sampleProductUrls: ctx.crawlRecipe.sampleProductUrls,
            notes: ctx.crawlRecipe.notes.join('; '),
            fetchStrategy: ctx.crawlRecipe.fetchStrategy ?? 'static',
          },
          fingerprint: ctx.fingerprint,
          fetchJson: ctx.fetchJson,
        });
      }
      break;
  }

  if (!patched) {
    return { strategy, patched: null, validation: null };
  }

  const validation = await validateApiRecipe(patched, ctx.retailerKey, ctx.fetchJson, 3);
  return { strategy, patched, validation };
}
