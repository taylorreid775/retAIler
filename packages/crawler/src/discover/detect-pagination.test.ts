import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyDetectedPagination } from './detect-pagination.js';
import type { ApiRecipe } from '@retailer/schema';

const baseApi: ApiRecipe = {
  baseUrl: 'https://shop.example.com/api/products',
  method: 'GET',
  headers: {},
  staticQuery: {},
  pagination: { style: 'page', pageParam: 'page', maxPages: 10, delayMs: 0 },
  productsPath: 'products',
  fieldMap: { title: 'name', price: 'price', url: 'url' },
  currency: 'CAD',
};

describe('applyDetectedPagination', () => {
  it('merges cursor pagination fields', () => {
    const patched = applyDetectedPagination(baseApi, {
      style: 'cursor',
      pageParam: 'after',
      cursorPath: 'page_info.end_cursor',
      itemsPerPage: 24,
    });

    assert.equal(patched.pagination.style, 'cursor');
    assert.equal(patched.pagination.pageParam, 'after');
    assert.equal(patched.pagination.cursorPath, 'page_info.end_cursor');
    assert.equal(patched.pagination.itemsPerPage, 24);
  });

  it('merges link_rel pagination fields', () => {
    const patched = applyDetectedPagination(baseApi, {
      style: 'link_rel',
      pageParam: null,
      nextUrlPath: 'links.next',
    });

    assert.equal(patched.pagination.style, 'link_rel');
    assert.equal(patched.pagination.nextUrlPath, 'links.next');
  });
});
