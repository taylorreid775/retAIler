import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { shopifyPlatformPack } from './shopify.js';

describe('shopifyPlatformPack', () => {
  it('builds a products.json API recipe from a successful probe', () => {
    const ctx = {
      origin: 'https://shop.example.com',
      domain: 'shop.example.com',
      homepageHtml: null,
      fetchJson: async () => null,
    };
    const response = {
      status: 200,
      body: {
        products: [
          {
            title: 'Test Shoe',
            handle: 'test-shoe',
            vendor: 'Acme',
            variants: [{ sku: 'SKU1', price: '99.00' }],
            images: [{ src: 'https://shop.example.com/img.jpg' }],
          },
        ],
      },
    };

    const recipe = shopifyPlatformPack.buildRecipe(
      ctx,
      'https://shop.example.com/products.json?limit=250',
      response,
    );
    assert.ok(recipe);
    assert.equal(recipe?.baseUrl, 'https://shop.example.com/products.json');
    assert.equal(recipe?.productsPath, 'products');
    assert.equal(recipe?.pagination.pageParam, 'page');
    assert.equal(recipe?.urlPrefix, 'https://shop.example.com/products');
  });
});
