import { walkSitemap } from '../sitemap';
import { type DiscoverContext, type RetailerAdapter } from './types';

const PRODUCTS_SITEMAP = 'https://www.decathlon.ca/decathlon-products-index.xml';

/**
 * Decathlon Canada (www.decathlon.ca). Product PDPs live under /en/p/<slug>/<id>/<sku>.
 * English-only URLs avoid duplicating the French /fr/p/ entries in the sitemap.
 * PDPs embed schema.org Product JSON-LD — static fetch is sufficient.
 */
export const decathlonAdapter: RetailerAdapter = {
  key: 'decathlon',
  name: 'Decathlon',
  domain: 'www.decathlon.ca',

  isProductUrl(url: string): boolean {
    return /\/en\/p\//i.test(url) && url.includes('decathlon.ca');
  },

  async *discoverProductUrls(ctx: DiscoverContext): AsyncGenerator<string> {
    let count = 0;
    for await (const url of walkSitemap(
      PRODUCTS_SITEMAP,
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
