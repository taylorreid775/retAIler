import { db, schema, eq, and, desc, sql, ne } from '@retailer/db';
import type { ApiRecipe, CrawlRecipe, Platform } from '@retailer/schema';
import { createLogger } from '@retailer/core';
import type { SiteDiscovery } from '../discovery.js';
import { mergeApiIntoDiscovery } from './infer-api-recipe.js';
import { validateApiRecipe, type ValidationReport } from './validate-api-recipe.js';

const log = createLogger('crawler:registry-accelerated');

export interface RegistryAcceleratedContext {
  retailerId?: string;
  platform: Platform | 'unknown';
  discovery: SiteDiscovery;
  fetchJson: NonNullable<Parameters<typeof validateApiRecipe>[2]>;
  /** When true, only try this retailer's stored endpoints first. */
  preferRetailerEndpoints?: boolean;
}

export interface RegistryAcceleratedResult {
  discovery: SiteDiscovery;
  validationReport: ValidationReport | null;
  used: boolean;
  source?: 'retailer_endpoint' | 'platform_endpoint';
}

function apiRecipeFromEndpoint(
  row: {
    url: string;
    method: string;
    headers: Record<string, string> | null;
    paginationStyle: string | null;
  },
  template?: ApiRecipe | null,
): ApiRecipe {
  if (template) {
    return {
      ...template,
      baseUrl: row.url,
      method: row.method as ApiRecipe['method'],
      headers: row.headers ?? template.headers ?? {},
      pagination: {
        ...template.pagination,
        style:
          (row.paginationStyle as ApiRecipe['pagination']['style']) ??
          template.pagination.style,
      },
    };
  }

  return {
    baseUrl: row.url,
    method: row.method as ApiRecipe['method'],
    headers: row.headers ?? {},
    staticQuery: {},
    pagination: {
      style: (row.paginationStyle as ApiRecipe['pagination']['style']) ?? 'page',
      pageParam: 'page',
      maxPages: 10,
      delayMs: 500,
    },
    productsPath: 'products',
    fieldMap: {
      title: 'title',
      url: 'url',
      sku: 'sku',
      price: 'price',
    },
    currency: 'CAD',
  };
}

async function loadCandidateEndpoints(
  ctx: RegistryAcceleratedContext,
): Promise<Array<{ url: string; method: string; headers: Record<string, string> | null; paginationStyle: string | null; source: 'retailer_endpoint' | 'platform_endpoint' }>> {
  const out: Array<{
    url: string;
    method: string;
    headers: Record<string, string> | null;
    paginationStyle: string | null;
    source: 'retailer_endpoint' | 'platform_endpoint';
  }> = [];

  if (ctx.retailerId) {
    const own = await db
      .select({
        url: schema.retailerEndpoints.url,
        method: schema.retailerEndpoints.method,
        headers: schema.retailerEndpoints.headers,
        paginationStyle: schema.retailerEndpoints.paginationStyle,
        reliabilityScore: schema.retailerEndpoints.reliabilityScore,
      })
      .from(schema.retailerEndpoints)
      .where(
        and(
          eq(schema.retailerEndpoints.retailerId, ctx.retailerId),
          eq(schema.retailerEndpoints.active, true),
        ),
      )
      .orderBy(desc(schema.retailerEndpoints.reliabilityScore))
      .limit(ctx.preferRetailerEndpoints ? 8 : 4);

    for (const row of own) {
      out.push({ ...row, headers: row.headers ?? {}, source: 'retailer_endpoint' });
    }
  }

  if (ctx.preferRetailerEndpoints && out.length > 0) {
    return out;
  }

  if (ctx.platform === 'unknown') return out;

  const platformConditions = [
    eq(schema.retailerEndpoints.active, true),
    sql`${schema.retailers.fingerprint}->>'platform' = ${ctx.platform}`,
  ];
  if (ctx.retailerId) {
    platformConditions.push(ne(schema.retailerEndpoints.retailerId, ctx.retailerId));
  }

  const platformRows = await db
    .select({
      url: schema.retailerEndpoints.url,
      method: schema.retailerEndpoints.method,
      headers: schema.retailerEndpoints.headers,
      paginationStyle: schema.retailerEndpoints.paginationStyle,
      reliabilityScore: schema.retailerEndpoints.reliabilityScore,
    })
    .from(schema.retailerEndpoints)
    .innerJoin(schema.retailers, eq(schema.retailerEndpoints.retailerId, schema.retailers.id))
    .where(and(...platformConditions))
    .orderBy(desc(schema.retailerEndpoints.reliabilityScore))
    .limit(6);

  for (const row of platformRows) {
    if (out.some((e) => e.url === row.url && e.method === row.method)) continue;
    out.push({ ...row, headers: row.headers ?? {}, source: 'platform_endpoint' });
  }

  return out;
}

/**
 * Validate stored retailer/platform endpoints before expensive network capture.
 */
export async function tryRegistryAcceleratedApiDiscovery(
  ctx: RegistryAcceleratedContext,
): Promise<RegistryAcceleratedResult> {
  const candidates = await loadCandidateEndpoints(ctx);
  if (!candidates.length) {
    return { discovery: ctx.discovery, validationReport: null, used: false };
  }

  const apiTemplate = ctx.discovery.crawlRecipe.api;

  for (const endpoint of candidates) {
    const api = apiRecipeFromEndpoint(endpoint, apiTemplate);
    const draft: CrawlRecipe = {
      ...ctx.discovery.crawlRecipe,
      discoveryMode: 'api',
      api,
      fetchStrategy: ctx.discovery.fetchStrategy === 'browser' ? 'browser' : 'static',
    };

    const validation = await validateApiRecipe(draft, ctx.discovery.key, ctx.fetchJson, 3);
    if (!validation.ok) continue;

    log.info('registry accelerated API discovery succeeded', {
      key: ctx.discovery.key,
      endpoint: api.baseUrl,
      source: endpoint.source,
      confidence: validation.report.confidence,
    });

    const merged = mergeApiIntoDiscovery(
      ctx.discovery,
      validation.recipe?.api ?? api,
      ctx.discovery.productUrlPattern,
      validation.samples.map((s) => s.sourceUrl),
    );

    return {
      discovery: merged,
      validationReport: validation.report,
      used: true,
      source: endpoint.source,
    };
  }

  return { discovery: ctx.discovery, validationReport: null, used: false };
}
