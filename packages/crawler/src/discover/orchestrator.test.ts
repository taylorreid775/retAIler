import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CrawlRecipeSchema, type RetailerFingerprint } from '@retailer/schema';
import type { SiteDiscovery } from '../discovery';
import {
  resolvePlatformPackResult,
  scoreStaticDiscovery,
  selectDiscoveryCandidate,
  shouldPreferPlatformPack,
  type OrchestratorDeps,
  type PlatformPackAttemptResult,
} from './orchestrator.js';

function baseCrawlRecipe(overrides: Record<string, unknown> = {}) {
  return CrawlRecipeSchema.parse({
    discoveryMode: 'sitemap',
    fetchStrategy: 'static',
    confidence: 0.8,
    productUrlPattern: '/products/',
    sampleProductUrls: ['https://example.com/products/a'],
    sitemapUrls: ['https://example.com/sitemap.xml'],
    ...overrides,
  });
}

function baseDiscovery(overrides: Partial<SiteDiscovery> = {}): SiteDiscovery {
  const crawlRecipe = baseCrawlRecipe(
    overrides.crawlRecipe ? (overrides.crawlRecipe as Record<string, unknown>) : {},
  );
  return {
    key: 'example',
    name: 'Example',
    domain: 'example.com',
    homepageUrl: 'https://example.com',
    homepageHtml: '<html></html>',
    sitemapUrl: 'https://example.com/sitemap.xml',
    sitemapUrls: ['https://example.com/sitemap.xml'],
    productUrlPattern: '/products/',
    llmsTxtUrl: null,
    agentFiles: [],
    fetchStrategy: 'static',
    confidence: 0.8,
    sampleProductUrls: ['https://example.com/products/a', 'https://example.com/products/b'],
    crawlDelayMs: 1000,
    notes: 'sitemap ok',
    crawlRecipe,
    ...overrides,
  };
}

const fingerprint: RetailerFingerprint = {
  domain: 'example.com',
  platform: 'shopify',
  platformConfidence: 0.9,
  framework: 'unknown',
  commerceEngine: 'shopify',
  botProtection: 'none',
  apiHints: ['products.json'],
  bundleSignals: [],
  recommendedStrategy: 'platform_pack',
  detectedAt: new Date().toISOString(),
};

function validatedPackResult(
  confidence: number,
  discovery: SiteDiscovery = baseDiscovery({
    confidence,
    crawlRecipe: baseCrawlRecipe({
      discoveryMode: 'api',
      confidence,
      api: {
        baseUrl: 'https://example.com/products.json',
        productsPath: 'products',
        fieldMap: { title: 'title' },
        pagination: { style: 'page', pageParam: 'page', maxPages: 10, delayMs: 500 },
      },
    }),
  }),
): PlatformPackAttemptResult {
  return {
    used: true,
    discovery,
    validationReport: {
      endpoint: 'https://example.com/products.json',
      reliability: 1,
      estimatedCatalogSize: 100,
      paginationVerified: true,
      paginationStyle: 'page',
      paginationParam: 'page',
      fieldsPresent: {},
      failureModes: [],
      confidence,
    },
  };
}

describe('scoreStaticDiscovery', () => {
  it('boosts sitemap paths with a product pattern', () => {
    const score = scoreStaticDiscovery(
      baseDiscovery({
        confidence: 0.4,
        crawlRecipe: baseCrawlRecipe({ confidence: 0.4 }),
      }),
    );
    assert.equal(score, 0.6);
  });

  it('uses raw confidence when no sitemap pattern evidence', () => {
    const score = scoreStaticDiscovery(
      baseDiscovery({
        confidence: 0.3,
        sitemapUrls: [],
        productUrlPattern: null,
        crawlRecipe: baseCrawlRecipe({ confidence: 0.3, productUrlPattern: null, sitemapUrls: [] }),
      }),
    );
    assert.equal(score, 0.3);
  });
});

describe('shouldPreferPlatformPack', () => {
  it('prefers validated pack over sitemap-only static even when static confidence is higher', () => {
    const staticDiscovery = baseDiscovery({ confidence: 0.85 });
    assert.equal(shouldPreferPlatformPack(validatedPackResult(0.75), staticDiscovery), true);
  });

  it('rejects pack below promotion threshold', () => {
    const staticDiscovery = baseDiscovery({ confidence: 0.85 });
    assert.equal(shouldPreferPlatformPack(validatedPackResult(0.65), staticDiscovery), false);
  });
});

describe('selectDiscoveryCandidate', () => {
  it('selects validated platform pack over strong sitemap when pack meets promotion threshold', () => {
    const staticDiscovery = baseDiscovery({ confidence: 0.85 });
    const selected = selectDiscoveryCandidate(staticDiscovery, fingerprint, validatedPackResult(0.75));
    assert.equal(selected.platformPackUsed, true);
    assert.equal(selected.discovery.crawlRecipe.discoveryMode, 'api');
    assert.ok(selected.discovery.notes.includes('platform_pack'));
  });

  it('keeps static sitemap when platform pack is below promotion threshold', () => {
    const staticDiscovery = baseDiscovery({ confidence: 0.85 });
    const selected = selectDiscoveryCandidate(staticDiscovery, fingerprint, validatedPackResult(0.65));
    assert.equal(selected.platformPackUsed, false);
    assert.equal(selected.discovery.crawlRecipe.discoveryMode, 'sitemap');
    assert.ok(selected.discovery.notes.includes('static_site'));
  });

  it('keeps static when platform pack did not validate', () => {
    const staticDiscovery = baseDiscovery();
    const packResult: PlatformPackAttemptResult = {
      used: false,
      discovery: staticDiscovery,
    };

    const selected = selectDiscoveryCandidate(staticDiscovery, fingerprint, packResult);
    assert.equal(selected.platformPackUsed, false);
    assert.equal(selected.apiValidationReport, null);
  });
});

describe('resolvePlatformPackResult', () => {
  it('retries platform pack on full static discovery when seed track did not validate', async () => {
    const staticDiscovery = baseDiscovery();
    let retryCalled = false;
    const deps: OrchestratorDeps = {
      tryPlatformPack: async () => {
        retryCalled = true;
        return validatedPackResult(0.82, staticDiscovery);
      },
    };

    const resolved = await resolvePlatformPackResult(
      staticDiscovery,
      fingerprint,
      { used: false, discovery: staticDiscovery },
      deps,
    );

    assert.equal(retryCalled, true);
    assert.equal(resolved.used, true);
  });

  it('skips retry when seed track already validated a pack', async () => {
    const staticDiscovery = baseDiscovery();
    const seedResult = validatedPackResult(0.9);
    const deps: OrchestratorDeps = {
      tryPlatformPack: async () => {
        throw new Error('should not retry');
      },
    };

    const resolved = await resolvePlatformPackResult(staticDiscovery, fingerprint, seedResult, deps);
    assert.equal(resolved, seedResult);
  });
});
