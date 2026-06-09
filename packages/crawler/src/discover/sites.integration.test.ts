import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fetchJinaMarkdown } from '../jina/fetcher.js';
import { extractProductsFromListingMd } from './listing-md.js';

const RUN_LIVE = process.env.JINA_INTEGRATION === '1';

const SITES = [
  {
    name: 'sportchek-running-shoes',
    listingUrl:
      'https://www.sportchek.ca/en/cat/activities-and-equipment/running/running-shoes-DC2000805.html',
    pattern: /\/pdp\//i,
    domain: 'www.sportchek.ca',
    origin: 'https://www.sportchek.ca',
    minProducts: 5,
  },
  {
    name: 'lululemon-home',
    listingUrl: 'https://shop.lululemon.com',
    pattern: /\/p\//i,
    domain: 'shop.lululemon.com',
    origin: 'https://shop.lululemon.com',
    expectJinaBlocked: true,
  },
] as const;

describe('Jina site integration', { skip: !RUN_LIVE }, () => {
  for (const site of SITES) {
    it(site.name, async () => {
      const result = await fetchJinaMarkdown(site.listingUrl);
      assert.ok(result, `Jina fetch failed for ${site.name}`);

      if ('expectJinaBlocked' in site && site.expectJinaBlocked) {
        assert.ok(
          result.markdown.includes('Bad Request') || result.markdown.length < 500,
          'expected Lululemon to block Jina',
        );
        return;
      }

      assert.ok(result.markdown.length > 5000, 'markdown too short — page may be blocked');

      const products = extractProductsFromListingMd(result.markdown, {
        retailerKey: site.name,
        productUrlPattern: site.pattern,
        domain: site.domain,
        origin: site.origin,
        categoryPath: ['Integration'],
      });

      const min = 'minProducts' in site ? site.minProducts : 1;
      assert.ok(
        products.length >= min,
        `expected >= ${min} products, got ${products.length}`,
      );

      const withPrice = products.filter((p) => p.price != null).length;
      assert.ok(withPrice >= min * 0.5, `too few products with price: ${withPrice}`);
    });
  }
});
