import { Worker, type Job, redisConnection } from '@retailer/jobs';
import { createLogger } from '@retailer/core';
import { db, schema, eq, sql, writeRecipeVersion } from '@retailer/db';
import {
  applyRepairStrategy,
  readKnowledgeDocs,
  selectRepairStrategies,
  type RepairStrategyName,
} from '@retailer/crawler';
import {
  CrawlRecipeSchema,
  QueueName,
  type DiscoverRepairJob,
  type HealthAnomaly,
} from '@retailer/schema';
import { getRetailer } from '../retailers.js';
import { fetcherFor } from '../fetchers.js';
import { BrowserFetcher } from '../browser-fetcher.js';
import { createApiFetchJson } from '../api-fetch.js';
import { captureRequestHeaders } from '../capture-request-headers.js';

const log = createLogger('worker:discover-repair');

const REPAIR_SUCCESS_MIN_CONFIDENCE = 0.7;

export function startDiscoverRepairWorker(): Worker<DiscoverRepairJob> {
  return new Worker<DiscoverRepairJob>(
    QueueName.DiscoverRepair,
    async (job: Job<DiscoverRepairJob>) => {
      const { retailerKey, trigger, healthReportId } = job.data;
      const retailer = await getRetailer(retailerKey);
      if (!retailer) throw new Error(`unknown retailer ${retailerKey}`);

      const knowledge = await readKnowledgeDocs(retailerKey);
      if (knowledge.exists) {
        log.info('loaded retailer knowledge docs', { retailerKey, source: knowledge.source });
      }

      const parsed = retailer.crawlRecipe
        ? CrawlRecipeSchema.safeParse(retailer.crawlRecipe)
        : null;
      if (!parsed?.success || parsed.data.discoveryMode !== 'api' || !parsed.data.api) {
        log.warn('repair only supports API recipes today', { retailerKey });
        await logRepairAttempt({
          retailerId: retailer.id,
          trigger,
          repairType: 'unsupported_mode',
          success: false,
          details: { reason: 'non_api_recipe' },
        });
        return;
      }

      let anomalies: HealthAnomaly[] = [];
      if (healthReportId) {
        const [health] = await db
          .select({ anomalies: schema.crawlHealthReports.anomalies })
          .from(schema.crawlHealthReports)
          .where(eq(schema.crawlHealthReports.id, healthReportId));
        anomalies = health?.anomalies ?? [];
      }

      const strategies = selectRepairStrategies(anomalies, parsed.data);
      if (!strategies.length) {
        log.warn('no repair strategies selected', { retailerKey, trigger });
        await logRepairAttempt({
          retailerId: retailer.id,
          trigger,
          repairType: 'none',
          success: false,
          details: { reason: 'no_strategies' },
        });
        return;
      }

      const browserFetcher = fetcherFor('browser') as BrowserFetcher;
      const fetchJson = createApiFetchJson({ fetchStrategy: 'browser', browserFetcher });

      const [{ maxVersion } = { maxVersion: 0 }] = await db
        .select({
          maxVersion: sql<number>`coalesce(max(${schema.retailerRecipeVersions.version}), 0)`,
        })
        .from(schema.retailerRecipeVersions)
        .where(eq(schema.retailerRecipeVersions.retailerId, retailer.id));
      const beforeVersion = maxVersion ?? 0;

      const repairCtx = {
        retailerKey,
        domain: retailer.domain,
        homepageUrl: retailer.homepageUrl ?? `https://${retailer.domain}`,
        crawlRecipe: parsed.data,
        fingerprint: retailer.fingerprint ?? null,
        anomalies,
        fetchJson,
        captureHeaders: async (apiUrl: string) => {
          const seeds = [
            apiUrl,
            parsed.data.api?.baseUrl,
            retailer.homepageUrl,
            ...(parsed.data.sampleProductUrls ?? []),
          ].filter((u): u is string => Boolean(u));
          return captureRequestHeaders([...new Set(seeds)], apiUrl);
        },
      };

      for (const strategy of strategies) {
        const attempt = await applyRepairStrategy(strategy, repairCtx);
        if (
          attempt.patched &&
          attempt.validation?.ok &&
          attempt.validation.report.confidence >= REPAIR_SUCCESS_MIN_CONFIDENCE
        ) {
          const afterVersion = await writeRecipeVersion({
            retailerId: retailer.id,
            crawlRecipe: attempt.patched,
            fingerprint: retailer.fingerprint,
            confidence: attempt.validation.report.confidence,
            validationReport: attempt.validation.report,
            createdBy: 'repair',
          });

          await logRepairAttempt({
            retailerId: retailer.id,
            trigger,
            repairType: strategy,
            beforeRecipeVersion: beforeVersion,
            afterRecipeVersion: afterVersion,
            success: true,
            details: {
              strategy,
              confidence: attempt.validation.report.confidence,
              knowledgeLoaded: knowledge.exists,
            },
          });

          log.info('repair succeeded', { retailerKey, strategy, afterVersion });
          return;
        }

        log.info('repair strategy did not validate', {
          retailerKey,
          strategy,
          ok: attempt.validation?.ok,
          confidence: attempt.validation?.report.confidence,
        });
      }

      await logRepairAttempt({
        retailerId: retailer.id,
        trigger,
        repairType: 'all_failed',
        beforeRecipeVersion: beforeVersion,
        success: false,
        details: { strategies: strategies as RepairStrategyName[] },
      });
      log.warn('all repair strategies exhausted', { retailerKey, strategies });
    },
    { connection: redisConnection(), concurrency: 2 },
  );
}

async function logRepairAttempt(params: {
  retailerId: string;
  trigger: string;
  repairType: string;
  beforeRecipeVersion?: number;
  afterRecipeVersion?: number;
  success: boolean;
  details?: unknown;
}): Promise<void> {
  await db.insert(schema.discoveryRepairs).values({
    retailerId: params.retailerId,
    trigger: params.trigger,
    repairType: params.repairType,
    beforeRecipeVersion: params.beforeRecipeVersion ?? null,
    afterRecipeVersion: params.afterRecipeVersion ?? null,
    success: params.success,
    details: params.details ?? null,
  });
}
