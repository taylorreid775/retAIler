import * as cheerio from 'cheerio';
import { type RawExtractedProduct } from '@retailer/schema';
import { createLogger } from '@retailer/core';

const log = createLogger('crawler:listing-html');

export interface ListingHtmlExtractContext {
  retailerKey: string;
  productUrlPattern: RegExp;
  domain: string;
  origin: string;
  categoryPath: string[];
  currency?: 'CAD' | 'USD';
}

/**
 * Extract products from a category listing page HTML (static/browser fetch).
 * Requires title + url; price and image are best-effort.
 */
export function extractProductsFromListingHtml(
  html: string,
  ctx: ListingHtmlExtractContext,
): RawExtractedProduct[] {
  const $ = cheerio.load(html);
  const products: RawExtractedProduct[] = [];
  const seen = new Set<string>();

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href')?.trim();
    if (!href) return;
    const productUrl = resolveProductUrl(href, ctx.origin, ctx.domain);
    if (!productUrl || !ctx.productUrlPattern.test(productUrl)) return;

    const dedupeKey = productUrl.split('?')[0] ?? productUrl;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);

    const linkText = $(el).text().replace(/\s+/g, ' ').trim();
    const container = $(el).closest('article, li, div[class*="product"], div[class*="item"]');
    const blockText = container.length ? container.text() : linkText;
    const title = linkText || extractTitleFromUrl(productUrl);
    if (!title) return;

    const price = extractPrice(blockText);
    const listPrice = extractListPrice(blockText);
    const imageUrl = extractImage(container, ctx.origin);

    products.push({
      sourceUrl: productUrl,
      retailerKey: ctx.retailerKey,
      retailerSku: null,
      title,
      brand: null,
      description: null,
      categoryPath: ctx.categoryPath,
      gtin: null,
      mpn: null,
      price,
      listPrice,
      currency: ctx.currency ?? 'CAD',
      availability: 'unknown',
      stockQty: null,
      imageUrl,
      attributes: {},
      capturedAt: new Date(),
    });
  });

  const missingPrice = products.filter((p) => p.price == null).length;
  if (products.length > 0 && missingPrice / products.length > 0.5) {
    log.warn('listing HTML extraction: many products missing price', {
      retailerKey: ctx.retailerKey,
      total: products.length,
      missingPrice,
    });
  }

  return products;
}

/** Parse HTML for a rel=next link or common pagination patterns. */
export function findNextPageUrlInHtml(
  html: string,
  currentUrl: string,
  domain: string,
): string | null {
  const $ = cheerio.load(html);
  const origin = new URL(currentUrl).origin;

  const relNext = $('a[rel="next"], link[rel="next"]').attr('href');
  if (relNext) {
    const resolved = resolveProductUrl(relNext, origin, domain);
    if (resolved) return resolved;
  }

  for (const sel of ['a.next', 'a[aria-label*="next" i]', 'a.pagination-next']) {
    const href = $(sel).first().attr('href');
    if (href) {
      const resolved = resolveProductUrl(href, origin, domain);
      if (resolved && resolved !== currentUrl) return resolved;
    }
  }

  return null;
}

function resolveProductUrl(href: string, origin: string, domain: string): string | null {
  try {
    const url = new URL(href, origin).toString();
    if (!url.includes(domain)) return null;
    return url;
  } catch {
    return null;
  }
}

function extractTitleFromUrl(url: string): string {
  const path = new URL(url).pathname.split('/').filter(Boolean).pop() ?? '';
  return path.replace(/[-_]+/g, ' ').replace(/\.\w+$/, '').trim();
}

const PRICE_RE =
  /(?:NOW)?(?:CA\$|CAD|\$)\s*([\d,]+(?:\.\d{2})?)|([\d,]+(?:\.\d{2})?)\s*(?:CA\$|CAD|\$)/gi;
const LIST_PRICE_RE = /(?:was|list|regular)\s*(?:CA\$|CAD|\$)?\s*([\d,]+(?:\.\d{2})?)/i;

function extractPrice(text: string): number | null {
  PRICE_RE.lastIndex = 0;
  const m = PRICE_RE.exec(text);
  if (!m) return null;
  const raw = (m[1] ?? m[2] ?? '').replace(/,/g, '');
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : null;
}

function extractListPrice(text: string): number | null {
  const m = LIST_PRICE_RE.exec(text);
  if (!m?.[1]) return null;
  const n = Number.parseFloat(m[1].replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function extractImage(
  container: { find: (selector: string) => { first: () => { attr: (name: string) => string | undefined } } },
  origin: string,
): string | null {
  const img = container.find('img[src]').first().attr('src');
  if (!img) return null;
  try {
    return new URL(img, origin).toString();
  } catch {
    return null;
  }
}
