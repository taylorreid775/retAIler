import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { rediscoverJitterSeconds } from './rediscovery-schedule.js';

describe('rediscoverJitterSeconds', () => {
  it('is deterministic for a retailer key', () => {
    assert.equal(rediscoverJitterSeconds('sportchek'), rediscoverJitterSeconds('sportchek'));
  });

  it('stays within one hour', () => {
    const jitter = rediscoverJitterSeconds('example-store');
    assert.ok(jitter >= 0 && jitter < 3600);
  });
});
