import type { ApiRecipe } from '@retailer/schema';
import { getAtPath } from '../api-recipe.js';
import type { PlatformPack, ProbeResponse } from './types.js';

const BIGCOMMERCE_FIELD_MAP: ApiRecipe['fieldMap'] = {
  title: 'name',
  description: 'description',
  brand: 'brand.name',
  sku: 'sku',
  price: 'price.value',
  listPrice: 'retail_price.value',
  url: 'path',
  image: 'default_image.url',
};

function storefrontProducts(body: unknown): unknown[] | null {
  const paths = ['data', 'products', 'items'];
  for (const path of paths) {
    const value = getAtPath(body, path);
    if (Array.isArray(value) && value.length > 0) return value;
  }
  return null;
}

export const bigcommercePlatformPack: PlatformPack = {
  platform: 'bigcommerce',
  probes: [
    {
      url: (ctx) => `${ctx.origin}/api/storefront/products?limit=24`,
      method: 'GET',
      headers: { Accept: 'application/json' },
      successCheck: (res: ProbeResponse) => {
        const products = storefrontProducts(res.body);
        return res.status >= 200 && res.status < 300 && (products?.length ?? 0) > 0;
      },
    },
    {
      url: (ctx) => `${ctx.origin}/api/storefront/search?query=&limit=24`,
      method: 'GET',
      headers: { Accept: 'application/json' },
      successCheck: (res: ProbeResponse) => {
        const products = storefrontProducts(res.body);
        return res.status >= 200 && res.status < 300 && (products?.length ?? 0) > 0;
      },
    },
  ],
  buildRecipe(ctx, probeUrl, response): ApiRecipe | null {
    if (!storefrontProducts(response.body)?.length) return null;

    const isSearch = probeUrl.includes('/search');
    return {
      baseUrl: isSearch
        ? `${ctx.origin}/api/storefront/search`
        : `${ctx.origin}/api/storefront/products`,
      method: 'GET',
      headers: { Accept: 'application/json' },
      staticQuery: isSearch
        ? { query: '', limit: '24' }
        : { limit: '24' },
      pagination: {
        style: 'page',
        pageParam: 'page',
        itemsPerPage: 24,
        maxPages: 100,
        delayMs: 500,
      },
      productsPath: getAtPath(response.body, 'data') ? 'data' : 'products',
      fieldMap: BIGCOMMERCE_FIELD_MAP,
      urlPrefix: ctx.origin,
      currency: 'CAD',
    };
  },
};

export const BIGCOMMERCE_PRODUCT_URL_PATTERN = '/product/';
