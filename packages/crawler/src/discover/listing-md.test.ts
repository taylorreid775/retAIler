import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractProductsFromListingMd } from './listing-md.js';

const fixtureDir = dirname(fileURLToPath(import.meta.url));

describe('extractProductsFromListingMd', () => {
  const ctx = {
    retailerKey: 'test',
    productUrlPattern: /\/products\//i,
    domain: 'shop.example.com',
    origin: 'https://shop.example.com',
    categoryPath: ['Footwear', 'Running'],
  };

  it('extracts title, price, url, and image from markdown blocks', () => {
    const md = `
# Running Shoes

![Trail Runner](https://cdn.example.com/trail.jpg)

[Trail Runner Pro](https://shop.example.com/products/trail-runner-pro)

$129.99 CAD

[Another Shoe](https://shop.example.com/products/other-shoe) $89.00
`;

    const products = extractProductsFromListingMd(md, ctx);
    assert.equal(products.length, 2);
    assert.equal(products[0]?.title, 'Trail Runner Pro');
    assert.equal(products[0]?.sourceUrl, 'https://shop.example.com/products/trail-runner-pro');
    assert.equal(products[0]?.price, 129.99);
    assert.equal(products[0]?.imageUrl, 'https://cdn.example.com/trail.jpg');
    assert.deepEqual(products[0]?.categoryPath, ['Footwear', 'Running']);
  });

  it('skips links that do not match product pattern', () => {
    const md = '[About Us](https://shop.example.com/about)';
    const products = extractProductsFromListingMd(md, ctx);
    assert.equal(products.length, 0);
  });

  it('extracts Sport Chek nested product cards from fixture', () => {
    const md = readFileSync(join(fixtureDir, 'fixtures/sportchek-running-shoes.md'), 'utf8');
    const products = extractProductsFromListingMd(md, {
      retailerKey: 'sportchek',
      productUrlPattern: /\/pdp\//i,
      domain: 'www.sportchek.ca',
      origin: 'https://www.sportchek.ca',
      categoryPath: ['Running', 'Running Shoes'],
    });

    assert.equal(products.length, 3);
    assert.equal(products[0]?.title, "HOKA Women's Clifton 10 Running Shoes");
    assert.equal(products[0]?.price, 143.98);
    assert.equal(products[0]?.listPrice, 180);
    assert.ok(products[0]?.imageUrl?.includes('sportchek.ca'));
    assert.ok(products[0]?.sourceUrl.includes('/pdp/hoka-women-s-clifton-10'));

    assert.equal(products[1]?.title, "adidas Men's Duramo SL 2 Running Shoes");
    assert.equal(products[1]?.price, 56.97);
    assert.equal(products[1]?.listPrice, 94.99);

    assert.equal(products[2]?.title, "Hoka Men's Mach 6 Running Shoes");
    assert.equal(products[2]?.price, 122.97);
    assert.equal(products[2]?.listPrice, 165);
  });
});
