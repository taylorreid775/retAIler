import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CrawlRecipe, RetailerFingerprint } from '@retailer/schema';
import type { ValidationReport } from '../validate-api-recipe.js';
import { persistKnowledgeDocs, type KnowledgeDocMap } from './db.js';
import { resolveDiscoveryDocsRoot, retailerKnowledgeDir } from './paths.js';
import { fillTemplate, knowledgeTemplates } from './templates.js';

export interface KnowledgeWriteInput {
  retailerKey: string;
  retailerId?: string;
  retailerName: string;
  domain: string;
  homepageUrl: string;
  country?: string;
  currency?: string;
  fingerprint: RetailerFingerprint | null;
  crawlRecipe: CrawlRecipe;
  confidence: number;
  validationReport?: ValidationReport | null;
  recipeVersion: number;
  notes?: string;
  requestDelayMs?: number;
  maxConcurrency?: number;
  crawlSchedule?: string;
  enabled?: boolean;
}

function pct(value: number | undefined): string {
  if (value == null) return 'n/a';
  return `${Math.round(value * 100)}%`;
}

function formatList(items: string[]): string {
  return items.length ? items.map((item) => `- ${item}`).join('\n') : '- (none)';
}

/** Build per-retailer markdown knowledge docs (no LLM). */
export function buildKnowledgeDocFiles(input: KnowledgeWriteInput): KnowledgeDocMap {
  const fp = input.fingerprint;
  const recipe = input.crawlRecipe;
  const report = input.validationReport;
  const now = new Date().toISOString();
  const primaryEndpoint =
    recipe.api?.baseUrl ?? recipe.sitemapUrls[0] ?? recipe.sampleProductUrls[0] ?? 'unknown';

  const common = {
    'retailer-name': input.retailerName,
    'retailer-key': input.retailerKey,
    domain: input.domain,
    'homepage-url': input.homepageUrl,
    country: input.country ?? 'CA',
    currency: input.currency ?? 'CAD',
    platform: fp?.platform ?? 'unknown',
    'platform-confidence': fp ? String(fp.platformConfidence) : 'n/a',
    framework: fp?.framework ?? 'unknown',
    'commerce-engine': fp?.commerceEngine ?? 'n/a',
    'bot-protection': fp?.botProtection ?? 'unknown',
    'recommended-strategy': fp?.recommendedStrategy ?? 'n/a',
    'discovery-mode': recipe.discoveryMode,
    'primary-endpoint': primaryEndpoint,
    'fetch-strategy': recipe.fetchStrategy ?? 'static',
    confidence: String(input.confidence),
    'discovered-at': now,
    'last-validated-at': now,
    'recipe-version': String(input.recipeVersion),
    'sources-list': formatList(recipe.sources),
    'sample-product-urls': formatList(recipe.sampleProductUrls),
    notes: input.notes ?? (recipe.notes.join('\n') || '(none)'),
    timestamp: now,
    'discovery-run-id': 'onboarding',
  };

  const files: Array<[string, string]> = [
    [
      'retailer-profile.md',
      fillTemplate(knowledgeTemplates.retailerProfile(), common),
    ],
    [
      'endpoint-analysis.md',
      fillTemplate(knowledgeTemplates.endpointAnalysis(), {
        ...common,
        'endpoint-type': recipe.discoveryMode === 'api' ? 'catalog' : recipe.discoveryMode,
        'endpoint-url': primaryEndpoint,
        method: recipe.api?.method ?? 'GET',
        reliability: report ? String(report.reliability) : 'n/a',
        'catalog-size': report ? String(report.estimatedCatalogSize) : 'n/a',
        'required-headers': JSON.stringify(recipe.api?.headers ?? {}, null, 2),
        'required-cookies': '{}',
        'dependency-chain': '- (not captured in phase 2)',
        'graphql-operations': '- (none)',
        'candidates-table': report
          ? `| 1 | ${report.endpoint} | catalog | ${report.confidence} | ${report.reliability} | yes | — |`
          : '| — | — | — | — | — | — | — |',
        'selection-rationale': report
          ? `Selected ${report.endpoint} with confidence ${report.confidence}.`
          : 'No API validation report — sitemap or Jina path.',
        'har-blob-url': '(not captured)',
        'probe-blob-url': '(not captured)',
      }),
    ],
    [
      'crawl-strategy.md',
      fillTemplate(knowledgeTemplates.crawlStrategy(), {
        ...common,
        'fallback-mode': recipe.discoveryMode === 'api' ? 'sitemap' : 'api',
        'pagination-style': recipe.api?.pagination.style ?? recipe.jina?.pagination.style ?? 'none',
        'pagination-param': recipe.api?.pagination.pageParam ?? recipe.jina?.pagination.paramName ?? 'n/a',
        'start-page': String(recipe.jina?.pagination.startPage ?? 1),
        'max-pages': String(recipe.api?.pagination.maxPages ?? recipe.jina?.pagination.maxPages ?? 50),
        'delay-ms': String(recipe.api?.pagination.delayMs ?? 500),
        'request-delay-ms': String(input.requestDelayMs ?? 2000),
        'max-concurrency': String(input.maxConcurrency ?? 2),
        rps: input.requestDelayMs ? String((1000 / input.requestDelayMs).toFixed(2)) : 'n/a',
        'use-proxy': 'false',
        'respect-robots': 'true',
        'extraction-strategy': recipe.extractionStrategy,
        'image-json-paths': recipe.extractionHints.imageJsonPaths.join(', ') || 'n/a',
        'price-json-paths': recipe.extractionHints.priceJsonPaths.join(', ') || 'n/a',
        'category-dimensions': recipe.api?.categoryParam
          ? `- ${recipe.api.categoryParam.name}: ${recipe.api.categoryParam.values.map((v) => v.value).join(', ')}`
          : '- (none)',
        'listing-pages-table': '| — | — | — | — |',
        'crawl-schedule': input.crawlSchedule ?? '0 6 * * *',
        enabled: String(input.enabled ?? true),
      }),
    ],
    [
      'validation-report.md',
      fillTemplate(knowledgeTemplates.validationReport(), {
        ...common,
        reliability: report ? String(report.reliability) : 'n/a',
        'catalog-size': report ? String(report.estimatedCatalogSize) : 'n/a',
        'products-probed': report ? '3' : '0',
        promoted: report ? String(report.confidence >= 0.7) : 'false',
        'name-pct': pct(report?.fieldsPresent.title),
        'sku-pct': pct(report?.fieldsPresent.sku),
        'price-pct': pct(report?.fieldsPresent.price),
        'url-pct': pct(report?.fieldsPresent.url),
        'brand-pct': 'n/a',
        'image-pct': 'n/a',
        'description-pct': 'n/a',
        'gtin-pct': 'n/a',
        'availability-pct': 'n/a',
        'variants-pct': 'n/a',
        'page1-count': 'n/a',
        'page2-count': 'n/a',
        'overlap-pct': 'n/a',
        'pagination-style': report?.paginationStyle ?? 'n/a',
        'failure-modes': report?.failureModes.length
          ? report.failureModes.map((m) => `- ${m}`).join('\n')
          : '- (none)',
        'sample-products-json': '[]',
        'confidence-check': report ? String(report.confidence >= 0.7) : 'false',
        'size-check': report ? String(report.estimatedCatalogSize >= 50) : 'false',
        'reliability-check': report ? String(report.reliability >= 0.9) : 'false',
        'gate-result': report?.failureModes.length ? 'FAIL' : 'PASS',
      }),
    ],
    [
      'known-issues.md',
      fillTemplate(knowledgeTemplates.knownIssues(), {
        ...common,
        'active-issues': '- (none)',
        'resolved-issues': '- (none)',
        'bypass-strategy': recipe.fetchStrategy ?? 'static',
        blocked: 'false',
        'missing-fields': '- (none)',
        'repair-history-table': '| — | — | — | — | — |',
        workarounds: '- (none)',
        'do-not-list': '- Retry discovery without reading this folder first',
      }),
    ],
    [
      'CHANGELOG.md',
      fillTemplate(knowledgeTemplates.changelog(), {
        ...common,
        'versions-table': `| ${input.recipeVersion} | ${now.slice(0, 10)} | discovery | ${recipe.discoveryMode} | ${input.confidence} | Initial discovery |`,
        version: String(input.recipeVersion),
        date: now.slice(0, 10),
        'created-by': 'discovery',
        changes: '- Initial crawl recipe from onboarding',
        reason: 'First successful discovery',
        'catalog-size': report ? String(report.estimatedCatalogSize) : 'n/a',
      }),
    ],
  ];

  return Object.fromEntries(files);
}

/** Persist knowledge to DB; mirror to repo filesystem when templates root exists (dev). */
export async function writeKnowledgeDocs(input: KnowledgeWriteInput): Promise<string> {
  const docs = buildKnowledgeDocFiles(input);

  if (input.retailerId) {
    await persistKnowledgeDocs(input.retailerId, input.recipeVersion, docs);
  }

  const templatesRoot = join(resolveDiscoveryDocsRoot(), 'templates');
  if (!existsSync(templatesRoot)) {
    return input.retailerId ? `db:retailer:${input.retailerId}` : 'db-only';
  }

  const dir = retailerKnowledgeDir(input.retailerKey);
  await mkdir(dir, { recursive: true });
  for (const [filename, content] of Object.entries(docs)) {
    await writeFile(join(dir, filename), content, 'utf8');
  }

  return dir;
}
