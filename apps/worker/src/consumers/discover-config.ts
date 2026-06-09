import { Worker, type Job, queues, redisConnection } from '@retailer/jobs';
import { createLogger } from '@retailer/core';
import { db, schema, eq, or, count, writeRecipeVersion } from '@retailer/db';
import {
  discoverSite,
  deriveProductPattern,
  discoverCategoryDirectory,
  mergeJinaIntoCrawlRecipe,
  inferApiRecipeFromCaptures,
  mergeApiIntoDiscovery,
  saveListingPages,
  validateApiRecipe,
  type ApiRecipeValidation,
  fingerprintSite,
  runPlatformPack,
  mergePlatformPackIntoDiscovery,
  crawlRecipePlatformFromFingerprint,
  runParallelDiscoveryStages,
  type SiteDiscovery,
  type CategoryDirectoryResult,
} from '@retailer/crawler';
import { QueueName, PLAN_LIMITS, type DiscoverConfigJob, type RetailerFingerprint } from '@retailer/schema';
import { createDiscoverFetchText } from '../discover-fetch.js';
import { fetcherFor } from '../fetchers.js';
import { BrowserFetcher } from '../browser-fetcher.js';
import { createApiFetchJson } from '../api-fetch.js';
import { captureNetworkJson } from '../network-capture.js';

const log = createLogger('worker:discover-config');

/** Display shape persisted to store_onboarding.result (mirrors the dashboard view). */
function toDiscoveryView(d: SiteDiscovery) {
  return {
    name: d.name,
    domain: d.domain,
    sitemapUrl: d.sitemapUrl,
    sitemapUrls: d.sitemapUrls,
    productUrlPattern: d.productUrlPattern,
    llmsTxtUrl: d.llmsTxtUrl,
    fetchStrategy: d.fetchStrategy,
    confidence: d.confidence,
    sampleProductUrls: d.sampleProductUrls,
    crawlRecipe: d.crawlRecipe,
    notes: d.notes,
  };
}

async function markFailed(onboardingId: string, error: string, result?: unknown): Promise<void> {
  await db
    .update(schema.storeOnboarding)
    .set({ status: 'failed', error, result: result ?? null, updatedAt: new Date() })
    .where(eq(schema.storeOnboarding.id, onboardingId));
}

/**
 * Worker-side store discovery for bot-protected sites. The dashboard tries
 * instant static discovery first; when it can't confirm products (e.g. Walmart
 * returns HTTP 307 to non-browser clients), it hands off here. We re-run
 * discovery through a static-first-then-browser fetcher (Playwright), and only
 * promote to a real retailer + crawl on success. Concurrency 1: shares the
 * single expensive browser instance.
 */
