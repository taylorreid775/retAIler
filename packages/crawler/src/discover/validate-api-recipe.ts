import { createLogger } from '@retailer/core';
import { CrawlRecipeSchema, type CrawlRecipe, type RawExtractedProduct } from '@retailer/schema';
import { type DiscoverContext } from '../adapters/types';
import {
  buildApiFetchInit,
  buildApiPageUrl,
  discoverProductsFromApiRecipe,
  getAtPath,
  mapApiProductFromRecord,
} from './api-recipe';
import { applyDetectedPagination, detectPaginationStyle } from './detect-pagination';

const log = createLogger('crawler:validate-api');

/** WORKFLOW Stage 3 promotion thresholds. */
export const PROMOTION_MIN_CONFIDENCE = 0.7;
export const PROMOTION_MIN_CATALOG_SIZE = 50;
export const PROMOTION_MIN_RELIABILITY = 0.9;

export interface ValidationReport {
  endpoint: string;
  reliability: number;
  estimatedCatalogSize: number;
  paginationVerified: boolean;
  paginationStyle: 'offset' | 'cursor' | 'page' | 'link_rel' | 'none';
  paginationParam: string | null;
  fieldsPresent: Record<string, number>;
  failureModes: string[];
  confidence: number;
}

export interface ApiRecipeValidation {
  ok: boolean;
  count: number;
  samples: RawExtractedProduct[];
  report: ValidationReport;
  /** Recipe with auto-detected pagination applied (when detection succeeded). */
  recipe?: CrawlRecipe;
}

const TOTAL_COUNT_PATHS = [
  'total',
  'count',
  'total_count',
  'pagination.total',
  'pagination.totalResults',
  'meta.total',
  'data.total',
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function estimateCatalogSize(data: unknown, page1Count: number, perPage: number): number {
  for (const path of TOTAL_COUNT_PATHS) {
    const value = getAtPath(data, path);
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return value;
    }
  }
  if (page1Count >= perPage) {
    return Math.max(page1Count, perPage * 2);
  }
  return page1Count;
}

function fieldPresence(samples: RawExtractedProduct[]): Record<string, number> {
  if (!samples.length) return { title: 0, price: 0, url: 0, sku: 0 };
  const n = samples.length;
  return {
    title: samples.filter((s) => s.title).length / n,
    price: samples.filter((s) => s.price != null).length / n,
    url: samples.filter((s) => s.sourceUrl).length / n,
    sku: samples.filter((s) => s.retailerSku).length / n,
  };
}

function extractProductRecords(
  api: NonNullable<CrawlRecipe['api']>,
  data: unknown,
): Record<string, unknown>[] {
  const raw = getAtPath(data, api.productsPath);
  if (!Array.isArray(raw)) return [];
  return raw.filter((item) => item && typeof item === 'object') as Record<string, unknown>[];
}

function mapSamplesFromPage(
  api: NonNullable<CrawlRecipe['api']>,
  data: unknown,
  retailerKey: string,
  limit: number,
): RawExtractedProduct[] {
  const samples: RawExtractedProduct[] = [];
  for (const item of extractProductRecords(api, data)) {
    const raw = mapApiProductFromRecord(item, api, retailerKey, '');
    if (!raw?.title || raw.price == null || !raw.sourceUrl) continue;
    samples.push(raw);
    if (samples.length >= limit) break;
  }
  return samples;
}

/**
 * Probe a recipe with WORKFLOW Stage 3 checks: reliability, pagination, catalog size, fields.
 */
