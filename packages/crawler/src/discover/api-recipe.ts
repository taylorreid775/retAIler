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

function buildApiUrl(baseUrl: string, query: Record<string, string>): string {
  const url = new URL(baseUrl);
  for (const [k, v] of Object.entries(query)) {
    url.searchParams.set(k, v);
  }
  return url.toString();
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

    while (true) {
      if (ctx.limit && count >= ctx.limit) return;

      const query: Record<string, string> = {};
      for (const [k, v] of Object.entries(api.staticQuery)) {
        query[k] = resolveRecipeValue(v);
      }
      if (api.categoryParam && category.value) {
        query[api.categoryParam.name] = category.value;
      }
      query[pagination.pageParam] = String(page);

      const url = buildApiUrl(api.baseUrl, query);
      const data = await fetchPageWithRetry(ctx, url, api.headers);
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
      if (products.length < perPage) break;
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

/** Retry catalog fetches — Sport Chek APIM rate-limits after ~100 pages. */
async function fetchPageWithRetry(
  ctx: DiscoverContext,
  url: string,
  headers: Record<string, string>,
  attempts = 4,
): Promise<Record<string, unknown> | null> {
  for (let i = 0; i < attempts; i++) {
    const data = (await ctx.fetchJson!(url, headers)) as Record<string, unknown> | null;
    if (data) return data;
    const wait = Math.min(30_000, 3_000 * 2 ** i);
    await sleep(wait);
  }
  return null;
}
