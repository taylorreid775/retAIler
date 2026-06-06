import { type RawExtractedProduct } from '@retailer/schema';
import { walkSitemap } from '../sitemap';
import { type DiscoverContext, type RetailerAdapter } from './types';

const LISTING_SITEMAP = 'https://www.mec.ca/en/sitemap-categories-en.xml';
const ORIGIN = 'https://www.mec.ca';

/**
 * MEC (www.mec.ca). Product PDPs: /en/product/<sku>/<slug>.
 * The product sitemap in the root index 404s; discover via /en/products/*
 * listing pages from sitemap-categories-en.xml instead.
 */
export const mecAdapter: RetailerAdapter = {
  key: 'mec',
  name: 'MEC',
  domain: 'www.mec.ca',

  isProductUrl(url: string): boolean {
    return /\/en\/product\//i.test(url) && url.includes('mec.ca');
  },

  async *discoverProductUrls(ctx: DiscoverContext): AsyncGenerator<string> {
    const seen = new Set<string>();
    let count = 0;

    for await (const listingUrl of walkSitemap(
      LISTING_SITEMAP,
      (u) => u.includes('/en/products/'),
      { fetchText: ctx.fetchText },
    )) {
      if (ctx.categoryFilter && !ctx.categoryFilter.some((f) => listingUrl.toLowerCase().includes(f)))
        continue;

      const html = ctx.fetchText ? await ctx.fetchText(listingUrl) : null;
      if (!html) continue;

      for (const productUrl of extractProductUrls(html)) {
        if (seen.has(productUrl)) continue;
        seen.add(productUrl);
        yield productUrl;
        if (ctx.limit && ++count >= ctx.limit) return;
      }
    }
  },

  parseProduct(html: string, url: string): RawExtractedProduct | null {
    const block = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!block) return null;

    let pageProps: MecPageProps;
    try {
      pageProps = JSON.parse(block[1] ?? '').props?.pageProps as MecPageProps;
    } catch {
      return null;
    }

    const product = pageProps?.product;
    if (!product?.name) return null;

    const guest = pageProps.customerGroupPrices?.guest?.price;
    const price = guest?.lowPrice?.value ?? guest?.price?.value ?? null;
    const listRaw = guest?.baseHighPrice?.value ?? guest?.highPrice?.value ?? null;
    const listPrice =
      listRaw != null && price != null && listRaw > price ? listRaw : null;

    const imageUrl =
      product.images?.[0]?.url ??
      product.images?.[0]?.src ??
      product.images?.[0]?.imageUrl ??
      null;

    return {
      sourceUrl: url,
      retailerKey: 'mec',
      retailerSku: product.code ?? pageProps.productCode ?? null,
      title: product.name,
      brand: typeof product.brand === 'string' ? product.brand : product.brand?.name ?? null,
      description: product.shortDescription ?? product.description ?? null,
      categoryPath: (product.breadcrumbs ?? []).map((b) => b.name ?? b.label ?? '').filter(Boolean),
      gtin: null,
      mpn: null,
      price: typeof price === 'number' ? price : null,
      listPrice,
      currency: 'CAD',
      availability: mapAvailability(product.availabilityStatus),
      stockQty: null,
      imageUrl: imageUrl?.startsWith('http') ? imageUrl : imageUrl ? `${ORIGIN}${imageUrl}` : null,
      attributes: {},
      capturedAt: new Date(),
    };
  },
};

interface MecPageProps {
  productCode?: string;
  customerGroupPrices?: {
    guest?: {
      price?: {
        lowPrice?: { value?: number };
        price?: { value?: number };
        baseHighPrice?: { value?: number };
        highPrice?: { value?: number };
      };
    };
  };
  product?: {
    name?: string;
    code?: string;
    brand?: string | { name?: string };
    description?: string;
    shortDescription?: string;
    availabilityStatus?: string;
    breadcrumbs?: Array<{ name?: string; label?: string }>;
    images?: Array<{ url?: string; src?: string; imageUrl?: string }>;
  };
}

function mapAvailability(status?: string): RawExtractedProduct['availability'] {
  const s = status?.toLowerCase() ?? '';
  if (s.includes('in_stock') || s.includes('instock') || s === 'available') return 'in_stock';
  if (s.includes('out')) return 'out_of_stock';
  if (s.includes('preorder')) return 'preorder';
  return 'unknown';
}

function extractProductUrls(html: string): string[] {
  const urls = new Set<string>();
  for (const match of html.matchAll(/href="(\/en\/product\/[^"?#]+)/gi)) {
    urls.add(`${ORIGIN}${match[1]}`);
  }
  return [...urls];
}