export function startDiscoverConfigWorker(): Worker<DiscoverConfigJob> {
  return new Worker<DiscoverConfigJob>(
    QueueName.DiscoverConfig,
    async (job: Job<DiscoverConfigJob>) => {
      const { onboardingId } = job.data;

      const [onboarding] = await db
        .select()
        .from(schema.storeOnboarding)
        .where(eq(schema.storeOnboarding.id, onboardingId));
      if (!onboarding) {
        log.warn('onboarding row gone, skipping', { onboardingId });
        return;
      }
      if (onboarding.status === 'ready') {
        log.info('onboarding already ready, skipping', { onboardingId });
        return;
      }

      await db
        .update(schema.storeOnboarding)
        .set({ status: 'discovering', updatedAt: new Date() })
        .where(eq(schema.storeOnboarding.id, onboardingId));

      const inputUrl = onboarding.inputUrl;

      // Onboarding always uses browser fallback — new stores are often behind
      // Cloudflare/Akamai before we know their fetchStrategy.
      const fetchText = createDiscoverFetchText({ fetchStrategy: 'browser', log });

      const useOrchestrator = process.env.DISCOVERY_ORCHESTRATOR === '1';

      let discovery: SiteDiscovery;
      let fingerprint: RetailerFingerprint;
      let platformPackUsed = false;
      let apiValidationReport: ApiRecipeValidation['report'] | null = null;

      try {
        if (useOrchestrator) {
          const orch = await runParallelDiscoveryStages(inputUrl, fetchText, {
            tryPlatformPack: tryPlatformPackDiscovery,
          });
          discovery = orch.discovery;
          fingerprint = orch.fingerprint;
          platformPackUsed = orch.platformPackUsed;
          apiValidationReport = orch.apiValidationReport;
          log.info('orchestrator parallel discovery', {
            onboardingId,
            selected: platformPackUsed ? 'platform_pack' : 'static_site',
            notes: orch.notes,
          });
        } else {
          discovery = await discoverSite(inputUrl, { fetchText });
          fingerprint = fingerprintSite({
            domain: discovery.domain,
            homepageUrl: discovery.homepageUrl,
            homepageHtml: discovery.homepageHtml,
            agentUrls: discovery.crawlRecipe.sampleProductUrls,
          });
          const platformPackResult = await tryPlatformPackDiscovery(discovery, fingerprint);
          discovery = platformPackResult.discovery;
          platformPackUsed = platformPackResult.used;
          if (platformPackResult.validationReport) {
            apiValidationReport = platformPackResult.validationReport;
          }
        }
      } catch (err) {
        log.error('discovery threw', { onboardingId, inputUrl, err: String(err) });
        await markFailed(onboardingId, `Could not analyze that site: ${String(err)}`);
        return;
      }

      let jinaResult: CategoryDirectoryResult | null = null;
      if (!platformPackUsed) {
        try {
          jinaResult = await discoverCategoryDirectory({
            homepageUrl: discovery.homepageUrl,
            domain: discovery.domain,
          });
        if (
          jinaResult &&
          jinaResult.directory.confidence >= 0.3 &&
          jinaResult.directory.categories.length > 0
        ) {
          discovery = {
            ...discovery,
            productUrlPattern: jinaResult.directory.productUrlPattern,
            fetchStrategy: 'jina_reader',
            confidence: Math.max(discovery.confidence, jinaResult.directory.confidence),
            crawlRecipe: mergeJinaIntoCrawlRecipe(discovery.crawlRecipe, jinaResult.directory),
            notes: jinaResult.directory.notes
              ? `${discovery.notes}; jina: ${jinaResult.directory.notes}`
              : `${discovery.notes}; jina category discovery (${jinaResult.directory.categories.length} categories)`,
          };
          log.info('Jina category discovery succeeded', {
            onboardingId,
            categories: jinaResult.directory.categories.length,
            confidence: jinaResult.directory.confidence,
          });
        } else {
          log.info('Jina category discovery skipped or low confidence', {
            onboardingId,
            confidence: jinaResult?.directory.confidence,
            categories: jinaResult?.directory.categories.length ?? 0,
          });
          jinaResult = null;
        }
        } catch (err) {
          log.warn('Jina category discovery failed', { onboardingId, err: String(err) });
          jinaResult = null;
        }
      }

      // Sniff XHR/fetch only when HTML/sitemap discovery failed — saves time + AI credits.
      const needsApiSniff =
        !platformPackUsed && !jinaResult && (discovery.confidence <= 0 || !discovery.productUrlPattern);

      if (needsApiSniff) {
        const networkResult = await tryNetworkApiDiscovery(inputUrl, discovery);
        discovery = networkResult.discovery;
        if (networkResult.validationReport) {
          apiValidationReport = networkResult.validationReport;
        }
      }

      const effectivePattern =
        discovery.productUrlPattern ?? deriveProductPattern(discovery.sampleProductUrls);
      if (effectivePattern && !discovery.productUrlPattern) {
        discovery = {
          ...discovery,
          productUrlPattern: effectivePattern,
          crawlRecipe: {
            ...discovery.crawlRecipe,
            productUrlPattern: effectivePattern,
          },
        };
      }

      const view = toDiscoveryView(discovery);
      const hasApiRecipe =
        discovery.crawlRecipe.discoveryMode === 'api' && discovery.crawlRecipe.api != null;
      const hasJinaRecipe =
        discovery.crawlRecipe.discoveryMode === 'jina_categories' &&
        discovery.crawlRecipe.jina != null &&
        (jinaResult?.directory.categories.length ?? 0) > 0;
      const minSamples = effectivePattern === '/products/' || effectivePattern === '/pdp/' ? 2 : 3;
      const hasPathEvidence =
        !!effectivePattern &&
        discovery.sampleProductUrls.length >= minSamples &&
        (discovery.confidence > 0 || discovery.notes.includes('path pattern'));

      if (
        !hasApiRecipe &&
        !hasJinaRecipe &&
        !hasPathEvidence &&
        (!effectivePattern || discovery.confidence <= 0)
      ) {
        log.warn('no products confirmed', { onboardingId, inputUrl, notes: discovery.notes });
        const shutdown = discovery.notes.includes('consolidated') || discovery.notes.includes('no longer');
        const botWall =
          discovery.notes.includes('content fetch blocked') ||
          discovery.notes.includes('homepage fetch returned no HTML');
        let msg = 'Could not confirm any product pages on that site, so a crawl could not be configured.';
        if (shutdown) {
          msg = 'This store appears to be closed or consolidated and may no longer sell products online.';
        } else if (botWall && inputUrl.includes('sportsexperts')) {
          msg =
            'Sports Experts blocks automated access (Incapsula). We cannot sniff their catalog API yet.';
        }
        await markFailed(onboardingId, msg + (discovery.notes ? ` (${discovery.notes})` : ''), view);
        return;
      }

      // Re-check dedupe: another path may have created this retailer meanwhile.
      const [existing] = await db
        .select()
        .from(schema.retailers)
        .where(
          or(eq(schema.retailers.key, discovery.key), eq(schema.retailers.domain, discovery.domain)),
        );

      let retailerId: string;
      const recipeChanged = hasJinaRecipe || hasApiRecipe || platformPackUsed;
      if (existing) {
        retailerId = existing.id;
        if (recipeChanged) {
          await db.transaction(async (tx) => {
            await tx
              .update(schema.retailers)
              .set({
                fetchStrategy: discovery.fetchStrategy,
                productUrlPattern: discovery.productUrlPattern,
                discoveryNotes: discovery.notes,
                updatedAt: new Date(),
              })
              .where(eq(schema.retailers.id, retailerId));
            await writeRecipeVersion(
              {
                retailerId,
                crawlRecipe: discovery.crawlRecipe,
                fingerprint,
                confidence: discovery.confidence,
                validationReport: apiValidationReport,
                createdBy: 'discovery',
              },
              tx,
            );
          });
        }
      } else {
        // Re-check the plan limit at promotion time — the org may have hit the
        // cap while this job was queued.
        const org = await db
          .select({ plan: schema.orgs.plan })
          .from(schema.orgs)
          .where(eq(schema.orgs.id, onboarding.orgId));
        const plan = org[0]?.plan ?? 'trial';
        const [{ value: trackedCount } = { value: 0 }] = await db
          .select({ value: count() })
          .from(schema.orgCompetitors)
          .where(eq(schema.orgCompetitors.orgId, onboarding.orgId));
        const maxCompetitors = PLAN_LIMITS[plan].maxCompetitors;
        if (trackedCount >= maxCompetitors) {
          log.warn('plan limit reached at promotion', { onboardingId, plan, trackedCount });
          await markFailed(
            onboardingId,
            `Your ${plan} plan allows ${maxCompetitors} competitors. Upgrade to add this store.`,
            view,
          );
          return;
        }

        const [created] = await db.transaction(async (tx) => {
          const [row] = await tx
            .insert(schema.retailers)
            .values({
              key: discovery.key,
              name: discovery.name,
              domain: discovery.domain,
              country: 'CA',
              source: 'user',
              enabled: true,
              respectRobotsTxt: true,
              requestDelayMs: discovery.crawlDelayMs ?? 3000,
              fetchStrategy: discovery.fetchStrategy,
              homepageUrl: discovery.homepageUrl,
              sitemapUrl: (discovery.sitemapUrls.length
                ? discovery.sitemapUrls
                : [discovery.sitemapUrl]
              )
                .filter(Boolean)
                .join('\n'),
              productUrlPattern: discovery.productUrlPattern,
              llmsTxtUrl: discovery.llmsTxtUrl,
              crawlRecipe: discovery.crawlRecipe,
              discoveryNotes: discovery.notes,
              fingerprint,
              discoveryConfidence: discovery.confidence,
            })
            .returning({ id: schema.retailers.id });
          if (!row) return [];
          await writeRecipeVersion(
            {
              retailerId: row.id,
              crawlRecipe: discovery.crawlRecipe,
              fingerprint,
              confidence: discovery.confidence,
              validationReport: apiValidationReport,
              createdBy: 'discovery',
            },
            tx,
          );
          return [row];
        });
        if (!created) {
          await markFailed(onboardingId, 'Failed to create the store record', view);
          return;
        }
        retailerId = created.id;
      }

      if (jinaResult && hasJinaRecipe) {
        await saveListingPages(retailerId, jinaResult.directory);
        log.info('saved Jina listing pages', {
          retailerId,
          count: jinaResult.directory.categories.length,
        });
      }

      await db
        .insert(schema.orgCompetitors)
        .values({ orgId: onboarding.orgId, retailerId })
        .onConflictDoNothing();

      // Kick off the first crawl (only runs once the discover worker consumes it).
      const [run] = await db
        .insert(schema.crawlRuns)
        .values({ retailerId, status: 'queued' })
        .returning({ id: schema.crawlRuns.id });
      if (run) {
        await queues.discover().add('discover', { retailerKey: discovery.key, crawlRunId: run.id });
      }

      await db
        .update(schema.storeOnboarding)
        .set({ status: 'ready', retailerId, result: view, error: null, updatedAt: new Date() })
        .where(eq(schema.storeOnboarding.id, onboardingId));

      log.info('store onboarded', {
        onboardingId,
        retailerId,
        key: discovery.key,
        fetchStrategy: discovery.fetchStrategy,
      });
    },
    { connection: redisConnection(), concurrency: 1 },
  );
}

