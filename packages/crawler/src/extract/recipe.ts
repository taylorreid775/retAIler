import type { CrawlRecipe } from '@retailer/schema';
import { AvailabilitySchema, type Availability, type RawExtractedProduct } from '@retailer/schema';
import { extractFromJsonLd } from './structured';

/**
 * Apply a persisted crawl recipe after JSON-LD. Handles platform-specific
 * __NEXT_DATA__ paths and OpenGraph fallbacks without per-retailer code.
 */
export function extractFromRecipe(
  html: string,
  url: string,
  retailerKey: string,
  recipe: CrawlRecipe,
): RawExtractedProduct | null {
  let result: RawExtractedProduct | null = null;

  if (recipe.extractionStrategy === 'json_ld' || recipe.extractionStrategy === 'llm_fallback') {
    result = extractFromJsonLd(html, url, retailerKey);
  }

  if (recipe.extractionStrategy === 'next_data' || needsMore(result)) {
    const next = extractFromNextData(html, url, retailerKey, recipe);
    result = merge(result, next);
  }

  if (needsImage(result)) {
    const og = ogImage(html);
    if (og && result) result = { ...result, imageUrl: og };
    else if (og && !result) {
      result = {
        sourceUrl: url,
        retailerKey,
        retailerSku: null,
        title: ogTitle(html) ?? url,
        brand: null,
        description: null,
        categoryPath: [],
        gtin: null,
        mpn: null,
        price: null,
        listPrice: null,
        currency: 'CAD',
        availability: 'unknown',
        stockQty: null,
        imageUrl: og,
        attributes: {},
        capturedAt: new Date(),
      };
    }
  }

  return result;
}

function extractFromNextData(
  html: string,
  url: string,
  retailerKey: string,
  recipe: CrawlRecipe,
): RawExtractedProduct | null {
  const block = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!block) return null;

  let pageProps: Record<string, unknown>;
  try {
    pageProps = (JSON.parse(block[1] ?? '') as { props?: { pageProps?: Record<string, unknown> } })
      .props?.pageProps as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!pageProps) return null;

  const product = (pageProps.product ?? pageProps.productData) as Record<string, unknown> | undefined;
  if (!product || typeof product.name !== 'string') return null;

  const hints = recipe.extractionHints;
  const imageRaw =
    pickPath(product, hints.imageJsonPaths) ??
    pickPath(pageProps, hints.imageJsonPaths) ??
    pickPath(product, ['images.0.urlOriginal', 'images.0.url_standard', 'images.0.url']);

  const guestPrice = getPath(pageProps, 'customerGroupPrices.guest.price') as Record<string, unknown> | undefined;
  const priceRaw =
    pickPath(product, hints.priceJsonPaths) ??
    pickPath(guestPrice ?? {}, ['lowPrice.value', 'price.value']) ??
    pickPath(product, ['price.value', 'price']);

  const price = typeof priceRaw === 'number' ? priceRaw : Number(priceRaw);
  const brand = product.brand;
  const brandName =
    typeof brand === 'string' ? brand : (brand as { name?: string } | undefined)?.name ?? null;

  const breadcrumbs = product.breadcrumbs as Array<{ name?: string; label?: string }> | undefined;

  return {
    sourceUrl: url,
    retailerKey,
    retailerSku: str(product.code ?? pageProps.productCode),
    title: product.name as string,
    brand: brandName,
    description: str(product.shortDescription ?? product.description),
    categoryPath: (breadcrumbs ?? []).map((b) => b.name ?? b.label ?? '').filter(Boolean),
    gtin: null,
    mpn: null,
    price: Number.isFinite(price) ? price : null,
    listPrice: null,
    currency: 'CAD',
    availability: mapAvailability(str(product.availabilityStatus)),
    stockQty: null,
    imageUrl: normalizeImageUrl(imageRaw, url),
    attributes: {},
    capturedAt: new Date(),
  };
}

function pickPath(obj: Record<string, unknown>, paths: string[]): unknown {
  for (const p of paths) {
    const v = getPath(obj, p);
    if (v != null && v !== '') return v;
  }
  return null;
}

function getPath(obj: Record<string, unknown>, path: string): unknown {
  let cur: unknown = obj;
  for (const key of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return null;
    if (/^\d+$/.test(key)) {
      if (!Array.isArray(cur)) return null;
      cur = cur[Number(key)];
    } else {
      cur = (cur as Record<string, unknown>)[key];
    }
  }
  return cur;
}

function normalizeImageUrl(raw: unknown, pageUrl: string): string | null {
  if (typeof raw !== 'string' || !raw) return null;
  if (raw.startsWith('http')) return raw;
  try {
    return new URL(raw, new URL(pageUrl).origin).href;
  } catch {
    return null;
  }
}

function ogImage(html: string): string | null {
  const m = html.match(/property="og:image" content="([^"]+)"/i);
  return m?.[1]?.startsWith('http') ? m[1] : null;
}

function ogTitle(html: string): string | null {
  const m = html.match(/property="og:title" content="([^"]+)"/i);
  return m?.[1]?.trim() ?? null;
}

function needsMore(p: RawExtractedProduct | null): boolean {
  return !p || p.price == null;
}

function needsImage(p: RawExtractedProduct | null): boolean {
  return !p || !p.imageUrl;
}

function merge(a: RawExtractedProduct | null, b: RawExtractedProduct | null): RawExtractedProduct | null {
  if (!a) return b;
  if (!b) return a;
  return {
    ...b,
    ...Object.fromEntries(Object.entries(a).filter(([, v]) => v != null && v !== '')),
    categoryPath: a.categoryPath.length ? a.categoryPath : b.categoryPath,
    attributes: { ...b.attributes, ...a.attributes },
  } as RawExtractedProduct;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function mapAvailability(status: string | null): Availability {
  const s = status?.toLowerCase() ?? '';
  if (s.includes('in_stock') || s.includes('instock') || s === 'available') return 'in_stock';
  if (s.includes('out')) return 'out_of_stock';
  if (s.includes('preorder')) return 'preorder';
  return AvailabilitySchema.parse('unknown');
}
