import * as cheerio from 'cheerio';
import { AvailabilitySchema, type Availability, type RawExtractedProduct } from '@retailer/schema';

/**
 * Structured-first extraction: most modern retail PDPs embed schema.org
 * Product JSON-LD. This is fast, free, and reliable — we only fall back to an
 * LLM when this returns null or is incomplete.
 */
export function extractFromJsonLd(
  html: string,
  url: string,
  retailerKey: string,
): RawExtractedProduct | null {
  const $ = cheerio.load(html);
  const blocks = $('script[type="application/ld+json"]')
    .map((_, el) => $(el).contents().text())
    .get();

  for (const raw of blocks) {
    const product = findProductNode(safeParse(raw));
    if (!product) continue;

    const offer = firstOffer(product.offers);
    const price = offer?.price != null ? Number(offer.price) : null;
    const title = typeof product.name === 'string' ? product.name : null;
    if (!title) continue;

    return {
      sourceUrl: url,
      retailerKey,
      retailerSku: strOrNull(product.sku ?? product.productID),
      title,
      brand: brandName(product.brand),
      description: strOrNull(product.description),
      categoryPath: breadcrumb($),
      gtin: strOrNull(product.gtin13 ?? product.gtin ?? product.gtin12),
      mpn: strOrNull(product.mpn),
      price: Number.isFinite(price) ? price : null,
      listPrice: null,
      currency: offer?.priceCurrency === 'USD' ? 'USD' : 'CAD',
      availability: mapAvailability(offer?.availability),
      stockQty: null,
      imageUrl: firstImage(product.image),
      attributes: collectAttributes(product),
      capturedAt: new Date(),
    };
  }

  return null;
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

interface JsonLdProduct {
  '@type'?: string | string[];
  name?: unknown;
  sku?: unknown;
  productID?: unknown;
  description?: unknown;
  brand?: unknown;
  gtin?: unknown;
  gtin12?: unknown;
  gtin13?: unknown;
  mpn?: unknown;
  image?: unknown;
  offers?: unknown;
  color?: unknown;
  material?: unknown;
}

function findProductNode(node: unknown): JsonLdProduct | null {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findProductNode(item);
      if (found) return found;
    }
    return null;
  }
  const obj = node as Record<string, unknown>;
  const graph = obj['@graph'];
  if (Array.isArray(graph)) {
    const found = findProductNode(graph);
    if (found) return found;
  }
  const type = obj['@type'];
  const types = Array.isArray(type) ? type : [type];
  if (types.includes('Product')) return obj as JsonLdProduct;
  return null;
}

interface JsonLdOffer {
  price?: unknown;
  priceCurrency?: unknown;
  availability?: unknown;
}

function firstOffer(offers: unknown): JsonLdOffer | null {
  if (!offers) return null;
  if (Array.isArray(offers)) return (offers[0] as JsonLdOffer) ?? null;
  return offers as JsonLdOffer;
}

function mapAvailability(value: unknown): Availability {
  if (typeof value !== 'string') return 'unknown';
  const v = value.toLowerCase();
  if (v.includes('instock')) return 'in_stock';
  if (v.includes('outofstock') || v.includes('soldout')) return 'out_of_stock';
  if (v.includes('preorder')) return 'preorder';
  if (v.includes('discontinued')) return 'discontinued';
  return AvailabilitySchema.catch('unknown').parse(v);
}

function brandName(brand: unknown): string | null {
  if (typeof brand === 'string') return brand;
  if (brand && typeof brand === 'object' && 'name' in brand) {
    const name = (brand as { name?: unknown }).name;
    return typeof name === 'string' ? name : null;
  }
  return null;
}

function firstImage(image: unknown): string | null {
  if (typeof image === 'string') return image;
  if (Array.isArray(image) && typeof image[0] === 'string') return image[0];
  if (image && typeof image === 'object' && 'url' in image) {
    const url = (image as { url?: unknown }).url;
    return typeof url === 'string' ? url : null;
  }
  return null;
}

function breadcrumb($: cheerio.CheerioAPI): string[] {
  const items = $('[itemtype*="BreadcrumbList"] [itemprop="name"], nav.breadcrumb a, .breadcrumbs a')
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(Boolean);
  return Array.from(new Set(items));
}

function collectAttributes(product: JsonLdProduct): Record<string, string> {
  const attrs: Record<string, string> = {};
  if (typeof product.color === 'string') attrs.color = product.color;
  if (typeof product.material === 'string') attrs.material = product.material;
  return attrs;
}

function strOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
