import type { ApiRecipe } from '@retailer/schema';
import { getAtPath } from '../api-recipe.js';
import type { PlatformPack, ProbeContext, ProbeResponse } from './types.js';

const SHOPIFY_FIELD_MAP: ApiRecipe['fieldMap'] = {
  title: 'title',
  description: 'body_html',
  brand: 'vendor',
  sku: 'variants[0].sku',
  price: 'variants[0].price',
  listPrice: 'variants[0].compare_at_price',
  url: 'handle',
  image: 'images[0].src',
};

function productsArray(body: unknown): unknown[] | null {
  if (!body || typeof body !== 'object') return null;
  const products = (body as Record<string, unknown>).products;
  return Array.isArray(products) ? products : null;
}

export const shopifyPlatformPack: PlatformPack = {
  platform: 'shopify',
  probes: [
    {
      url: (ctx) => `${ctx.origin}/products.json?limit=250`,
      method: 'GET',
      successCheck: (res) => {
        const products = productsArray(res.body);
        return res.status >= 200 && res.status < 300 && (products?.length ?? 0) > 0;
      },
    },
    {
      url: (ctx) => `${ctx.origin}/collections.json`,
      method: 'GET',
      successCheck: (res) => {
        const collections = getAtPath(res.body, 'collections');
        return res.status >= 200 && res.status < 300 && Array.isArray(collections) && collections.length > 0;
      },
    },
  ],
  buildRecipe(ctx, _probeUrl, response): ApiRecipe | null {
    const products = productsArray(response.body);
    if (!products?.length) return null;

    return {
      baseUrl: `${ctx.origin}/products.json`,
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      staticQuery: {
        limit: '250',
      },
      pagination: {
        style: 'page',
        pageParam: 'page',
        itemsPerPage: 250,
        maxPages: 100,
        delayMs: 500,
      },
      productsPath: 'products',
      fieldMap: SHOPIFY_FIELD_MAP,
      urlPrefix: `${ctx.origin}/products`,
      currency: 'CAD',
    };
  },
};

export const SHOPIFY_PRODUCT_URL_PATTERN = '/products/';
