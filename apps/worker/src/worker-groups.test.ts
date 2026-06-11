import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseWorkerGroups, shouldStartWorker } from './worker-groups.js';

describe('parseWorkerGroups', () => {
  it('defaults to all when flag missing', () => {
    const groups = parseWorkerGroups(['node', 'index.js']);
    assert.ok(groups.has('all'));
  });

  it('parses crawl and discovery flags', () => {
    const groups = parseWorkerGroups(['node', 'index.js', '--workers=crawl']);
    assert.ok(shouldStartWorker(groups, 'crawl'));
    assert.equal(shouldStartWorker(groups, 'discovery'), false);
  });
});