/** Phase A: deterministic platform pack probes before Jina/network sniff. */
async function tryPlatformPackDiscovery(
  discovery: SiteDiscovery,
  fingerprint: RetailerFingerprint,
): Promise<{ discovery: SiteDiscovery; used: boolean; validationReport?: ApiRecipeValidation['report'] }> {
  if (fingerprint.platformConfidence < 0.5 || fingerprint.recommendedStrategy !== 'platform_pack') {
    return { discovery, used: false };
  }

  const browserFetcher = fetcherFor('browser') as BrowserFetcher;
  const strategies: Array<'static' | 'browser'> = ['static', 'browser'];

  for (const fetchStrategy of strategies) {
    const fetchJson = createApiFetchJson({ fetchStrategy, browserFetcher });
    const packResult = await runPlatformPack(fingerprint, {
      origin: discovery.homepageUrl,
      domain: discovery.domain,
      homepageHtml: discovery.homepageHtml,
      fetchJson,
    });
    if (!packResult) continue;

    const draft = mergePlatformPackIntoDiscovery(
      discovery,
      packResult.api,
      packResult.productUrlPattern,
      [],
      crawlRecipePlatformFromFingerprint(fingerprint),
      packResult.probeUrl,
      fetchStrategy,
      discovery.confidence,
    );

    const validation = await validateApiRecipe(draft.crawlRecipe, discovery.key, fetchJson, 3);
    if (!validation.ok) {
      log.warn('platform pack recipe failed validation', {
        key: discovery.key,
        endpoint: packResult.api.baseUrl,
        fetchStrategy,
        failureModes: validation.report.failureModes,
      });
      continue;
    }

    log.info('platform pack recipe validated', {
      key: discovery.key,
      products: validation.count,
      endpoint: packResult.api.baseUrl,
      fetchStrategy,
      confidence: validation.report.confidence,
    });

    return {
      discovery: mergePlatformPackIntoDiscovery(
        discovery,
        packResult.api,
        packResult.productUrlPattern,
        validation.samples.map((s) => s.sourceUrl),
        crawlRecipePlatformFromFingerprint(fingerprint),
        packResult.probeUrl,
        fetchStrategy,
        validation.report.confidence,
      ),
      used: true,
      validationReport: validation.report,
    };
  }

  log.info('platform pack found no validated endpoint', { key: discovery.key, platform: fingerprint.platform });
  return { discovery, used: false };
}