export async function validateApiRecipe(
  recipe: CrawlRecipe,
  retailerKey: string,
  fetchJson: NonNullable<DiscoverContext['fetchJson']>,
  limit = 3,
): Promise<ApiRecipeValidation> {
  const emptyReport = (endpoint: string, failureModes: string[]): ValidationReport => ({
    endpoint,
    reliability: 0,
    estimatedCatalogSize: 0,
    paginationVerified: false,
    paginationStyle: 'none',
    paginationParam: null,
    fieldsPresent: {},
    failureModes,
    confidence: 0,
  });

  const parsed = CrawlRecipeSchema.safeParse(recipe);
  if (!parsed.success || parsed.data.discoveryMode !== 'api' || !parsed.data.api) {
    return {
      ok: false,
      count: 0,
      samples: [],
      report: emptyReport('', ['invalid_recipe']),
    };
  }

  let workingRecipe = parsed.data;
  let api = workingRecipe.api!;

  const detected = await detectPaginationStyle(api, fetchJson);
  if (detected && detected.style !== 'none') {
    api = applyDetectedPagination(api, detected);
    workingRecipe = { ...workingRecipe, api };
  }

  const page1Url = buildApiPageUrl(api, 1);
  const fetchInit = buildApiFetchInit(api);
  const failureModes: string[] = [];

  let successes = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(10_000);
    const data = (await fetchJson(page1Url, api.headers, fetchInit)) as Record<string, unknown> | null;
    if (data && extractProductRecords(api, data).length > 0) successes += 1;
  }
  const reliability = successes / 3;
  if (reliability < PROMOTION_MIN_RELIABILITY) {
    failureModes.push('low_reliability');
  }

  const page1Data = (await fetchJson(page1Url, api.headers, fetchInit)) as Record<string, unknown> | null;
  if (!page1Data) {
    return {
      ok: false,
      count: 0,
      samples: [],
      report: { ...emptyReport(page1Url, ['page1_fetch_failed']), reliability },
    };
  }

  const page1Records = extractProductRecords(api, page1Data);
  const perPage = api.pagination.itemsPerPage ?? (page1Records.length || 1);
  const estimatedCatalogSize = estimateCatalogSize(page1Data, page1Records.length, perPage);
  if (estimatedCatalogSize < PROMOTION_MIN_CATALOG_SIZE) {
    failureModes.push('catalog_too_small');
  }

  let paginationVerified = page1Records.length === 0;
  const paginationStyle = api.pagination.style;
  if (page1Records.length > 0) {
    let page2Data: Record<string, unknown> | null = null;
    if (paginationStyle === 'link_rel' && api.pagination.nextUrlPath) {
      const nextUrl = getAtPath(page1Data, api.pagination.nextUrlPath);
      if (typeof nextUrl === 'string' && nextUrl.startsWith('http')) {
        page2Data = (await fetchJson(nextUrl, api.headers, fetchInit)) as Record<string, unknown> | null;
      }
    } else if (paginationStyle === 'cursor' && api.pagination.cursorPath) {
      const cursor = getAtPath(page1Data, api.pagination.cursorPath);
      if (typeof cursor === 'string' && cursor.trim()) {
        const page2Url = buildApiPageUrl(api, 2, '', { cursor });
        page2Data = (await fetchJson(page2Url, api.headers, fetchInit)) as Record<string, unknown> | null;
      }
    } else {
      const page2Url = buildApiPageUrl(api, 2);
      page2Data = (await fetchJson(page2Url, api.headers, fetchInit)) as Record<string, unknown> | null;
    }

    const page2Records = page2Data ? extractProductRecords(api, page2Data) : [];
    const page1Urls = new Set(
      mapSamplesFromPage(api, page1Data, retailerKey, 50).map((s) => s.sourceUrl),
    );
    const page2HasNew =
      page2Records.length > 0 &&
      mapSamplesFromPage(api, page2Data, retailerKey, 50).some((s) => !page1Urls.has(s.sourceUrl));
    paginationVerified = page2HasNew || page1Records.length < perPage;
    if (!paginationVerified) {
      failureModes.push('pagination_not_verified');
    }
  }

  const samples: RawExtractedProduct[] = [];
  try {
    for await (const raw of discoverProductsFromApiRecipe(workingRecipe, retailerKey, {
      limit,
      fetchJson,
    })) {
      if (!raw.title || raw.price == null) continue;
      samples.push(raw);
      if (samples.length >= limit) break;
    }
  } catch (err) {
    log.warn('API recipe validation threw', { err: String(err) });
    failureModes.push('sample_extraction_failed');
  }

  if (samples.length < Math.min(2, limit)) {
    failureModes.push('insufficient_samples');
  }

  const fieldsPresent = fieldPresence(samples);
  if ((fieldsPresent.title ?? 0) < 0.9 || (fieldsPresent.price ?? 0) < 0.9) {
    failureModes.push('incomplete_fields');
  }

  const confidence = Math.min(
    1,
    reliability * 0.35 +
      (estimatedCatalogSize >= PROMOTION_MIN_CATALOG_SIZE ? 0.35 : 0) +
      (paginationVerified ? 0.15 : 0) +
      ((fieldsPresent.title ?? 0) >= 0.9 && (fieldsPresent.price ?? 0) >= 0.9 ? 0.15 : 0),
  );

  if (confidence < PROMOTION_MIN_CONFIDENCE) {
    failureModes.push('low_confidence');
  }

  const report: ValidationReport = {
    endpoint: api.baseUrl,
    reliability,
    estimatedCatalogSize,
    paginationVerified,
    paginationStyle,
    paginationParam: api.pagination.pageParam,
    fieldsPresent,
    failureModes: [...new Set(failureModes)],
    confidence,
  };

  const ok =
    failureModes.length === 0 &&
    samples.length >= Math.min(2, limit) &&
    confidence >= PROMOTION_MIN_CONFIDENCE;

  return {
    ok,
    count: samples.length,
    samples,
    report,
    recipe: detected ? workingRecipe : undefined,
  };
}
