import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { extractProductsFromListingHtml, findNextPageUrlInHtml } from './listing-html.js';

const HTML = `
<html><body>
  <article class="product-item">
    <a href="/products/running-shoe">Running Shoe</a>
    <span>CA$99.99</span>
    <img src="/img/shoe.jpg" />
  </article>
  <a href="/about">About</a>
</body></html>
`;

describe('extractProductsFromListingHtml', () => {
  it('extracts product links matching pattern', () => {
    const products = extractProductsFromListingHtml(HTML, {
      retailerKey: 'test',
      productUrlPattern: /\/products\//,
      domain: 'example.com',
      origin: 'https://example.com',
      categoryPath: ['Shoes'],
    });
    assert.equal(products.length, 1);
    assert.equal(products[0]?.title, 'Running Shoe');
    assert.equal(products[0]?.price, 99.99);
    assert.ok(products[0]?.sourceUrl.includes('/products/running-shoe'));
  });
});

describe('findNextPageUrlInHtml', () => {
  it('finds rel=next link', () => {
    const html = '<a rel="next" href="/collections/shoes?page=2">Next</a>';
    const next = findNextPageUrlInHtml(html, 'https://example.com/collections/shoes', 'example.com');
    assert.equal(next, 'https://example.com/collections/shoes?page=2');
  });
});