async function validateRecipeWithTransport(
  discovery: SiteDiscovery,
  crawlRecipe: SiteDiscovery['crawlRecipe'],
): Promise<{
  ok: boolean;
  validation: ApiRecipeValidation;
  fetchStrategy: 'static' | 'browser';
  fetchJson: ReturnType<typeof createApiFetchJson>;
} | null> {
  const browserFetcher = fetcherFor('browser') as BrowserFetcher;
  let last: ApiRecipeValidation | null = null;
  for (const fetchStrategy of ['static', 'browser'] as const) {
    const fetchJson = createApiFetchJson({ fetchStrategy, browserFetcher });
    const validation = await validateApiRecipe(crawlRecipe, discovery.key, fetchJson, 3);
    last = validation;
    if (validation.ok) {
      return { ok: true, validation, fetchStrategy, fetchJson };
    }
  }
  if (!last) return null;
  const fetchJson = createApiFetchJson({ fetchStrategy: 'static', browserFetcher });
  return { ok: false, validation: last, fetchStrategy: 'static', fetchJson };
}

/** Phase B: sniff XHR/fetch traffic, infer + validate an API crawl recipe. */
async function tryNetworkApiDiscovery(
  inputUrl: string,
  discovery: SiteDiscovery,
): Promise<{ discovery: SiteDiscovery; validationReport?: ApiRecipeValidation['report'] }> {
  log.info('network API sniff starting', { inputUrl, key: discovery.key });

  const captures = await captureNetworkJson(inputUrl);
  if (!captures.length) {
    log.info('network API sniff found no product-like JSON', { inputUrl });
    return { discovery };
  }

  const inferred = await inferApiRecipeFromCaptures(captures, {
    domain: discovery.domain,
    homepageUrl: discovery.homepageUrl,
  });
  if (!inferred) {
    log.warn('network API sniff could not infer recipe', { inputUrl, captures: captures.length });
    return { discovery };
  }

  const draft = mergeApiIntoDiscovery(
    discovery,
    inferred.api,
    inferred.productUrlPattern,
    discovery.sampleProductUrls,
  );

  const validated = await validateRecipeWithTransport(discovery, draft.crawlRecipe);
  if (!validated?.ok) {
    log.warn('inferred API recipe failed validation', {
      key: discovery.key,
      failureModes: validated?.validation.report.failureModes,
    });
    return { discovery };
  }

  log.info('network API recipe validated', {
    key: discovery.key,
    products: validated.validation.count,
    endpoint: inferred.api.baseUrl,
    fetchStrategy: validated.fetchStrategy,
  });

  const merged = mergeApiIntoDiscovery(
    discovery,
    inferred.api,
    inferred.productUrlPattern,
    validated.validation.samples.map((s) => s.sourceUrl),
  );

  return {
    discovery: {
      ...merged,
      fetchStrategy: validated.fetchStrategy,
      confidence: validated.validation.report.confidence,
      crawlRecipe: {
        ...merged.crawlRecipe,
        fetchStrategy: validated.fetchStrategy,
        confidence: validated.validation.report.confidence,
      },
    },
    validationReport: validated.validation.report,
  };
}

