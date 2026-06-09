import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fingerprintSite } from './index.js';
import { detectPlatformSignals, detectLegacyPlatform } from './signals.js';

describe('detectPlatformSignals', () => {
  it('detects Shopify from CDN and products.json hints', () => {
    const result = detectPlatformSignals({
      lowerHtml: 'cdn.shopify.com shopify.theme',
      urls: ['https://example.myshopify.com/products.json'],
    });
    assert.equal(result.platform, 'shopify');
    assert.ok(result.confidence >= 0.5);
  });

  it('detects Salesforce from demandware markers', () => {
    const result = detectPlatformSignals({
      lowerHtml: 'demandware dw.ac /on/demandware.store/',
      urls: [],
    });
    assert.equal(result.platform, 'salesforce');
    assert.ok(result.confidence >= 0.3);
  });
});

describe('detectLegacyPlatform', () => {
  it('maps shopify_hydrogen signals to shopify crawl platform', () => {
    assert.equal(
      detectLegacyPlatform('@shopify/hydrogen cdn.shopify.com', []),
      'shopify',
    );
  });
});

describe('fingerprintSite', () => {
  it('recommends platform_pack for high-confidence Shopify', () => {
    const fp = fingerprintSite({
      domain: 'shop.example.com',
      homepageUrl: 'https://shop.example.com',
      homepageHtml: '<html>cdn.shopify.com Shopify.theme</html>',
      agentUrls: ['https://shop.example.com/products.json'],
    });
    assert.equal(fp.platform, 'shopify');
    assert.ok(fp.platformConfidence >= 0.5);
    assert.equal(fp.recommendedStrategy, 'platform_pack');
  });

  it('defaults to sitemap strategy for unknown sites', () => {
    const fp = fingerprintSite({
      domain: 'unknown.example.com',
      homepageUrl: 'https://unknown.example.com',
      homepageHtml: '<html>hello</html>',
    });
    assert.equal(fp.platform, 'unknown');
    assert.equal(fp.recommendedStrategy, 'sitemap');
  });
});
