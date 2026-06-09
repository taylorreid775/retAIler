import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildApiPageQuery } from './api-recipe.js';

describe('buildApiPageQuery', () => {
  it('uses page numbers for page style', () => {
    const query = buildApiPageQuery(
      {
        baseUrl: 'https://shop.example.com/products.json',
        method: 'GET',
        headers: {},
        staticQuery: { limit: '250' },
        pagination: { style: 'page', pageParam: 'page', itemsPerPage: 250, maxPages: 10, delayMs: 0 },
        productsPath: 'products',
        fieldMap: { title: 'title' },
        currency: 'CAD',
      },
      2,
    );
    assert.equal(query.page, '2');
  });

  it('uses zero-based offsets for offset style', () => {
    const query = buildApiPageQuery(
      {
        baseUrl: 'https://store.example.com/search',
        method: 'GET',
        headers: {},
        staticQuery: { count: '24', q: '' },
        pagination: {
          style: 'offset',
          pageParam: 'start',
          itemsPerPage: 24,
          maxPages: 10,
          delayMs: 0,
        },
        productsPath: 'hits',
        fieldMap: { title: 'title' },
        currency: 'CAD',
      },
      2,
    );
    assert.equal(query.start, '24');
  });
});
