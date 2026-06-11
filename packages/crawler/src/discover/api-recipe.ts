import {
  type ApiRecipe,
  type CrawlRecipe,
  type Currency,
  type RawExtractedProduct,
} from '@retailer/schema';
import { createLogger } from '@retailer/core';
import { type DiscoverContext } from '../adapters/types';

const log = createLogger('crawler:api-recipe');

/** Cool down between category slices after heavy pagination (APIM rate limits). */
const CATEGORY_COOLDOWN_MS = 20_000;

const ENV_DEFAULTS: Record<string, string> = {
  SPORTCHEK_STORE: '383',
  SPORTCHEK_LOCATION: 'ON',
};

/** Resolve `{ENV_VAR}` placeholders in recipe query values. */
export function resolveRecipeValue(raw: string): string {
  const m = raw.match(/^\{([A-Z0-9_]+)\}$/);
  if (!m) return raw;
  const key = m[1]!;
  return process.env[key] ?? ENV_DEFAULTS[key] ?? raw;
}

/** Read a dot/bracket path from a JSON object. */
export function getAtPath(obj: unknown, path: string): unknown {
  const normalized = path.replace(/\[(\d+)\]/g, '.$1');
  let cur: unknown = obj;
  for (const part of normalized.split('.').filter(Boolean)) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function getField(
  product: Record<string, unknown>,
  spec: string | string[] | undefined,
): unknown {
  if (!spec) return undefined;
  const paths = Array.isArray(spec) ? spec : [spec];
  for (const p of paths) {
    const v = getAtPath(product, p);
    if (v != null && v !== '') return v;
  }
  return undefined;
}

function parsePrice(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number.parseFloat(String(raw));
  return Number.isFinite(n) ? n : null;
}

function mapApiProduct(
  product: Record<string, unknown>,
  api: ApiRecipe,
  retailerKey: string,
  categoryLabel: string,
): RawExtractedProduct | null {
  const title = String(getField(product, api.fieldMap.title) ?? '').trim();
  const urlRaw = String(getField(product, api.fieldMap.url) ?? '').trim();
  if (!title || !urlRaw) return null;

  const sourceUrl = urlRaw.startsWith('http')
    ? urlRaw
    : `${api.urlPrefix ?? ''}${urlRaw.startsWith('/') ? '' : '/'}${urlRaw}`;

  const price = parsePrice(getField(product, api.fieldMap.price));
  const listRaw = parsePrice(getField(product, api.fieldMap.listPrice));
  const listPrice = listRaw != null && price != null && listRaw > price ? listRaw : null;

  const imageRaw = getField(product, api.fieldMap.image);
  const imageUrl = imageRaw != null ? String(imageRaw) : null;
  const brandRaw = getField(product, api.fieldMap.brand);
  const descRaw = getField(product, api.fieldMap.description);
  const skuRaw = getField(product, api.fieldMap.sku);

  return {
    sourceUrl,
    retailerKey,
    retailerSku: skuRaw != null ? String(skuRaw) : null,
    title,
    brand: brandRaw != null ? String(brandRaw) : null,
    description: descRaw != null ? String(descRaw) : null,
    categoryPath: categoryLabel ? [categoryLabel] : [],
    gtin: null,
    mpn: null,
    price,
    listPrice,
    currency: api.currency as Currency,
    availability: 'unknown',
    stockQty: null,
    imageUrl,
    attributes: {},
    capturedAt: new Date(),
  };
}

/** Map a single API product object — used by validation probes. */
export const mapApiProductFromRecord = mapApiProduct;

function buildApiUrl(baseUrl: string, query: Record<string, string>): string {
  const url = new URL(baseUrl);
  for (const [k, v] of Object.entries(query)) {
    url.searchParams.set(k, v);
  }
  return url.toString();
}

export interface ApiPageContext {
  /** Cursor token from the previous response (cursor-style pagination). */
  cursor?: string;
  /** Absolute next-page URL (link_rel style). */
  nextUrl?: string;
}

/** Build query params for a paginated API request (page 1-indexed). */
export function buildApiPageQuery(
  api: ApiRecipe,
  page: number,
  categoryValue = '',
  ctx: ApiPageContext = {},
): Record<string, string> {
  const query: Record<string, string> = {};
  for (const [k, v] of Object.entries(api.staticQuery)) {
    query[k] = resolveRecipeValue(v);
  }
  if (api.categoryParam && categoryValue) {
    query[api.categoryParam.name] = categoryValue;
  }
  const pagination = api.pagination;
  if (pagination.style === 'link_rel') {
    return query;
  }
  if (pagination.style === 'cursor') {
    if (page > 1 && ctx.cursor) {
      query[pagination.pageParam] = ctx.cursor;
    }
    return query;
  }
  const pageSize = pagination.itemsPerPage ?? 24;
  query[pagination.pageParam] =
    pagination.style === 'offset' ? String((page - 1) * pageSize) : String(page);
  return query;
}

/** Full URL for a paginated API page (page 1-indexed). */
export function buildApiPageUrl(
  api: ApiRecipe,
  page: number,
  categoryValue = '',
  ctx: ApiPageContext = {},
): string {
  if (paginationUsesNextUrl(api, page, ctx)) {
    return ctx.nextUrl!;
  }
  return buildApiUrl(api.baseUrl, buildApiPageQuery(api, page, categoryValue, ctx));
}

function paginationUsesNextUrl(api: ApiRecipe, page: number, ctx: ApiPageContext): boolean {
  return api.pagination.style === 'link_rel' && page > 1 && Boolean(ctx.nextUrl);
}

function readNextUrl(data: unknown, api: ApiRecipe): string | null {
  const path = api.pagination.nextUrlPath ?? 'links.next';
  const value = getAtPath(data, path);
  return typeof value === 'string' && value.startsWith('http') ? value : null;
}

function readCursor(data: unknown, api: ApiRecipe): string | null {
  const path = api.pagination.cursorPath;
  if (!path) return null;
  const value = getAtPath(data, path);
  return typeof value === 'string' && value.trim() ? value : null;
}

type CategorySlice = { value: string; label?: string; key?: string };

function categoriesForFilter(api: ApiRecipe, filters?: string[]): CategorySlice[] {
  if (!api.categoryParam) return [];
  if (!filters?.length) return api.categoryParam.values;
  const lower = filters.map((f) => f.toLowerCase());
  return api.categoryParam.values.filter((c) =>
    lower.some(
      (f) =>
        (c.key && (c.key.includes(f) || f.includes(c.key))) ||
        c.value.toLowerCase() === f ||
        (c.label && c.label.toLowerCase().includes(f)),
    ),
  );
}

/**
 * Paginate a retailer catalog/search API described by a saved crawl recipe.
 * Used at crawl time — no retailer-specific TypeScript adapter required.
 */
export async function* discoverProductsFromApiRecipe(
  recipe: CrawlRecipe,
  retailerKey: string,
  ctx: DiscoverContext,
): AsyncGenerator<RawExtractedProduct> {
  const api = recipe.api;
  if (!api) throw new Error('discoverProductsFromApiRecipe requires recipe.api');
  if (!ctx.fetchJson) {
    throw new Error('API discovery requires ctx.fetchJson (browser or static JSON fetch)');
  }

  const seen = new Set<string>();
  let count = 0;
  const categories = api.categoryParam
    ? categoriesForFilter(api, ctx.categoryFilter)
    : [{ value: '', label: '' }];

  for (let catIdx = 0; catIdx < categories.length; catIdx++) {
    const category = categories[catIdx]!;
    if (catIdx > 0) await sleep(CATEGORY_COOLDOWN_MS);

    log.info('category start', {
      retailerKey,
      category: category.value || 'all',
      label: category.label,
      discoveredSoFar: count,
    });

    let page = 1;
    let totalPages: number | undefined;
    const pagination = api.pagination;
    let pageCtx: ApiPageContext = {};

    while (true) {
      if (ctx.limit && count >= ctx.limit) return;

      const url = buildApiPageUrl(api, page, category.value, pageCtx);
      const data = await fetchPageWithRetry(ctx, url, api);
      const productsRaw = data ? getAtPath(data, api.productsPath) : null;
      const products = Array.isArray(productsRaw) ? productsRaw : [];

      if (!products.length) {
        log.warn('category page empty', { retailerKey, category: category.value, page });
        break;
      }

      if (page === 1 && pagination.totalPagesPath) {
        const total = getAtPath(data, pagination.totalPagesPath);
        if (typeof total === 'number' && Number.isFinite(total)) totalPages = total;
      }

      for (const item of products) {
        if (ctx.limit && count >= ctx.limit) return;
        if (!item || typeof item !== 'object') continue;
        const raw = mapApiProduct(
          item as Record<string, unknown>,
          api,
          retailerKey,
          category.label ?? '',
        );
        if (!raw || seen.has(raw.sourceUrl)) continue;
        seen.add(raw.sourceUrl);
        yield raw;
        count += 1;
      }

      const perPage = pagination.itemsPerPage ?? products.length;
      if (pagination.style === 'link_rel') {
        const nextUrl = readNextUrl(data, api);
        if (!nextUrl) break;
        pageCtx = { nextUrl };
      } else if (pagination.style === 'cursor') {
        const cursor = readCursor(data, api);
        if (!cursor) break;
        pageCtx = { cursor };
      } else {
        if (products.length < perPage) break;
      }
      if (totalPages && page >= totalPages) break;
      if (page >= pagination.maxPages) break;

      page += 1;
      if (pagination.delayMs > 0) await sleep(pagination.delayMs);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function apiFetchInit(api: ApiRecipe): { method: 'GET' | 'POST'; body?: string } | undefined {
  if (api.method === 'POST' && api.requestBody) {
    return { method: 'POST', body: api.requestBody };
  }
  return undefined;
}

/** Retry catalog fetches — Sport Chek APIM rate-limits after ~100 pages. */
async function fetchPageWithRetry(
  ctx: DiscoverContext,
  url: string,
  api: ApiRecipe,
  attempts = 4,
): Promise<Record<string, unknown> | null> {
  const init = apiFetchInit(api);
  for (let i = 0; i < attempts; i++) {
    const data = (await ctx.fetchJson!(url, api.headers, init)) as Record<string, unknown> | null;
    if (data) return data;
    const wait = Math.min(30_000, 3_000 * 2 ** i);
    await sleep(wait);
  }
  return null;
}

/** Build fetch init for API recipe replay (GET or POST). */
export function buildApiFetchInit(api: ApiRecipe): { method?: 'GET' | 'POST'; body?: string } | undefined {
  return apiFetchInit(api);
}
