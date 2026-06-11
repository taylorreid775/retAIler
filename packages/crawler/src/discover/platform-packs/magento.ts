import type { ApiRecipe } from '@retailer/schema';
import { getAtPath } from '../api-recipe.js';
import type { PlatformPack, ProbeContext, ProbeResponse } from './types.js';

const MAGENTO_FIELD_MAP: ApiRecipe['fieldMap'] = {
  title: 'name',
  description: 'custom_attributes.description',
  brand: 'custom_attributes.manufacturer',
  sku: 'sku',
  price: 'price',
  url: 'custom_attributes.url_key',
  image: 'media_gallery_entries[0].file',
};

function productItems(body: unknown): unknown[] | null {
  const items = getAtPath(body, 'items');
  return Array.isArray(items) && items.length > 0 ? items : null;
}

export const magentoPlatformPack: PlatformPack = {
  platform: 'magento',
  probes: [
    {
      url: (ctx) =>
        `${ctx.origin}/rest/V1/products?searchCriteria[pageSize]=20&searchCriteria[currentPage]=1`,
      method: 'GET',
      headers: { Accept: 'application/json' },
      successCheck: (res) => {
        const items = productItems(res.body);
        return res.status >= 200 && res.status < 300 && (items?.length ?? 0) > 0;
      },
    },
  ],
  buildRecipe(ctx, _probeUrl, response): ApiRecipe | null {
    if (!productItems(response.body)?.length) return null;

    return {
      baseUrl: `${ctx.origin}/rest/V1/products`,
      method: 'GET',
      headers: { Accept: 'application/json' },
      staticQuery: {
        'searchCriteria[pageSize]': '20',
        'searchCriteria[currentPage]': '1',
      },
      pagination: {
        style: 'page',
        pageParam: 'searchCriteria[currentPage]',
        itemsPerPage: 20,
        maxPages: 100,
        delayMs: 800,
      },
      productsPath: 'items',
      fieldMap: MAGENTO_FIELD_MAP,
      urlPrefix: ctx.origin,
      currency: 'CAD',
    };
  },
};

export const MAGENTO_PRODUCT_URL_PATTERN = '/product/';
