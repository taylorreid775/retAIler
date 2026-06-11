import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PROMOTION_MIN_CATALOG_SIZE, PROMOTION_MIN_RELIABILITY } from './validate-api-recipe.js';

describe('validate-api-recipe pagination thresholds', () => {
  it('exports promotion constants used by pagination probing', () => {
    assert.equal(PROMOTION_MIN_RELIABILITY, 0.9);
    assert.equal(PROMOTION_MIN_CATALOG_SIZE, 50);
  });
});
