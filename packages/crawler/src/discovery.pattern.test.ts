import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deriveProductPattern, rankProductCandidateUrl } from './discovery.js';

describe('rankProductCandidateUrl', () => {
  it('prefers category-nested PDPs over short /pdp/ stubs', () => {
    const short =
      'https://www.sportchek.ca/en/pdp/holbrook-cincinnati-matte-black-w-prizm-black-10654666f.html';
    const canonical =
      'https://www.sportchek.ca/en/cat/accessories/sunglasses/holbrook-cincinnati-matte-black-w-prizm-black-10654666f.html';
    assert.ok(rankProductCandidateUrl(canonical) > rankProductCandidateUrl(short));
  });
});

describe('deriveProductPattern', () => {
  it('derives /cat/ prefix for category-nested product URLs', () => {
    const urls = [
      'https://www.sportchek.ca/en/cat/accessories/sunglasses/holbrook-cincinnati-matte-black-w-prizm-black-10654666f.html',
      'https://www.sportchek.ca/en/cat/accessories/sunglasses/another-product-10654667f.html',
      'https://www.sportchek.ca/en/cat/footwear/running-shoes/some-shoe-12345678f.html',
    ];
    assert.equal(deriveProductPattern(urls), '/cat/');
  });

  it('does not reduce category-nested URLs to bare /pdp/', () => {
    const urls = [
      'https://www.sportchek.ca/en/cat/accessories/sunglasses/holbrook-cincinnati-matte-black-w-prizm-black-10654666f.html',
      'https://www.sportchek.ca/en/cat/footwear/running-shoes/some-shoe-12345678f.html',
    ];
    assert.equal(deriveProductPattern(urls), '/cat/');
  });
});
