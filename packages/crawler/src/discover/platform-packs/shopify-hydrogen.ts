import type { ApiRecipe } from '@retailer/schema';
import { getAtPath } from '../api-recipe.js';
import type { PlatformPack, ProbeContext, ProbeResponse } from './types.js';

const STOREFRONT_PRODUCTS_QUERY = JSON.stringify({
  query: `query Products($first: Int!) {
    products(first: $first) {
      edges {
        node {
          id
          title
          handle
          vendor
          featuredImage { url }
          variants(first: 1) { edges { node { sku price { amount } } } }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }`,
  variables: { first: 24 },
});

const HYDROGEN_FIELD_MAP: ApiRecipe['fieldMap'] = {
  title: 'node.title',
  brand: 'node.vendor',
  sku: 'node.variants.edges[0].node.sku',
  price: 'node.variants.edges[0].node.price.amount',
  url: 'node.handle',
  image: 'node.featuredImage.url',
};

function hydrogenEdges(body: unknown): unknown[] | null {
  const edges = getAtPath(body, 'data.products.edges');
  return Array.isArray(edges) && edges.length > 0 ? edges : null;
}

function extractStorefrontToken(html: string | null): string | null {
  if (!html) return null;
  const match = html.match(/shopify-storefront-access-token["'\s:=]+([a-f0-9]{32})/i);
  return match?.[1] ?? null;
}

function probeHeaders(ctx: ProbeContext): Record<string, string> {
  const token = extractStorefrontToken(ctx.homepageHtml);
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(token ? { 'X-Shopify-Storefront-Access-Token': token } : {}),
  };
}

export const shopifyHydrogenPlatformPack: PlatformPack = {
  platform: 'shopify_hydrogen',
  probes: [
    {
      url: (ctx) => `${ctx.origin}/api/unstable/graphql.json`,
      method: 'POST',
      headers: probeHeaders,
      body: STOREFRONT_PRODUCTS_QUERY,
      successCheck: (res: ProbeResponse) => {
        const edges = hydrogenEdges(res.body);
        return res.status >= 200 && res.status < 300 && (edges?.length ?? 0) > 0;
      },
    },
    {
      url: (ctx) => `${ctx.origin}/api/2024-01/graphql.json`,
      method: 'POST',
      headers: probeHeaders,
      body: STOREFRONT_PRODUCTS_QUERY,
      successCheck: (res: ProbeResponse) => {
        const edges = hydrogenEdges(res.body);
        return res.status >= 200 && res.status < 300 && (edges?.length ?? 0) > 0;
      },
    },
  ],
  buildRecipe(ctx, probeUrl, response): ApiRecipe | null {
    if (!hydrogenEdges(response.body)?.length) return null;

    return {
      baseUrl: probeUrl,
      method: 'POST',
      headers: probeHeaders(ctx),
      staticQuery: {},
      requestBody: STOREFRONT_PRODUCTS_QUERY,
      pagination: {
        style: 'cursor',
        pageParam: 'after',
        cursorPath: 'data.products.pageInfo.endCursor',
        itemsPerPage: 24,
        maxPages: 100,
        delayMs: 500,
      },
      productsPath: 'data.products.edges',
      fieldMap: HYDROGEN_FIELD_MAP,
      urlPrefix: `${ctx.origin}/products`,
      graphqlOperationName: 'Products',
      currency: 'CAD',
    };
  },
};

export const SHOPIFY_HYDROGEN_PRODUCT_URL_PATTERN = '/products/';
