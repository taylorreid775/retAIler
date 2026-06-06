import { walkSitemap } from '../sitemap';
import { type DiscoverContext, type RetailerAdapter } from './types';

/**
 * Sport Chek (www.sportchek.ca). JS-heavy storefront → browser fetch strategy
 * (configured on the retailer row). Product URLs contain "/product/".
 */
export const sportchekAdapter: RetailerAdapter = {
  key: 'sportchek',
  name: 'Sport Chek',
  domain: 'www.sportchek.ca',

  isProductUrl(url: string): boolean {
    return /\/pdp\//i.test(url) && url.includes('sportchek.ca');
  },

  async *discoverProductUrls(ctx: DiscoverContext): AsyncGenerator<string> {
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
