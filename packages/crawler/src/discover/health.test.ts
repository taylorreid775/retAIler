import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCrawlHealthInput,
  evaluateCrawlHealth,
  evaluateDegradedCrawlHealth,
} from './health.js';
import { computeHealthScore } from '@retailer/schema';

describe('crawl health', () => {
  it('computes weighted health score from metrics', () => {
    const input = buildCrawlHealthInput({
      run: {
        urlsDiscovered: 100,
        urlsFetched: 90,
        productsExtracted: 85,
        errorCount: 2,
        discoveryMode: 'sitemap',
      },
      previousCatalogSize: 100,
      discoveryBaselineCatalogSize: 0,
      productsWithPrice: 80,
      productsIngested: 85,
    });

    const score = computeHealthScore(input);
    assert.ok(score > 0.8);
    assert.ok(score <= 1);
  });

  it('uses discovery baseline on first crawl instead of self-reference', () => {
    const input = buildCrawlHealthInput({
      run: {
        urlsDiscovered: 30,
        urlsFetched: 30,
        productsExtracted: 30,
        errorCount: 0,
        discoveryMode: 'api',
      },
      previousCatalogSize: 0,
      discoveryBaselineCatalogSize: 500,
      productsWithPrice: 30,
      productsIngested: 30,
    });

    assert.ok(input.catalogCoverageRatio < 0.1);
  });

  it('detects catalog drop anomaly against discovery baseline', () => {
    const result = evaluateCrawlHealth({
      run: {
        urlsDiscovered: 30,
        urlsFetched: 30,
        productsExtracted: 30,
        errorCount: 0,
        discoveryMode: 'api',
      },
      previousCatalogSize: 0,
      discoveryBaselineCatalogSize: 100,
      productsWithPrice: 30,
      productsIngested: 30,
    });

    assert.ok(result.anomalies.some((a) => a.type === 'catalog_drop'));
    assert.ok(result.healthScore < 0.8);
  });

  it('evaluates failed crawls with zero health score', () => {
    const result = evaluateDegradedCrawlHealth({
      run: {
        urlsDiscovered: 0,
        urlsFetched: 0,
        productsExtracted: 0,
        errorCount: 3,
        discoveryMode: 'api',
      },
      previousCatalogSize: 0,
      discoveryBaselineCatalogSize: 200,
      productsWithPrice: 0,
      productsIngested: 0,
      failureReason: 'Crawl run failed',
    });

    assert.equal(result.healthScore, 0);
    assert.ok(result.anomalies.length > 0);
  });
});
