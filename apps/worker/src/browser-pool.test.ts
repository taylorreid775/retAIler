import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import type { BrowserFetcher } from './browser-fetcher.js';
import { BrowserPool, resolveDiscoveryConcurrency } from './browser-pool.js';

function stubFetcher(): BrowserFetcher {
  return {
    kind: 'browser',
    resetSession: mock.fn(async () => {}),
    close: mock.fn(async () => {}),
    fetch: mock.fn(async () => ({ url: '', status: 200, html: '', finalUrl: '' })),
    fetchJson: mock.fn(async () => ({ status: 200, text: '{}' })),
    fetchApi: mock.fn(async () => ({ status: 200, text: '{}' })),
  } as unknown as BrowserFetcher;
}

describe('resolveDiscoveryConcurrency', () => {
  it('defaults to 1 when env unset', () => {
    const prev = process.env.DISCOVERY_CONCURRENCY;
    delete process.env.DISCOVERY_CONCURRENCY;
    assert.equal(resolveDiscoveryConcurrency({ size: () => 2 } as never), 1);
    if (prev !== undefined) process.env.DISCOVERY_CONCURRENCY = prev;
  });

  it('caps requested concurrency to pool size', () => {
    const prev = process.env.DISCOVERY_CONCURRENCY;
    process.env.DISCOVERY_CONCURRENCY = '8';
    assert.equal(resolveDiscoveryConcurrency({ size: () => 2 } as never), 2);
    if (prev !== undefined) process.env.DISCOVERY_CONCURRENCY = prev;
    else delete process.env.DISCOVERY_CONCURRENCY;
  });
});

describe('BrowserPool runExclusive', () => {
  it('runs one job at a time per slot and resets session on release', async () => {
    const fetcher = stubFetcher();
    const pool = new BrowserPool(1, () => fetcher);
    let concurrent = 0;
    let maxConcurrent = 0;

    const job = async () => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((r) => setTimeout(r, 25));
      concurrent--;
    };

    await Promise.all([pool.runExclusive(job), pool.runExclusive(job)]);
    assert.equal(maxConcurrent, 1);
    assert.equal((fetcher.resetSession as ReturnType<typeof mock.fn>).mock.callCount(), 2);
    await pool.close();
  });
});
