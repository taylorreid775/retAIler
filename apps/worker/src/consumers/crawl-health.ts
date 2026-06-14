import { Worker, type Job, queues, redisConnection } from '@retailer/jobs';
import { createLogger } from '@retailer/core';
import { db, schema, eq, desc, sql, and, gte } from '@retailer/db';
import { evaluateCrawlHealth, evaluateDegradedCrawlHealth } from '@retailer/crawler';
import { CrawlRecipeSchema, QueueName, type CrawlHealthJob } from '@retailer/schema';
import { getRetailer } from '../retailers.js';

const log = createLogger('worker:crawl-health');

const REPAIR_MIN_SCORE = 0.4;
const REPAIR_MAX_SCORE = 0.7;
const REDISCOVER_MAX_SCORE = 0.4;
const CONSECUTIVE_LOW_CRAWLS = 3;

function estimatedCatalogFromReport(report: unknown): number {
  if (!report || typeof report !== 'object') return 0;
  const size = (report as { estimatedCatalogSize?: number }).estimatedCatalogSize;
  return typeof size === 'number' && size > 0 ? size : 0;
}

export function startCrawlHealthWorker(): Worker<CrawlHealthJob> {
  return new Worker<CrawlHealthJob>(
    QueueName.CrawlHealth,
    async (job: Job<CrawlHealthJob>) => {
      const { retailerKey, crawlRunId } = job.data;
      const retailer = await getRetailer(retailerKey);
      if (!retailer) throw new Error(`unknown retailer ${retailerKey}`);

      const [run] = await db
        .select()
        .from(schema.crawlRuns)
        .where(eq(schema.crawlRuns.id, crawlRunId));
      if (!run) throw new Error(`crawl run ${crawlRunId} not found`);

      if (run.status !== 'completed' && run.status !== 'failed') {
        throw new Error(`crawl run ${crawlRunId} not terminal (status=${run.status})`);
      }

      const [previousReport] = await db
        .select({ catalogSize: schema.crawlHealthReports.catalogSize })
        .from(schema.crawlHealthReports)
        .where(eq(schema.crawlHealthReports.retailerId, retailer.id))
        .orderBy(desc(schema.crawlHealthReports.createdAt))
        .limit(1);

      const [latestRecipe] = await db
        .select({ validationReport: schema.retailerRecipeVersions.validationReport })
        .from(schema.retailerRecipeVersions)
        .where(eq(schema.retailerRecipeVersions.retailerId, retailer.id))
        .orderBy(desc(schema.retailerRecipeVersions.version))
        .limit(1);

      const discoveryBaselineCatalogSize = estimatedCatalogFromReport(
        latestRecipe?.validationReport ?? null,
      );

      const recipeParsed = retailer.crawlRecipe
        ? CrawlRecipeSchema.safeParse(retailer.crawlRecipe)
        : null;
      const discoveryMode = recipeParsed?.success ? recipeParsed.data.discoveryMode : null;
      const isApiRepairable =
        recipeParsed?.success === true &&
        recipeParsed.data.discoveryMode === 'api' &&
        recipeParsed.data.api != null;

      const productsIngested = run.productsExtracted || 0;
      const [{ withPrice } = { withPrice: 0 }] =
        productsIngested > 0
          ? await db
              .select({
                withPrice: sql<number>`count(distinct ${schema.priceObservations.retailerProductId})::int`,
              })
              .from(schema.priceObservations)
              .innerJoin(
                schema.retailerProducts,
                eq(schema.priceObservations.retailerProductId, schema.retailerProducts.id),
              )
              .where(
                and(
                  eq(schema.retailerProducts.retailerId, retailer.id),
                  gte(schema.priceObservations.capturedAt, run.startedAt),
                ),
              )
          : [{ withPrice: 0 }];

      const metricCtx = {
        run: {
          urlsDiscovered: run.urlsDiscovered,
          urlsFetched: run.urlsFetched,
          productsExtracted: run.productsExtracted,
          errorCount: run.errorCount,
          discoveryMode,
        },
        previousCatalogSize: previousReport?.catalogSize ?? 0,
        discoveryBaselineCatalogSize,
        productsWithPrice: withPrice,
        productsIngested,
      };

      const catalogSize = run.productsExtracted || run.urlsDiscovered;
      const isZeroYield = run.status === 'completed' && catalogSize === 0;
      const evaluation =
        run.status === 'failed' || isZeroYield
          ? evaluateDegradedCrawlHealth({
              ...metricCtx,
              failureReason:
                run.status === 'failed'
                  ? `Crawl run failed (${run.errorCount} errors)`
                  : 'Crawl completed with zero products or URLs discovered',
            })
          : evaluateCrawlHealth(metricCtx);

      const [report] = await db
        .insert(schema.crawlHealthReports)
        .values({
          retailerId: retailer.id,
          crawlRunId,
          catalogSize: evaluation.catalogSize,
          previousCatalogSize: evaluation.previousCatalogSize,
          coverageRatio: evaluation.input.catalogCoverageRatio,
          endpointSuccessRate: evaluation.input.endpointSuccessRate,
          extractionSuccessRate: evaluation.input.extractionSuccessRate,
          priceFieldPresence: evaluation.input.priceFieldPresence,
          healthScore: evaluation.healthScore,
          anomalies: evaluation.anomalies,
        })
        .returning({ id: schema.crawlHealthReports.id });

      await db
        .update(schema.retailers)
        .set({
          crawlHealthScore: evaluation.healthScore,
          updatedAt: new Date(),
        })
        .where(eq(schema.retailers.id, retailer.id));

      log.info('crawl health report saved', {
        retailerKey,
        crawlRunId,
        runStatus: run.status,
        healthScore: evaluation.healthScore,
        anomalies: evaluation.anomalies.length,
      });

      if (
        isApiRepairable &&
        evaluation.healthScore >= REPAIR_MIN_SCORE &&
        evaluation.healthScore < REPAIR_MAX_SCORE &&
        report
      ) {
        await queues.discoverRepair().add('repair', {
          retailerKey,
          trigger: 'health_drop',
          healthReportId: report.id,
        });
        log.info('enqueued discover repair', { retailerKey, healthScore: evaluation.healthScore });
      }

      if (evaluation.healthScore < REDISCOVER_MAX_SCORE) {
        const recent = await db
          .select({ healthScore: schema.crawlHealthReports.healthScore })
          .from(schema.crawlHealthReports)
          .where(eq(schema.crawlHealthReports.retailerId, retailer.id))
          .orderBy(desc(schema.crawlHealthReports.createdAt))
          .limit(CONSECUTIVE_LOW_CRAWLS);
        const allLow =
          recent.length >= CONSECUTIVE_LOW_CRAWLS &&
          recent.every((r) => (r.healthScore ?? 1) < REDISCOVER_MAX_SCORE);
        if (allLow) {
          await queues.rediscover().add(
            'rediscover',
            {
              retailerKey,
              reason: 'health_score_below_0.4_x3',
              preserveEndpoints: true,
            },
            { jobId: `rediscover:${retailerKey}` },
          );
          log.warn('enqueued rediscover after consecutive low health', {
            retailerKey,
            healthScore: evaluation.healthScore,
          });
        }
      }
    },
    { connection: redisConnection(), concurrency: 4 },
  );
}
