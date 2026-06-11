import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  cookieNamesFromHeader,
  cookieNamesFromSetCookie,
  finalizeCapturedRequests,
  inferHeaderDependencies,
  mergeReplayContextFromCapture,
  redactHeadersForHar,
  replayableHeaders,
  selectCaptureForReplay,
} from './header-deps.js';
import { buildCapturedRequest } from './network-types.js';

describe('cookie parsing', () => {
  it('extracts cookie names from request header', () => {
    assert.deepEqual(cookieNamesFromHeader('session=abc; cart=1'), ['session', 'cart']);
  });

  it('extracts cookie names from Set-Cookie', () => {
    assert.deepEqual(cookieNamesFromSetCookie(['session=abc; Path=/; HttpOnly']), ['session']);
  });
});

function sampleCapture(overrides: Partial<ReturnType<typeof buildCapturedRequest>> = {}) {
  return buildCapturedRequest({
    url: 'https://shop.example.com/api/products',
    pageUrl: 'https://shop.example.com/',
    method: 'GET',
    resourceType: 'xhr',
    requestHeaders: {},
    responseHeaders: {},
    status: 200,
    contentType: 'application/json',
    responseBody: '{"products":[]}',
    productLikeScore: 0.9,
    timing: { startMs: 0, durationMs: 0 },
    cookiesRequired: [],
    ...overrides,
  });
}

describe('inferHeaderDependencies', () => {
  it('links dependsOn to prior Set-Cookie responses', () => {
    const captures = inferHeaderDependencies([
      sampleCapture({
        url: 'https://shop.example.com/session',
        responseHeaders: { 'set-cookie': 'session=abc; Path=/' },
      }),
      sampleCapture({
        requestHeaders: { cookie: 'session=abc' },
      }),
    ]);

    assert.deepEqual(captures[1]?.cookiesRequired, ['session']);
    assert.deepEqual(captures[1]?.dependsOn, ['https://shop.example.com/session']);
  });
});

describe('finalizeCapturedRequests', () => {
  it('infers dependencies before ranking by score', () => {
    const low = sampleCapture({
      url: 'https://shop.example.com/session',
      productLikeScore: 0.2,
      timing: { startMs: 0, durationMs: 0 },
      responseHeaders: { 'set-cookie': 'session=abc; Path=/' },
    });
    const high = sampleCapture({
      productLikeScore: 0.95,
      timing: { startMs: 100, durationMs: 1 },
      requestHeaders: { cookie: 'session=abc' },
    });

    const finalized = finalizeCapturedRequests([low, high]);
    assert.equal(finalized[0]?.productLikeScore, 0.95);
    assert.deepEqual(finalized[0]?.dependsOn, ['https://shop.example.com/session']);
  });
});

describe('replay helpers', () => {
  it('redacts sensitive headers for HAR', () => {
    const redacted = redactHeadersForHar({
      Accept: 'application/json',
      Cookie: 'session=secret',
      Authorization: 'Bearer token',
    });
    assert.equal(redacted.Accept, 'application/json');
    assert.equal(redacted.Cookie, '[REDACTED]');
    assert.equal(redacted.Authorization, '[REDACTED]');
  });

  it('merges replayable headers and cookies into ApiRecipe', () => {
    const api = mergeReplayContextFromCapture(
      {
        baseUrl: 'https://shop.example.com/api/products',
        method: 'GET',
        headers: { Accept: 'application/json' },
        staticQuery: {},
        pagination: { style: 'page', pageParam: 'page', maxPages: 10, delayMs: 0 },
        productsPath: 'products',
        fieldMap: { title: 'name' },
        currency: 'CAD',
      },
      sampleCapture({
        method: 'POST',
        requestHeaders: {
          accept: 'application/json',
          cookie: 'session=abc',
          referer: 'https://shop.example.com/',
          'x-custom': 'value',
        },
        requestBody: '{"query":"{ products { id } }"}',
        graphqlOperationName: 'Products',
      }),
    );

    assert.equal(api.method, 'POST');
    assert.equal(api.headers.Cookie, 'session=abc');
    assert.equal(api.headers['x-custom'], 'value');
    assert.equal(api.requestBody, '{"query":"{ products { id } }"}');
    assert.equal(api.graphqlOperationName, 'Products');
    assert.equal(replayableHeaders({ Authorization: 'x', Accept: 'json' }).Authorization, undefined);
  });

  it('selects capture matching recipe base URL', () => {
    const captures = [
      sampleCapture({ url: 'https://shop.example.com/other', productLikeScore: 0.99 }),
      sampleCapture({ url: 'https://shop.example.com/api/products?page=1', productLikeScore: 0.8 }),
    ];
    const selected = selectCaptureForReplay(captures, 'https://shop.example.com/api/products');
    assert.equal(selected?.url, 'https://shop.example.com/api/products?page=1');
  });
});
