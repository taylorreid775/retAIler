import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { finalizeCapturedRequests } from './header-deps.js';
import { buildCapturedRequest } from './network-types.js';

describe('finalizeCapturedRequests ordering', () => {
  it('sorts by capture sequence before dependency inference', () => {
    const second = buildCapturedRequest({
      url: 'https://shop.example.com/api/catalog',
      pageUrl: 'https://shop.example.com/',
      method: 'GET',
      resourceType: 'fetch',
      requestHeaders: { cookie: 'sid=1' },
      responseHeaders: {},
      status: 200,
      contentType: 'application/json',
      responseBody: '{"products":[{"id":"1"}]}',
      productLikeScore: 0.95,
      timing: { startMs: 200, durationMs: 1 },
      cookiesRequired: [],
    });
    const first = buildCapturedRequest({
      url: 'https://shop.example.com/bootstrap',
      pageUrl: 'https://shop.example.com/',
      method: 'GET',
      resourceType: 'fetch',
      requestHeaders: {},
      responseHeaders: { 'set-cookie': 'sid=1; Path=/' },
      status: 200,
      contentType: 'application/json',
      responseBody: '{}',
      productLikeScore: 0.1,
      timing: { startMs: 100, durationMs: 0 },
      cookiesRequired: [],
    });

    const out = finalizeCapturedRequests([second, first]);
    const catalog = out.find((c) => c.url.includes('/api/catalog'));
    assert.ok(catalog);
    assert.deepEqual(catalog.dependsOn, ['https://shop.example.com/bootstrap']);
  });
});
