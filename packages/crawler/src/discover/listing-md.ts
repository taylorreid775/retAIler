import { type RawExtractedProduct } from '@retailer/schema';
import { createLogger } from '@retailer/core';

const log = createLogger('crawler:listing-md');

export interface ListingExtractContext {
  retailerKey: string;
  productUrlPattern: RegExp;
  domain: string;
  /** Site origin, e.g. https://www.example.com */
  origin: string;
  categoryPath: string[];
  currency?: 'CAD' | 'USD';
}

const PRICE_RE =
  /(?:NOW)?(?:CA\$|CAD|\$)\s*([\d,]+(?:\.\d{2})?)|([\d,]+(?:\.\d{2})?)\s*(?:CA\$|CAD|\$)/gi;
const LIST_PRICE_RE = /price\s+was\s+(?:CA\$|CAD|\$)?\s*([\d,]+(?:\.\d{2})?)/i;

/**
 * Extract products from a category listing page markdown (no AI).
 * Requires title + url; price and image are best-effort.
 */
export function extractProductsFromListingMd(
  markdown: string,
  ctx: ListingExtractContext,
): RawExtractedProduct[] {
  const blocks = splitIntoProductBlocks(markdown, ctx.productUrlPattern, ctx.origin, ctx.domain);
  const products: RawExtractedProduct[] = [];
  const seen = new Set<string>();

  for (const block of blocks) {
    const product = parseProductBlock(block, ctx);
    if (!product) continue;
    const dedupeKey = product.sourceUrl.split('?')[0] ?? product.sourceUrl;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    products.push(product);
  }

  const missingPrice = products.filter((p) => p.price == null).length;
  if (products.length > 0 && missingPrice / products.length > 0.5) {
    log.warn('listing extraction: many products missing price', {
      retailerKey: ctx.retailerKey,
      total: products.length,
      missingPrice,
    });
  }

  return products;
}

interface ProductBlock {
  productUrl: string;
  linkText: string;
  lines: string[];
  blockText: string;
}

function splitIntoProductBlocks(
  markdown: string,
  pattern: RegExp,
  origin: string,
  domain: string,
): ProductBlock[] {
  const lines = markdown.split('\n');
  const hits = new Map<string, { lineIndex: number; linkText: string; productUrl: string }>();

  // Simple single-level markdown links (per line).
  const linkRe = /\[([^\]]*)\]\(([^)]+)\)/g;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    let m: RegExpExecArray | null;
    linkRe.lastIndex = 0;
    while ((m = linkRe.exec(line)) !== null) {
      const linkText = (m[1] ?? '').trim();
      const href = (m[2] ?? '').trim();
      const productUrl = resolveProductUrl(href, origin, domain);
      if (!productUrl || !pattern.test(productUrl)) continue;
      const key = productUrl.split('?')[0] ?? productUrl;
      if (!hits.has(key)) hits.set(key, { lineIndex: i, linkText, productUrl });
    }
  }

  // Nested cards (e.g. Sport Chek: title + swatches + price inside one link).
  for (const nested of findNestedProductLinks(markdown, pattern, origin, domain)) {
    const key = nested.productUrl.split('?')[0] ?? nested.productUrl;
    const lineIndex = markdown.slice(0, nested.charIndex).split('\n').length - 1;
    const existing = hits.get(key);
    if (!existing || nested.linkText.length > existing.linkText.length) {
      hits.set(key, {
        lineIndex: Math.max(0, lineIndex),
        linkText: nested.linkText,
        productUrl: nested.productUrl,
      });
    }
  }

  const sorted = [...hits.values()].sort((a, b) => a.lineIndex - b.lineIndex);
  const blocks: ProductBlock[] = [];
  for (let h = 0; h < sorted.length; h++) {
    const hit = sorted[h]!;
    const nextLine = sorted[h + 1]?.lineIndex ?? lines.length;
    const start = Math.max(0, hit.lineIndex - 2);
    const end = Math.min(lines.length, nextLine);
    const chunk = lines.slice(start, end);
    const isNestedCard = hit.linkText.includes('![') && /\$[\d]/.test(hit.linkText);
    blocks.push({
      productUrl: hit.productUrl,
      linkText: hit.linkText,
      lines: chunk,
      blockText: isNestedCard ? hit.linkText : chunk.join('\n'),
    });
  }

  return blocks;
}

/** Find product links where link text contains nested markdown (Sport Chek PLPs). */
function findNestedProductLinks(
  markdown: string,
  pattern: RegExp,
  origin: string,
  domain: string,
): Array<{ productUrl: string; linkText: string; charIndex: number }> {
  const results: Array<{ productUrl: string; linkText: string; charIndex: number }> = [];
  const patternSource = pattern.source;
  const searchToken = patternSource.includes('pdp') ? '/pdp/' : patternSource.replace(/\\/g, '');

  let searchFrom = 0;
  while (searchFrom < markdown.length) {
    const idx = markdown.indexOf(searchToken, searchFrom);
    if (idx < 0) break;

    const parenOpen = markdown.lastIndexOf('(', idx);
    if (parenOpen < 0 || idx - parenOpen > 800) {
      searchFrom = idx + searchToken.length;
      continue;
    }
    const parenClose = markdown.indexOf(')', idx);
    if (parenClose < 0) {
      searchFrom = idx + searchToken.length;
      continue;
    }

    const href = markdown.slice(parenOpen + 1, parenClose).trim();
    const productUrl = resolveProductUrl(href, origin, domain);
    if (!productUrl || !pattern.test(productUrl)) {
      searchFrom = idx + searchToken.length;
      continue;
    }

    const linkText = extractLinkTextBeforeParen(markdown, parenOpen);
    const bracketStart = findBracketStartForLink(markdown, parenOpen);
    results.push({ productUrl, linkText, charIndex: Math.max(0, bracketStart) });
    searchFrom = parenClose + 1;
  }

  return results;
}

