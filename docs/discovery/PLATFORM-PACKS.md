# Platform Packs

Deterministic, zero-token discovery paths for known commerce platforms. **Build these first** — highest ROI.

Platform packs run in Stage 1 (parallel with static analysis) when `RetailerFingerprint.platformConfidence >= 0.5`.

## Location

```
packages/crawler/src/discover/platform-packs/
  index.ts          # runPlatformPack(fingerprint) → ApiRecipe[]
  shopify.ts
  shopify-hydrogen.ts
  salesforce.ts
  magento.ts
  bigcommerce.ts
  woocommerce.ts
  commercetools.ts
```

## Shopify

### Probes (in order)

```
GET /products.json?limit=250
GET /collections.json
GET /sitemap_products_1.xml
```

### Storefront GraphQL

```
POST /api/{version}/graphql.json
```

Detect `X-Shopify-Storefront-Access-Token` from page source or meta tags.

### Default Field Map

```typescript
const SHOPIFY_FIELD_MAP = {
  title: 'title',
  description: 'body_html',
  brand: 'vendor',
  sku: 'variants[0].sku',
  price: 'variants[0].price',
  regularPrice: 'variants[0].compare_at_price',
  url: 'handle',  // prefix with shop URL
  imageUrl: 'images[0].src',
  availability: 'variants[0].available',
};
```

### Pagination

- `products.json`: `page` query param
- Storefront GraphQL: `cursor` / `hasNextPage` / `endCursor`

### Discovery Mode

`discoveryMode: 'api'` when `products.json` or Storefront GraphQL validates.

---

## Shopify Hydrogen

### Probes

```
POST /api/unstable/graphql.json
POST /api/{version}/graphql.json
```

### Signals

- `@shopify/hydrogen` in bundles
- Oxygen deployment headers
- Storefront API token in SSR HTML

### Notes

Hydrogen often uses Storefront GraphQL exclusively — no `products.json`. Prioritize GraphQL probe.

---

## Salesforce Commerce Cloud

### Probes

```
GET /s/{siteId}/dw/shop/v21_10/product_search?count=24&q=
GET /on/demandware.store/Sites-{site}-Site/default/Product-Show?pid={sample}
```

### Site ID Detection

- `__NEXT_DATA__.props.site` or `__NEXT_DATA__.props.pageProps.site`
- HTML meta tags
- URL path patterns (`/s/SportChekCA/`)

### Reference Implementation

Hand-authored recipe: `packages/schema/src/recipes/sportchek-crawl-recipe.ts`

### Pagination

- `start` offset param
- `count` page size
- Response `count` / `total` fields

### Category Iteration

Many SFCC sites require category/group params (e.g. `group=MEN`). Discover from network capture or category page URLs.

---

## BigCommerce

### Probes

```
GET /api/storefront/products
GET /api/storefront/search?query=
```

### Detection

- `bigcommerce.com` CDN URLs
- `window.BCData` or `stencilBootstrap` in HTML
- `channel_id` from bootstrap data

### Pagination

Stencil search API uses `page` param. GraphQL storefront may be available on headless builds.

---

## Magento 2

### Probes

```
GET /rest/V1/products?searchCriteria[pageSize]=20&searchCriteria[currentPage]=1
POST /graphql  (product search query)
```

### Detection

- `mage/` script paths
- `data-mage-init` attributes
- `/rest/V1/` in network captures

### Pagination

REST: `searchCriteria[currentPage]`
GraphQL: `page_info` / `total_pages`

---

## WooCommerce

### Probes

```
GET /wp-json/wc/store/products?page=1&per_page=20
GET /wp-json/wc/v3/products (may require auth — lower priority)
```

### Detection

- `wp-content` paths
- WooCommerce blocks in HTML
- `/wp-json/wc/store/` in network captures

---

## Commercetools

### Probes

```
POST /graphql
```

With product query operations detected from bundle analysis or network capture.

### Detection

- `commercetools` in bundles
- GraphQL operation names: `products`, `productProjectionSearch`

---

## Platform Pack Interface

```typescript
interface PlatformPack {
  platform: Platform;
  probes: ProbeDefinition[];
  buildRecipe(domain: string, probeResult: ProbeResult): ApiRecipe | null;
  defaultFieldMap: Record<string, string | string[]>;
  paginationHints: Partial<ApiPagination>;
}

interface ProbeDefinition {
  url: string | ((ctx: ProbeContext) => string);
  method: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  successCheck: (response: ProbeResponse) => boolean;
}
```

## Success Rate Tracking

Store per-platform success rates in DB or config. Deprioritize packs with <50% validation success across recent discoveries.

## Cross-Retailer Pattern Library

As packs mature, extract URL shape patterns:

- "This URL shape is a Salesforce search API" → skip network sniff
- "This header template works for 90% of Shopify stores"

Store in `retailer_endpoints` aggregated views or a future `endpoint_patterns` table.
