import type { ApiRecipe } from '@retailer/schema';
import { getAtPath } from '../api-recipe.js';
import type { PlatformPack, ProbeResponse } from './types.js';

const WOOCOMMERCE_FIELD_MAP: ApiRecipe['fieldMap'] = {
  title: 'name',
  description: 'description',
  sku: 'sku',
  price: 'prices.price',
  listPrice: 'prices.regular_price',
  url: 'permalink',
  image: 'images[0].src',
};

function storeProducts(body: unknown): unknown[] | null {
  if (Array.isArray(body) && body.length > 0) return body;
  const items = getAtPath(body, 'products');
  return Array.isArray(items) && items.length > 0 ? items : null;
}

export const woocommercePlatformPack: PlatformPack = {
  platform: 'woocommerce',
  probes: [
    {
      url: (ctx) => `${ctx.origin}/wp-json/wc/store/products?page=1&per_page=20`,
      method: 'GET',
      headers: { Accept: 'application/json' },
      successCheck: (res: ProbeResponse) => {
        const products = storeProducts(res.body);
        return res.status >= 200 && res.status < 300 && (products?.length ?? 0) > 0;
      },
    },
  ],
  buildRecipe(ctx, _probeUrl, response): ApiRecipe | null {
    if (!storeProducts(response.body)?.length) return null;

    return {
      baseUrl: `${ctx.origin}/wp-json/wc/store/products`,
      method: 'GET',
      headers: { Accept: 'application/json' },
      staticQuery: {
        page: '1',
        per_page: '20',
      },
      pagination: {
        style: 'page',
        pageParam: 'page',
        itemsPerPage: 20,
        maxPages: 100,
        delayMs: 800,
      },
      productsPath: '',
      fieldMap: WOOCOMMERCE_FIELD_MAP,
      currency: 'CAD',
    };
  },
};

export const WOOCOMMERCE_PRODUCT_URL_PATTERN = '/product/';
