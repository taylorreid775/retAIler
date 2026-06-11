import {
  ListingPaginationSchema,
  type CrawlRecipe,
  type ListingPagination,
  type RawExtractedProduct,
} from '@retailer/schema';
import { createLogger } from '@retailer/core';
import { extractProductsFromListingHtml, findNextPageUrlInHtml } from '../discover/listing-html';
import {
  buildPaginatedUrls,
  type PaginationState,
} from '../discover/pagination';
import {
  buildCategoryPath,
  deactivateListingPage,
  touchListingPageCrawled,
  type ListingPageRow,
} from '../discover/listing-pages-db';
import { type DiscoverContext, type RetailerAdapter } from './types';

const log = createLogger('crawler:listing-pages-adapter');

export interface ListingPagesAdapterConfig {
  key: string;
  name: string;
  domain: string;
  recipe: CrawlRecipe;
  listingPages: ListingPageRow[];
  retailerId: string;
}

/** Build a static/browser listing-page adapter from persisted crawl recipe + DB rows. */
export function createListingPagesAdapter(config: ListingPagesAdapterConfig): RetailerAdapter {
  const patternSource =
    config.recipe.productUrlPattern ??
    config.recipe.jina?.productUrlPattern ??
    '/product/';
  const pattern = new RegExp(patternSource, 'i');
  const defaultPagination =
    config.recipe.jina?.pagination ?? ListingPaginationSchema.parse({ style: 'none' });

  const byId = new Map(config.listingPages.map((p) => [p.id, p]));

  return {
    key: config.key,
    name: config.name,
    domain: config.domain,

    isProductUrl(url: string): boolean {
      return pattern.test(url) && url.includes(config.domain);
    },

    async *discoverProductUrls(): AsyncGenerator<string> {
      // Listing mode ingests via discoverProducts; no URL fan-out.
    },

    async *discoverProducts(ctx: DiscoverContext): AsyncGenerator<RawExtractedProduct> {
      if (!ctx.fetchText) {
        throw new Error('listing_pages adapter requires fetchText in DiscoverContext');
      }

      const seen = new Set<string>();
      let count = 0;
      let listingPagesCrawled = 0;

      for (const page of config.listingPages) {
        if (!page.active) continue;

        const pagination = page.pagination ?? defaultPagination;
        const categoryPath = buildCategoryPath(page, byId);
        const state: PaginationState = {
          pageIndex: 0,
          seenUrls: new Set(),
          seenHashes: new Set(),
        };

        let pageProducts = 0;
        const urlsToVisit: string[] = [];

        if (pagination.style === 'link_rel') {
          urlsToVisit.push(page.url);
        } else {
          for (const u of buildPaginatedUrls(page.url, pagination, state)) {
            urlsToVisit.push(u);
          }
        }

        let linkRelQueue = [...urlsToVisit];
        let pagesVisited = 0;

        while (linkRelQueue.length > 0 && pagesVisited < (pagination.maxPages ?? 50)) {
          const pageUrl = linkRelQueue.shift()!;
          const norm = pageUrl.replace(/\/$/, '');
          if (state.seenUrls.has(norm)) continue;
          state.seenUrls.add(norm);

          const html = await ctx.fetchText(pageUrl);
          if (!html) {
            log.warn('listing page fetch failed', { retailerKey: config.key, pageUrl });
            continue;
          }

          const hash = String(html.length);
          if (state.seenHashes.has(hash)) break;
          state.seenHashes.add(hash);

          const origin = `https://${config.domain}`;
          const products = extractProductsFromListingHtml(html, {
            retailerKey: config.key,
            productUrlPattern: pattern,
            domain: config.domain,
            origin,
            categoryPath,
          });

          for (const raw of products) {
            if (seen.has(raw.sourceUrl)) continue;
            seen.add(raw.sourceUrl);
            yield raw;
            pageProducts += 1;
            count += 1;
            if (ctx.limit && count >= ctx.limit) return;
          }

          pagesVisited += 1;

          if (pagination.style === 'link_rel' || products.length === 0) {
            const next = findNextPageUrlInHtml(html, pageUrl, config.domain);
            if (next && !state.seenUrls.has(next.replace(/\/$/, ''))) {
              linkRelQueue.push(next);
            } else if (products.length === 0) {
              break;
            }
          }
        }

        listingPagesCrawled += 1;
        await touchListingPageCrawled(page.id);

        if (pageProducts === 0) {
          log.warn('listing page yielded no products', {
            retailerKey: config.key,
            url: page.url,
            label: page.label,
          });
          await deactivateListingPage(page.id);
        }
      }

      log.info('listing_pages discovery complete', {
        retailerKey: config.key,
        listingPagesCrawled,
        products: count,
      });
    },
  };
}
