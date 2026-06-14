import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  estimatedCatalogFromValidationReport,
  hardBlockReasonFromKnowledge,
  shouldPromoteRediscovery,
} from './rediscover-guards.js';

describe('hardBlockReasonFromKnowledge', () => {
  it('detects Incapsula hard blocks', () => {
    const reason = hardBlockReasonFromKnowledge({
      retailerKey: 'sportsexperts',
      exists: true,
      source: 'db',
      knownIssues: 'Site uses Incapsula bot wall — do not retry automated sniff.',
      endpointAnalysis: '',
      crawlStrategy: '',
      validationReport: '',
      retailerProfile: '',
    });
    assert.equal(reason, 'Retailer marked as hard-blocked in knowledge docs');
  });
});

describe('shouldPromoteRediscovery', () => {
  it('rejects weaker candidates', () => {
    const promote = shouldPromoteRediscovery({
      currentConfidence: 0.85,
      currentValidationReport: { estimatedCatalogSize: 500 },
      candidateConfidence: 0.4,
      candidateValidationReport: { confidence: 0.4, estimatedCatalogSize: 10 } as never,
      hasApiRecipe: false,
      hasJinaRecipe: false,
      hasPathEvidence: false,
    });
    assert.equal(promote, false);
  });

  it('promotes when confidence crosses promotion threshold', () => {
    const promote = shouldPromoteRediscovery({
      currentConfidence: 0.5,
      currentValidationReport: null,
      candidateConfidence: 0.82,
      candidateValidationReport: { confidence: 0.82, estimatedCatalogSize: 100 } as never,
      hasApiRecipe: true,
      hasJinaRecipe: false,
      hasPathEvidence: false,
    });
    assert.equal(promote, true);
  });
});

describe('estimatedCatalogFromValidationReport', () => {
  it('reads estimatedCatalogSize when present', () => {
    assert.equal(estimatedCatalogFromValidationReport({ estimatedCatalogSize: 42 }), 42);
  });
});
