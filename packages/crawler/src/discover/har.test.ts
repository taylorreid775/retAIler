import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildHarFromCaptures } from './har.js';
import { buildCapturedRequest } from './network-types.js';

describe('buildHarFromCaptures', () => {
  it('builds HAR 1.2 entries from captures', () => {
    const har = buildHarFromCaptures([
      buildCapturedRequest({
        url: 'https://shop.example.com/api/products?page=1',
        pageUrl: 'https://shop.example.com/',
        method: 'GET',
        resourceType: 'fetch',
        requestHeaders: { Accept: 'application/json' },
        responseHeaders: { 'content-type': 'application/json' },
        status: 200,
        contentType: 'application/json',
        responseBody: '{"products":[{"id":"1"}]}',
        productLikeScore: 0.9,
        timing: { startMs: 0, durationMs: 120 },
        cookiesRequired: [],
      }),
    ]);

    assert.equal(har.log.version, '1.2');
    assert.equal(har.log.entries.length, 1);
    assert.equal(har.log.entries[0]?.request.method, 'GET');
    assert.equal(har.log.entries[0]?.response.status, 200);
    assert.ok(har.log.entries[0]?.request.queryString.some((q) => q.name === 'page'));
  });

  it('redacts sensitive headers in stored HAR entries', () => {
    const har = buildHarFromCaptures([
      buildCapturedRequest({
        url: 'https://shop.example.com/api/products',
        pageUrl: 'https://shop.example.com/',
        method: 'GET',
        resourceType: 'fetch',
        requestHeaders: { Cookie: 'session=secret', Accept: 'application/json' },
        responseHeaders: { 'set-cookie': 'session=abc; Path=/' },
        status: 200,
        contentType: 'application/json',
        responseBody: '{"products":[]}',
        productLikeScore: 0.9,
        timing: { startMs: 0, durationMs: 120 },
        cookiesRequired: [],
      }),
    ]);

    const reqCookie = har.log.entries[0]?.request.headers.find((h) => h.name === 'Cookie');
    assert.equal(reqCookie?.value, '[REDACTED]');
  });
});
