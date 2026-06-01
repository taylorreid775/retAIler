import { walkSitemap } from '../sitemap.js';
import { type DiscoverContext, type RetailerAdapter } from './types.js';

export interface GenericAdapterConfig {
  key: string;
  name: string;
  domain: string;
  /** Sitemap entry point. Defaults to https://<domain>/sitemap.xml */
  sitemapUrl?: string;
  /** Substring/regex that identifies product-detail URLs. */
  productUrlPattern: string | RegExp;
}

/**
 * Build a sitemap-driven adapter from config alone — the fast path for
 * onboarding a new retailer. Extraction falls back to generic JSON-LD + LLM,
 * so no retailer-specific parsing code is required to start.
 */
export function createGenericAdapter(config: GenericAdapterConfig): RetailerAdapter {
  const pattern =
    typeof config.productUrlPattern === 'string'
      ? new RegExp(config.productUrlPattern, 'i')
      : config.productUrlPattern;
  const sitemapUrl = config.sitemapUrl ?? `https://${config.domain}/sitemap.xml`;

  return {
    key: config.key,
    name: config.name,
    domain: config.domain,
    isProductUrl: (url: string) => pattern.test(url) && url.includes(config.domain),
    async *discoverProductUrls(ctx: DiscoverContext): AsyncGenerator<string> {
      let count = 0;
      for await (const url of walkSitemap(sitemapUrl, (u) => pattern.test(u))) {
        if (ctx.categoryFilter && !ctx.categoryFilter.some((f) => url.toLowerCase().includes(f)))
          continue;
        yield url;
        if (ctx.limit && ++count >= ctx.limit) return;
      }
    },
  };
}
