import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deriveRetailerKey, normalizeRetailerDomain } from './domain.js';

describe('normalizeRetailerDomain', () => {
  it('strips protocol and www', () => {
    assert.equal(normalizeRetailerDomain('https://www.example.com/shop'), 'example.com');
  });

  it('handles bare hostnames', () => {
    assert.equal(normalizeRetailerDomain('WWW.SportChek.ca'), 'sportchek.ca');
  });

  it('strips port', () => {
    assert.equal(normalizeRetailerDomain('https://example.com:8443/path'), 'example.com');
  });
});

describe('deriveRetailerKey', () => {
  it('slugifies normalized domain', () => {
    assert.equal(deriveRetailerKey('www.sportchek.ca'), 'sportchek-ca');
  });
});
