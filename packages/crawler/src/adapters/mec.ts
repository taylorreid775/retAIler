import { walkSitemap } from '../sitemap.js';
import { type DiscoverContext, type RetailerAdapter } from './types.js';

/**
 * MEC (www.mec.ca). Product URLs follow "/en/product/<id>/<slug>".
 */
export const mecAdapter: RetailerAdapter = {
  key: 'mec',
  name: 'MEC',
  domain: 'www.mec.ca',

  isProductUrl(url: string): boolean {
    return /\/product\//i.test(url) && url.includes('mec.ca');
  },

  async *discoverProductUrls(ctx: DiscoverContext): AsyncGenerator<string> {
    let count = 0;
    for await (const url of walkSitemap(
      'https://www.mec.ca/sitemap.xml',
      (u) => this.isProductUrl(u),
    )) {
      if (ctx.categoryFilter && !ctx.categoryFilter.some((f) => url.toLowerCase().includes(f)))
        continue;
      yield url;
      if (ctx.limit && ++count >= ctx.limit) return;
    }
  },
};
