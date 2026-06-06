import { type RawExtractedProduct } from '@retailer/schema';
import {
  buildSearchUrl,
  categoriesForFilter,
  mapApiProduct,
  type SportChekSearchResponse,
} from './sportchek-api';
import { type DiscoverContext, type RetailerAdapter } from './types';

const PRODUCTS_PER_PAGE = 10;
const PAGE_DELAY_MS = 500;

/**
 * Sport Chek (www.sportchek.ca). Uses the public search API (same as sportchek
 * ai) for accurate prices — not sitemap + JSON-LD PDP scraping.
 */
export const sportchekAdapter: RetailerAdapter = {
  key: 'sportchek',
  name: 'Sport Chek',
  domain: 'www.sportchek.ca',

  isProductUrl(url: string): boolean {
    return /\/pdp\//i.test(url) && url.includes('sportchek.ca');
  },

  async *discoverProducts(ctx: DiscoverContext): AsyncGenerator<RawExtractedProduct> {
    if (!ctx.fetchJson) {
      throw new Error('sportchek discoverProducts requires ctx.fetchJson');
    }

    const categories = categoriesForFilter(ctx.categoryFilter);
    const seen = new Set<string>();
    let count = 0;

    for (const category of categories) {
      let page = 1;
      let totalPages: number | undefined;

      while (true) {
        if (ctx.limit && count >= ctx.limit) return;

        const url = buildSearchUrl({ group: category.group, page });
        const data = (await ctx.fetchJson(url)) as SportChekSearchResponse | null;
        if (!data?.products?.length) break;

        if (page === 1) {
          totalPages = data.pagination?.total;
        }

        for (const product of data.products) {
          if (ctx.limit && count >= ctx.limit) return;
          const raw = mapApiProduct(product, category.label);
          if (!raw || seen.has(raw.sourceUrl)) continue;
          seen.add(raw.sourceUrl);
          yield raw;
          count += 1;
        }

        if (data.products.length < PRODUCTS_PER_PAGE) break;
        if (totalPages && page >= totalPages) break;
        if (page >= 100) break;

        page += 1;
        await sleep(PAGE_DELAY_MS);
      }
    }
  },

  /** Legacy sitemap path — prefer discoverProducts when fetchJson is available. */
  async *discoverProductUrls(ctx: DiscoverContext): AsyncGenerator<string> {
    if (ctx.fetchJson) return;
    // Sitemap fallback only when API fetch is unavailable.
    const { walkSitemap } = await import('../sitemap');
    let count = 0;
    for await (const url of walkSitemap(
      'https://www.sportchek.ca/sitemap.xml',
      (u) => this.isProductUrl(u),
      { fetchText: ctx.fetchText },
    )) {
      if (ctx.categoryFilter && !matchesCategory(url, ctx.categoryFilter)) continue;
      yield url;
      if (ctx.limit && ++count >= ctx.limit) return;
    }
  },
};

function matchesCategory(url: string, filters: string[]): boolean {
  const lower = url.toLowerCase();
  return filters.some((f) => lower.includes(f.toLowerCase()));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