function findBracketStartForLink(md: string, parenOpen: number): number {
  if (md[parenOpen - 1] !== ']') return parenOpen;
  let depth = 0;
  for (let i = parenOpen - 2; i >= 0; i--) {
    const c = md[i];
    if (c === ']') depth++;
    else if (c === '[') {
      if (depth === 0) return i;
      depth--;
    }
  }
  return parenOpen;
}

function extractLinkTextBeforeParen(md: string, parenOpen: number): string {
  if (md[parenOpen - 1] !== ']') return '';
  const bracketClose = parenOpen - 1;
  let depth = 0;
  for (let i = bracketClose - 1; i >= 0; i--) {
    const c = md[i];
    if (c === ']') depth++;
    else if (c === '[') {
      if (depth === 0) return md.slice(i + 1, bracketClose);
      depth--;
    }
  }
  return '';
}

function parseProductBlock(
  block: ProductBlock,
  ctx: ListingExtractContext,
): RawExtractedProduct | null {
  const title = pickTitle(block);
  if (!title) return null;

  const text = block.blockText;
  const price = parsePrice(text);
  const listPrice = parseListPrice(text, price);
  const imageUrl = parseImageUrl(text);

  return {
    sourceUrl: block.productUrl,
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
  };
}

function pickTitle(block: ProductBlock): string | null {
  const fromLink = parseTitleFromLinkText(block.linkText);
  if (fromLink) return fromLink;

  if (
    block.linkText.length >= 2 &&
    block.linkText.length < 200 &&
    !/^(view|shop|buy|see)$/i.test(block.linkText) &&
    !block.linkText.startsWith('![')
  ) {
    return block.linkText;
  }

  for (const line of block.lines) {
    const heading = line.match(/^#{1,4}\s+(.+)/);
    if (heading?.[1]) return heading[1].trim();
  }

  return titleFromProductUrl(block.productUrl);
}

function parseTitleFromLinkText(text: string): string | null {
  const beforeImage = text.split('![')[0]?.trim().replace(/\s*\*\s*$/, '').trim();
  if (
    beforeImage &&
    beforeImage.length >= 3 &&
    beforeImage.length < 200 &&
    !beforeImage.startsWith('$') &&
    !/^NOW/i.test(beforeImage)
  ) {
    return beforeImage;
  }
  return null;
}

function titleFromProductUrl(url: string): string | null {
  const m = url.match(/\/pdp\/([^/?#]+)/i);
  if (!m?.[1]) return null;
  const slug = m[1].replace(/-[a-f0-9]{6,}[a-z]?$/i, '');
  const words = slug.split('-').filter((w) => w.length > 0 && !/^\d+$/.test(w));
  if (words.length < 2) return null;
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function parsePrice(text: string): number | null {
  // Sport Chek / similar: "$143.98 price was" or "NOW$56.97 price was"
  const anchored = text.match(/(?:NOW)?\$([\d,]+\.\d{2})\s+price\s+was/i);
  if (anchored?.[1]) {
    const n = Number.parseFloat(anchored[1].replace(/,/g, ''));
    if (Number.isFinite(n) && n > 1) return n;
  }

  // Drop savings parentheticals: "Save 20% ($36.02)"
  const stripped = text.replace(/Save\s+\d+%\s*\([^)]*\)/gi, '');
  const prices: number[] = [];
  for (const m of stripped.matchAll(PRICE_RE)) {
    const raw = (m[1] ?? m[2] ?? '').replace(/,/g, '');
    const n = Number.parseFloat(raw);
    if (Number.isFinite(n) && n > 1) prices.push(n);
  }
  if (!prices.length) return null;
  return Math.min(...prices);
}

function parseListPrice(text: string, salePrice: number | null): number | null {
  const was = LIST_PRICE_RE.exec(text);
  if (was?.[1]) {
    const n = Number.parseFloat(was[1].replace(/,/g, ''));
    if (Number.isFinite(n) && (salePrice == null || n > salePrice)) return n;
  }

  const prices: number[] = [];
  for (const m of text.matchAll(PRICE_RE)) {
    const raw = (m[1] ?? m[2] ?? '').replace(/,/g, '');
    const n = Number.parseFloat(raw);
    if (Number.isFinite(n) && n > 1) prices.push(n);
  }
  if (prices.length < 2 || salePrice == null) return null;
  const max = Math.max(...prices);
  return max > salePrice ? max : null;
}

function parseImageUrl(text: string): string | null {
  for (const m of text.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
    const u = m[1]?.trim();
    if (u?.startsWith('http') && !/\.svg(\?|$)/i.test(u)) return u;
  }
  return null;
}

function resolveProductUrl(href: string, origin: string, domain: string): string | null {
  try {
    const rootDomain = domain.split('.').slice(-2).join('.');
    if (href.startsWith('http')) {
      const host = new URL(href).host;
      if (!host.includes(rootDomain)) return null;
      return href.split('#')[0] ?? href;
    }
    if (href.startsWith('/')) {
      const resolved = new URL(href, origin).toString().split('#')[0];
      return resolved ?? null;
    }
  } catch {
    return null;
  }
  return null;
}
