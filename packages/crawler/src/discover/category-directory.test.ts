import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractCategoriesHeuristic } from './category-directory.js';

const fixtureDir = dirname(fileURLToPath(import.meta.url));

describe('extractCategoriesHeuristic', () => {
  it('extracts Sport Chek category URLs from nav markdown snippet', () => {
    const md = `
### [Women](https://www.sportchek.ca/en/cat/women-DC2000007.html)
[Running Shoes](https://www.sportchek.ca/en/cat/women/footwear/running-shoes-DC2000961.html)
[Men](https://www.sportchek.ca/en/cat/men-DC1338793.html)
[Wishlist](https://www.sportchek.ca/en/wishlist.html)
[Mystery Mini Ball](https://www.sportchek.ca/en/pdp/adidas-ball-85736423f.html)
`;
    const result = extractCategoriesHeuristic(md, 'www.sportchek.ca');
    assert.ok(result.categories.length >= 3);
    assert.equal(result.productUrlPattern, '/pdp/');
    assert.ok(result.categories.some((c) => c.url.includes('running-shoes')));
    assert.ok(!result.categories.some((c) => c.url.includes('wishlist')));
    assert.ok(!result.categories.some((c) => c.url.includes('/pdp/')));
  });

  it('extracts many categories from Sport Chek homepage fixture when present', () => {
    const fixturePath = join(fixtureDir, 'fixtures/sportchek-home-nav.md');
    let md: string;
    try {
      md = readFileSync(fixturePath, 'utf8');
    } catch {
      return; // optional fixture — live probe validates full homepage
    }
    const result = extractCategoriesHeuristic(md, 'www.sportchek.ca');
    assert.ok(result.categories.length >= 20);
  });
});
