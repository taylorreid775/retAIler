import { walkSitemap } from '../sitemap';
import { type DiscoverContext, type RetailerAdapter } from './types';

export interface GenericAdapterConfig {
  key: string;
  name: string;
  domain: string;
  /**
   * Sitemap entry point(s). Accepts one URL or several (e.g. a retailer that
   * splits products across sitemap-product-1p.xml, sitemap-product-3p.xml, …).
   * Defaults to https://<domain>/sitemap.xml
   */
  sitemapUrl?: string | string[];
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
  const sitemapUrls =
    config.sitemapUrl == null
      ? [`https://${config.domain}/sitemap.xml`]
      : Array.isArray(config.sitemapUrl)
        ? config.sitemapUrl
        : [config.sitemapUrl];

  return {
    key: config.key,
    name: config.name,
    domain: config.domain,
    isProductUrl: (url: string) => pattern.test(url) && url.includes(config.domain),
    async *discoverProductUrls(ctx: DiscoverContext): AsyncGenerator<string> {
      let count = 0;
      const seen = new Set<string>();
      // Walk every product sitemap. Pass through the browser fetch override so
      // JS/Cloudflare-protected sitemaps can still be read for browser sites.
      for (const sitemapUrl of sitemapUrls) {
        for await (const url of walkSitemap(sitemapUrl, (u) => pattern.test(u), {
          fetchText: ctx.fetchText,
        })) {
          if (seen.has(url)) continue;
          seen.add(url);
          if (ctx.categoryFilter && !ctx.categoryFilter.some((f) => url.toLowerCase().includes(f)))
            continue;
          yield url;
          if (ctx.limit && ++count >= ctx.limit) return;
        }
      }
    },
  };
}
