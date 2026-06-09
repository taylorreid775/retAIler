import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveDiscoveryDocsRoot } from './paths.js';

function loadTemplate(name: string): string {
  const path = join(resolveDiscoveryDocsRoot(), 'templates', name);
  return readFileSync(path, 'utf8');
}

export function fillTemplate(template: string, values: Record<string, string>): string {
  let out = template;
  for (const [key, value] of Object.entries(values)) {
    out = out.replaceAll(`{${key}}`, value);
  }
  return out;
}

export const knowledgeTemplates = {
  retailerProfile: () => loadTemplate('retailer-profile.md'),
  endpointAnalysis: () => loadTemplate('endpoint-analysis.md'),
  crawlStrategy: () => loadTemplate('crawl-strategy.md'),
  validationReport: () => loadTemplate('validation-report.md'),
  knownIssues: () => loadTemplate('known-issues.md'),
  changelog: () => loadTemplate('CHANGELOG.md'),
};
