import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { magentoPlatformPack } from './magento.js';
import { bigcommercePlatformPack } from './bigcommerce.js';
import { woocommercePlatformPack } from './woocommerce.js';

const ctx = {
  origin: 'https://shop.example.com',
  domain: 'shop.example.com',
  homepageHtml: null,
  fetchJson: async () => null,
};

describe('magentoPlatformPack', () => {
  it('builds REST API recipe from probe response', () => {
    const recipe = magentoPlatformPack.buildRecipe(ctx, '', {
      status: 200,
      body: { items: [{ name: 'Boot', sku: 'B1' }] },
    });
    assert.ok(recipe);
    assert.match(recipe!.baseUrl, /\/rest\/V1\/products$/);
  });
});

describe('bigcommercePlatformPack', () => {
  it('builds storefront products recipe', () => {
    const recipe = bigcommercePlatformPack.buildRecipe(
      ctx,
      'https://shop.example.com/api/storefront/products',
      { status: 200, body: { data: [{ name: 'Hat', path: '/hat' }] } },
    );
    assert.ok(recipe);
    assert.equal(recipe?.pagination.pageParam, 'page');
  });
});

describe('woocommercePlatformPack', () => {
  it('builds store API recipe from array response', () => {
    const recipe = woocommercePlatformPack.buildRecipe(ctx, '', {
      status: 200,
      body: [{ name: 'Mug', permalink: 'https://shop.example.com/product/mug' }],
    });
    assert.ok(recipe);
    assert.match(recipe!.baseUrl, /wc\/store\/products/);
  });
});
