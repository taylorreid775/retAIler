import type { ApiRecipe } from '@retailer/schema';
import { getAtPath } from '../api-recipe.js';
import type { PlatformPack, ProbeContext, ProbeResponse } from './types.js';

const SFCC_API_VERSION = 'v21_10';

function extractSiteId(ctx: ProbeContext): string | null {
  const html = ctx.homepageHtml ?? '';
  const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (nextDataMatch) {
    try {
      const data = JSON.parse(nextDataMatch[1]!) as Record<string, unknown>;
      const props = getAtPath(data, 'props') as Record<string, unknown> | undefined;
      const site =
        (getAtPath(props, 'site') as string | undefined) ??
        (getAtPath(props, 'pageProps.site') as string | undefined);
      if (site && typeof site === 'string') return site;
    } catch {
      // ignore malformed __NEXT_DATA__
    }
  }

  const pathMatch = ctx.origin.match(/\/s\/([^/]+)/i);
  if (pathMatch?.[1]) return pathMatch[1];

  const sitePathMatch = html.match(/\/s\/([A-Za-z0-9_-]+)\//);
  if (sitePathMatch?.[1]) return sitePathMatch[1];

  return null;
}

function productHits(body: unknown): { items: unknown[]; path: string } | null {
  const paths = ['hits', 'products', 'data.products', 'productSearch.hits'];
  for (const path of paths) {
    const value = getAtPath(body, path);
    if (Array.isArray(value) && value.length > 0) return { items: value, path };
  }
  return null;
}

function buildSearchUrl(ctx: ProbeContext, siteId: string): string {
  return `${ctx.origin}/s/${siteId}/dw/shop/${SFCC_API_VERSION}/product_search?count=24&q=`;
}

export const salesforcePlatformPack: PlatformPack = {
  platform: 'salesforce',
  probes: [
    {
      url: (ctx) => {
        const siteId = extractSiteId(ctx);
        if (!siteId) return `${ctx.origin}/__sfcc_probe_invalid__`;
        return buildSearchUrl(ctx, siteId);
      },
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      successCheck: (res) => {
        const hit = productHits(res.body);
        return res.status >= 200 && res.status < 300 && (hit?.items.length ?? 0) > 0;
      },
    },
  ],
  buildRecipe(ctx, probeUrl, response): ApiRecipe | null {
    const hit = productHits(response.body);
    if (!hit?.items.length) return null;

    const siteId = extractSiteId(ctx);
    if (!siteId) return null;

    return {
      baseUrl: buildSearchUrl(ctx, siteId),
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      staticQuery: {
        count: '24',
        q: '',
      },
      pagination: {
        style: 'offset',
        pageParam: 'start',
        itemsPerPage: 24,
        totalPagesPath: null,
        maxPages: 100,
        delayMs: 800,
      },
      productsPath: hit.path,
      fieldMap: {
        title: ['productName', 'name', 'title'],
        url: ['productUrl', 'url', 'link'],
        sku: ['productId', 'id', 'sku'],
        price: ['price.sales.value', 'price', 'minPrice'],
        listPrice: ['price.list.value', 'listPrice'],
        image: ['image.url', 'image', 'images[0].url'],
        brand: ['brand', 'manufacturerName'],
      },
      urlPrefix: ctx.origin,
      currency: 'CAD',
    };
  },
};

export const SALESFORCE_PRODUCT_URL_PATTERNS = ['/pdp/', '/cat/'];

export { extractSiteId as extractSalesforceSiteId };
