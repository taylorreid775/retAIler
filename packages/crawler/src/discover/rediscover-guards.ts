import type { RetailerKnowledge } from './knowledge/reader.js';
import type { ValidationReport } from './validate-api-recipe.js';
import { PROMOTION_MIN_CONFIDENCE } from './validate-api-recipe.js';

const HARD_BLOCK_RE =
  /\b(incapsula|hard[_\s-]?block|do not retry|permanently blocked|bot wall)\b/i;

export function estimatedCatalogFromValidationReport(report: unknown): number {
  if (!report || typeof report !== 'object') return 0;
  const size = (report as { estimatedCatalogSize?: number }).estimatedCatalogSize;
  return typeof size === 'number' && size > 0 ? size : 0;
}

/** Early exit when knowledge docs document a known hard block. */
export function hardBlockReasonFromKnowledge(knowledge: RetailerKnowledge): string | null {
  if (!knowledge.exists) return null;
  const corpus = [
    knowledge.knownIssues,
    knowledge.retailerProfile,
    knowledge.endpointAnalysis,
  ].join('\n');
  if (!HARD_BLOCK_RE.test(corpus)) return null;
  return 'Retailer marked as hard-blocked in knowledge docs';
}

/**
 * Rediscovery must not replace a working config with a weaker candidate.
 * Promote when confidence improves materially or catalog estimate grows.
 */
export function shouldPromoteRediscovery(params: {
  currentConfidence: number;
  currentValidationReport: unknown;
  candidateConfidence: number;
  candidateValidationReport: ValidationReport | null;
  hasApiRecipe: boolean;
  hasJinaRecipe: boolean;
  hasPathEvidence: boolean;
}): boolean {
  const {
    currentConfidence,
    currentValidationReport,
    candidateConfidence,
    candidateValidationReport,
    hasApiRecipe,
    hasJinaRecipe,
    hasPathEvidence,
  } = params;

  const candidateValid =
    hasApiRecipe ||
    hasJinaRecipe ||
    hasPathEvidence ||
    candidateConfidence >= PROMOTION_MIN_CONFIDENCE;
  if (!candidateValid) return false;

  const currentCatalog = estimatedCatalogFromValidationReport(currentValidationReport);
  const candidateCatalog = candidateValidationReport?.estimatedCatalogSize ?? 0;

  if (candidateConfidence >= PROMOTION_MIN_CONFIDENCE && currentConfidence < PROMOTION_MIN_CONFIDENCE) {
    return true;
  }

  if (candidateConfidence > currentConfidence + 0.05) {
    return true;
  }

  if (
    candidateValidationReport &&
    candidateValidationReport.confidence >= PROMOTION_MIN_CONFIDENCE &&
    candidateCatalog >= currentCatalog &&
    candidateCatalog > 0
  ) {
    return true;
  }

  return false;
}
