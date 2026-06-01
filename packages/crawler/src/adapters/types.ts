import { type RawExtractedProduct } from '@retailer/schema';

export interface DiscoverContext {
  /** Optional category-path filter for partial crawls. */
  categoryFilter?: string[];
  /** Hard cap on number of URLs to yield (for sampling / dev). */
  limit?: number;
}

/**
 * A RetailerAdapter encapsulates everything retailer-specific:
 * how to discover product URLs and (optionally) a custom structured parser.
 * Generic JSON-LD + LLM extraction handles retailers without a custom parser.
 */
export interface RetailerAdapter {
  /** Stable key, must match the retailers.key column. */
  readonly key: string;
  readonly name: string;
  readonly domain: string;

  /** Yields product-detail-page URLs to crawl. */
  discoverProductUrls(ctx: DiscoverContext): AsyncGenerator<string>;

  /** True if a URL looks like a product detail page for this retailer. */
  isProductUrl(url: string): boolean;

  /**
   * Optional retailer-specific structured parser, tried before generic
   * JSON-LD / LLM extraction. Return null to defer to the generic path.
   */
  parseProduct?(html: string, url: string): RawExtractedProduct | null;
}
