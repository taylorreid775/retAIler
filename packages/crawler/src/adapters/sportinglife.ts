import { walkSitemap } from '../sitemap';
import { type DiscoverContext, type RetailerAdapter } from './types';

/**
 * Sporting Life (www.sportinglife.ca). Shopify-style storefront → product
 * URLs under "/products/". Mostly server-rendered → static fetch strategy.
 */
export const sportingLifeAdapter: RetailerAdapter = {
  key: 'sportinglife',
  name: 'Sporting Life',
  domain: 'www.sportinglife.ca',

  isProductUrl(url: string): boolean {
    return /\/products\//i.test(url) && url.includes('sportinglife.ca');
  },

  async *discoverProductUrls(ctx: DiscoverContext): AsyncGenerator<string> {
    let count = 0;
    for await (const url of walkSitemap(
      'https://www.sportinglife.ca/sitemap.xml',
      (u) => this.isProductUrl(u),
      { fetchText: ctx.fetchText },
    )) {
      if (ctx.categoryFilter && !ctx.categoryFilter.some((f) => url.toLowerCase().includes(f)))
        continue;
      yield url;
      if (ctx.limit && ++count >= ctx.limit) return;
    }
  },
};
