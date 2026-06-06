import { type RawExtractedProduct } from '@retailer/schema';

/** Public search API used by sportchek.ca (see sportchek ai pipeline_clean.py). */
export const SPORTCHEK_SEARCH_API = 'https://apim.sportchek.ca/v1/search/v2/search';

export const SPORTCHEK_API_HEADERS: Record<string, string> = {
  'Ocp-Apim-Subscription-Key': 'c01ef3612328420c9f5cd9277e815a0e',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-CA,en-US;q=0.7,en;q=0.3',
  bannerid: 'SC',
  baseSiteId: 'SC',
  'browse-mode': 'OFF',
  Origin: 'https://www.sportchek.ca',
  Referer: 'https://www.sportchek.ca/',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-site',
  'service-client': 'sc/web',
  'service-version': 'v1',
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:142.0) Gecko/20100101 Firefox/142.0',
  'x-web-host': 'www.sportchek.ca',
};

export interface SportChekCategory {
  key: string;
  /** API group param (keys in sportchek ai merged.json). */
  group: string;
  label: string;
}

/** Top-level browse categories from sportchek.ca/en/shop-all/cat/ */
export const SPORTCHEK_CATEGORIES: SportChekCategory[] = [
  { key: 'men', group: 'MEN', label: "Men's" },
  { key: 'women', group: 'WOMEN', label: "Women's" },
  { key: 'kids', group: 'KIDS', label: 'Kids' },
  { key: 'shop-by-sport', group: 'SHOP-BY-SPORT', label: 'Shop By Sport' },
  { key: 'activities-and-equipment', group: 'ACTIVITIES+EQUIPMENT', label: 'Activities & Equipment' },
  { key: 'outdoor', group: 'OUTDOOR', label: 'Outdoor' },
  { key: 'fan-shop', group: 'FAN-SHOP', label: 'Fan Shop' },
  { key: 'accessories', group: 'ACCESSORIES', label: 'Accessories' },
];

export interface SportChekSearchParams {
  store?: string;
  location?: string;
  page?: number;
  group?: string;
  q?: string;
}

export interface SportChekSearchResponse {
  products?: SportChekApiProduct[];
  pagination?: { total?: number };
  resultCount?: number;
}

export interface SportChekApiProduct {
  title?: string;
  skuId?: string;
  code?: string;
  url?: string;
  images?: Array<{ url?: string }>;
  brand?: { label?: string };
  currentPrice?: { value?: string | number };
  originalPrice?: { value?: string | number };
  options?: Array<{
    values?: Array<{
      currentPrice?: { value?: string | number };
      originalPrice?: { value?: string | number };
    }>;
  }>;
  featureBullets?: Array<{ description?: string }>;
}

export function sportChekStore(): string {
  return process.env.SPORTCHEK_STORE ?? '383';
}

export function sportChekLocation(): string {
  return process.env.SPORTCHEK_LOCATION ?? 'ON';
}

export function buildSearchUrl(params: SportChekSearchParams): string {
  const search = new URLSearchParams({
    store: params.store ?? sportChekStore(),
    location: params.location ?? sportChekLocation(),
    page: String(params.page ?? 1),
    sort: 'relevance',
    facets: 'true',
    includePricing: 'true',
  });
  if (params.group) search.set('group', params.group);
  if (params.q) search.set('q', params.q);
  return `${SPORTCHEK_SEARCH_API}?${search}`;
}

/** Extract current/list price — mirrors sportchek ai pipeline_clean.py. */
export function extractPrices(product: SportChekApiProduct): {
  price: number | null;
  listPrice: number | null;
} {
  let price: number | null = parsePrice(product.currentPrice?.value);
  let listPrice: number | null = parsePrice(product.originalPrice?.value);

  const options = product.options;
  if (options?.length) {
    const value = options[0]?.values?.[0];
    if (value) {
      price = parsePrice(value.currentPrice?.value) ?? price;
      listPrice = parsePrice(value.originalPrice?.value) ?? listPrice;
    }
  }

  return { price, listPrice };
}

function parsePrice(raw: string | number | undefined): number | null {
  if (raw == null || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number.parseFloat(String(raw));
  return Number.isFinite(n) ? n : null;
}

export function mapApiProduct(
  product: SportChekApiProduct,
  categoryLabel: string,
): RawExtractedProduct | null {
  const title = product.title?.trim();
  const path = product.url?.trim();
  if (!title || !path) return null;

  const sourceUrl = path.startsWith('http') ? path : `https://www.sportchek.ca${path}`;
  const { price, listPrice } = extractPrices(product);
  const imageUrl = product.images?.[0]?.url ?? null;
  const description = product.featureBullets?.[0]?.description ?? null;

  return {
    sourceUrl,
    retailerKey: 'sportchek',
    retailerSku: product.skuId ?? product.code ?? null,
    title,
    brand: product.brand?.label ?? null,
    description,
    categoryPath: categoryLabel ? [categoryLabel] : [],
    gtin: null,
    mpn: null,
    price,
    listPrice,
    currency: 'CAD',
    availability: 'unknown',
    stockQty: null,
    imageUrl,
    attributes: {},
    capturedAt: new Date(),
  };
}

export function categoriesForFilter(filters?: string[]): SportChekCategory[] {
  if (!filters?.length) return SPORTCHEK_CATEGORIES;
  const lower = filters.map((f) => f.toLowerCase());
  return SPORTCHEK_CATEGORIES.filter(
    (c) =>
      lower.some(
        (f) =>
          c.key.includes(f) ||
          f.includes(c.key) ||
          c.group.toLowerCase() === f ||
          c.label.toLowerCase().includes(f),
      ),
  );
}
