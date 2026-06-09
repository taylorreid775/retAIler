import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { refreshApiHeaders } from './header-refresh.js';
import type { CrawlRecipe } from '@retailer/schema';

const baseRecipe: CrawlRecipe = {
  version: 1,
  sources: ['network_sniff'],
  discoveryMode: 'api',
  sitemapUrls: [],
  productUrlPattern: null,
  listingUrlPattern: null,
  fetchStrategy: 'browser',
  extractionStrategy: 'json_ld',
  platform: null,
  extractionHints: { imageJsonPaths: [], priceJsonPaths: [] },
  sampleProductUrls: [],
  agentFileUrl: null,
  notes: [],
  confidence: 0.8,
  api: {
    baseUrl: 'https://shop.example.com/api/products',
    method: 'GET',
    headers: { Accept: 'application/json', 'X-Old': '1' },
    staticQuery: {},
    pagination: { style: 'page', pageParam: 'page', maxPages: 10, delayMs: 500 },
    productsPath: 'products',
    fieldMap: { title: 'name', price: 'price', url: 'url' },
    currency: 'CAD',
  },
  jina: null,
};

describe('refreshApiHeaders', () => {
  it('patches non-sensitive headers when values differ', () => {
    const patched = refreshApiHeaders(baseRecipe, {
      Accept: 'application/json',
      'X-Old': '2',
      'X-New': 'fresh',
      Cookie: 'session=refreshed',
    });

    assert.ok(patched);
    assert.equal(patched.api?.headers['X-Old'], '2');
    assert.equal(patched.api?.headers['X-New'], 'fresh');
    assert.equal(patched.api?.headers.Cookie, 'session=refreshed');
  });

  it('returns null when nothing changed', () => {
    const patched = refreshApiHeaders(baseRecipe, { Accept: 'application/json', 'X-Old': '1' });
    assert.equal(patched, null);
  });

  it('merges Cookie header from browser context capture', () => {
    const patched = refreshApiHeaders(baseRecipe, {
      Cookie: 'session=abc123',
    });

    assert.ok(patched);
    assert.equal(patched.api?.headers.Cookie, 'session=abc123');
  });
});
