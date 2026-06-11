import type { ApiRecipe } from '@retailer/schema';
import { getAtPath } from '../api-recipe.js';
import type { PlatformPack, ProbeContext, ProbeResponse } from './types.js';

const COMMERCETOOLS_QUERY = JSON.stringify({
  query: `query Products($limit: Int) {
    products(limit: $limit) {
      results {
        id
        masterData {
          current {
            name(locale: "en")
            slug(locale: "en")
            masterVariant {
              sku
              prices { value { centAmount currencyCode } }
              images { url }
            }
          }
        }
      }
    }
  }`,
  variables: { limit: 20 },
});

const COMMERCETOOLS_FIELD_MAP: ApiRecipe['fieldMap'] = {
  title: 'masterData.current.name.en',
  sku: 'masterData.current.masterVariant.sku',
  price: 'masterData.current.masterVariant.prices[0].value.centAmount',
  url: 'masterData.current.slug.en',
  image: 'masterData.current.masterVariant.images[0].url',
};

function commercetoolsProducts(body: unknown): unknown[] | null {
  const results = getAtPath(body, 'data.products.results');
  return Array.isArray(results) && results.length > 0 ? results : null;
}

export const commercetoolsPlatformPack: PlatformPack = {
  platform: 'commercetools',
  probes: [
    {
      url: (ctx) => `${ctx.origin}/graphql`,
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: COMMERCETOOLS_QUERY,
      successCheck: (res: ProbeResponse) => {
        const products = commercetoolsProducts(res.body);
        return res.status >= 200 && res.status < 300 && (products?.length ?? 0) > 0;
      },
    },
  ],
  buildRecipe(ctx: ProbeContext, probeUrl, response): ApiRecipe | null {
    if (!commercetoolsProducts(response.body)?.length) return null;

    return {
      baseUrl: probeUrl,
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      staticQuery: {},
      requestBody: COMMERCETOOLS_QUERY,
      pagination: {
        style: 'offset',
        pageParam: 'offset',
        itemsPerPage: 20,
        maxPages: 100,
        delayMs: 800,
      },
      productsPath: 'data.products.results',
      fieldMap: COMMERCETOOLS_FIELD_MAP,
      urlPrefix: ctx.origin,
      graphqlOperationName: 'Products',
      currency: 'CAD',
    };
  },
};

export const COMMERCETOOLS_PRODUCT_URL_PATTERN = '/product/';
