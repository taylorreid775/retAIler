import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { estimateCostFromTokens } from './ai-cost.js';

describe('estimateCostFromTokens', () => {
  it('returns zero for empty usage', () => {
    assert.equal(estimateCostFromTokens({}), 0);
  });

  it('estimates cost from total tokens', () => {
    const cost = estimateCostFromTokens({ totalTokens: 10_000 });
    assert.ok(cost > 0);
    assert.ok(cost < 0.01);
  });
});
