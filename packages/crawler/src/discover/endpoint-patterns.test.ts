import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  aggregateEndpointPatterns,
  deriveUrlPattern,
  matchEndpointPattern,
  PATTERN_MIN_RETAILERS,
} from './endpoint-patterns.js';

describe('deriveUrlPattern', () => {
  it('generalizes numeric path segments', () => {
    const pattern = deriveUrlPattern('https://shop.example.com/products/12345/view');
    assert.ok(pattern.includes('\\d+'));
  });
});

describe('aggregateEndpointPatterns', () => {
  it('requires minimum retailer count', () => {
    const rows = [
      {
        platform: 'shopify',
        url: 'https://a.myshopify.com/products.json',
        method: 'GET',
        endpointType: 'catalog',
        reliabilityScore: 0.9,
        failureCount: 0,
        retailerId: 'r1',
      },
      {
        platform: 'shopify',
        url: 'https://b.myshopify.com/products.json',
        method: 'GET',
        endpointType: 'catalog',
        reliabilityScore: 0.95,
        failureCount: 0,
        retailerId: 'r2',
      },
    ];
    assert.equal(aggregateEndpointPatterns(rows).length, 0);
    assert.equal(PATTERN_MIN_RETAILERS, 3);
  });

  it('promotes pattern with enough retailers and success rate', () => {
    const rows = [
      {
        platform: 'shopify',
        url: 'https://a.myshopify.com/products.json',
        method: 'GET',
        endpointType: 'catalog',
        reliabilityScore: 0.9,
        failureCount: 0,
        retailerId: 'r1',
      },
      {
        platform: 'shopify',
        url: 'https://b.myshopify.com/products.json',
        method: 'GET',
        endpointType: 'catalog',
        reliabilityScore: 0.95,
        failureCount: 0,
        retailerId: 'r2',
      },
      {
        platform: 'shopify',
        url: 'https://c.myshopify.com/products.json',
        method: 'GET',
        endpointType: 'catalog',
        reliabilityScore: 0.92,
        failureCount: 0,
        retailerId: 'r3',
      },
    ];
    const patterns = aggregateEndpointPatterns(rows);
    assert.equal(patterns.length, 1);
    assert.equal(patterns[0]!.platform, 'shopify');
    assert.ok(patterns[0]!.successRate >= 0.8);
  });
});

describe('matchEndpointPattern', () => {
  it('matches URL against platform-specific pattern', () => {
    const patterns = aggregateEndpointPatterns([
      {
        platform: 'shopify',
        url: 'https://a.myshopify.com/products.json',
        method: 'GET',
        endpointType: 'catalog',
        reliabilityScore: 0.9,
        failureCount: 0,
        retailerId: 'r1',
      },
      {
        platform: 'shopify',
        url: 'https://b.myshopify.com/products.json',
        method: 'GET',
        endpointType: 'catalog',
        reliabilityScore: 0.9,
        failureCount: 0,
        retailerId: 'r2',
      },
      {
        platform: 'shopify',
        url: 'https://c.myshopify.com/products.json',
        method: 'GET',
        endpointType: 'catalog',
        reliabilityScore: 0.9,
        failureCount: 0,
        retailerId: 'r3',
      },
    ]);
    const match = matchEndpointPattern(
      'https://new.myshopify.com/products.json',
      'shopify',
      patterns,
    );
    assert.ok(match);
  });
});
