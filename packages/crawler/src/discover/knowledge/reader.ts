import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { loadKnowledgeDocsFromDb } from './db.js';
import { retailerKnowledgeDir } from './paths.js';

export interface RetailerKnowledge {
  retailerKey: string;
  exists: boolean;
  source: 'db' | 'filesystem' | 'none';
  knownIssues: string;
  endpointAnalysis: string;
  crawlStrategy: string;
  validationReport: string;
  retailerProfile: string;
}

async function readOptional(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return '';
  }
}

function knowledgeFromDocMap(
  retailerKey: string,
  docs: Record<string, string>,
  source: 'db' | 'filesystem',
): RetailerKnowledge {
  return {
    retailerKey,
    exists: true,
    source,
    knownIssues: docs['known-issues.md'] ?? '',
    endpointAnalysis: docs['endpoint-analysis.md'] ?? '',
    crawlStrategy: docs['crawl-strategy.md'] ?? '',
    validationReport: docs['validation-report.md'] ?? '',
    retailerProfile: docs['retailer-profile.md'] ?? '',
  };
}

const emptyKnowledge = (retailerKey: string): RetailerKnowledge => ({
  retailerKey,
  exists: false,
  source: 'none',
  knownIssues: '',
  endpointAnalysis: '',
  crawlStrategy: '',
  validationReport: '',
  retailerProfile: '',
});

/** Load persisted retailer knowledge — DB first, filesystem fallback for local dev. */
export async function readKnowledgeDocs(retailerKey: string): Promise<RetailerKnowledge> {
  const fromDb = await loadKnowledgeDocsFromDb(retailerKey);
  if (fromDb.exists) {
    return knowledgeFromDocMap(retailerKey, fromDb.docs, 'db');
  }

  const dir = retailerKnowledgeDir(retailerKey);
  if (!existsSync(dir)) {
    return emptyKnowledge(retailerKey);
  }

  const [knownIssues, endpointAnalysis, crawlStrategy, validationReport, retailerProfile] =
    await Promise.all([
      readOptional(join(dir, 'known-issues.md')),
      readOptional(join(dir, 'endpoint-analysis.md')),
      readOptional(join(dir, 'crawl-strategy.md')),
      readOptional(join(dir, 'validation-report.md')),
      readOptional(join(dir, 'retailer-profile.md')),
    ]);

  const hasContent = [knownIssues, endpointAnalysis, crawlStrategy, validationReport, retailerProfile].some(
    (s) => s.length > 0,
  );
  if (!hasContent) return emptyKnowledge(retailerKey);

  return {
    retailerKey,
    exists: true,
    source: 'filesystem',
    knownIssues,
    endpointAnalysis,
    crawlStrategy,
    validationReport,
    retailerProfile,
  };
}
