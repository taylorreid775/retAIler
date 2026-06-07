import { Worker, type Job, queues, redisConnection } from '@retailer/jobs';
import { createLogger } from '@retailer/core';
import { db, schema, eq, or, count } from '@retailer/db';
import {
  discoverSite,
  deriveProductPattern,
  inferApiRecipeFromCaptures,
  mergeApiIntoDiscovery,
  validateApiRecipe,
  type SiteDiscovery,
} from '@retailer/crawler';
import { QueueName, PLAN_LIMITS, type DiscoverConfigJob } from '@retailer/schema';
import { createDiscoverFetchText } from '../discover-fetch.js';
import { fetcherFor } from '../fetchers.js';
import { BrowserFetcher } from '../browser-fetcher.js';
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

      let discovery: SiteDiscovery;
      try {
        discovery = await discoverSite(inputUrl, { fetchText });
      } catch (err) {
        log.error('discovery threw', { onboardingId, inputUrl, err: String(err) });
        await markFailed(onboardingId, `Could not analyze that site: ${String(err)}`);
        return;
      }

      // Sniff XHR/fetch only when HTML/sitemap discovery failed — saves time + AI credits.
      const needsApiSniff = discovery.confidence <= 0 || !discovery.productUrlPattern;

      if (needsApiSniff) {
        discovery = await tryNetworkApiDiscovery(inputUrl, discovery);
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
      const minSamples = effectivePattern === '/products/' || effectivePattern === '/pdp/' ? 2 : 3;
      const hasPathEvidence =
        !!effectivePattern &&
        discovery.sampleProductUrls.length >= minSamples &&
        (discovery.confidence > 0 || discovery.notes.includes('path pattern'));

      if (!hasApiRecipe && !hasPathEvidence && (!effectivePattern || discovery.confidence <= 0)) {
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
      if (existing) {
        retailerId = existing.id;
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

        const [created] = await db
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
          })
          .returning({ id: schema.retailers.id });
        if (!created) {
          await markFailed(onboardingId, 'Failed to create the store record', view);
          return;
        }
        retailerId = created.id;
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

/** Phase B: sniff XHR/fetch traffic, infer + validate an API crawl recipe. */
async function tryNetworkApiDiscovery(
  inputUrl: string,
  discovery: SiteDiscovery,
): Promise<SiteDiscovery> {
  log.info('network API sniff starting', { inputUrl, key: discovery.key });

  const captures = await captureNetworkJson(inputUrl);
  if (!captures.length) {
    log.info('network API sniff found no product-like JSON', { inputUrl });
    return discovery;
  }

  const inferred = await inferApiRecipeFromCaptures(captures, {
    domain: discovery.domain,
    homepageUrl: discovery.homepageUrl,
  });
  if (!inferred) {
    log.warn('network API sniff could not infer recipe', { inputUrl, captures: captures.length });
    return discovery;
  }

  const browserFetcher = fetcherFor('browser') as BrowserFetcher;
  const fetchJson = async (url: string, headers: Record<string, string> = {}) => {
    const res = await browserFetcher.fetchJson(url, headers);
    if (res.status < 200 || res.status >= 300) return null;
    try {
      return JSON.parse(res.text) as unknown;
    } catch {
      return null;
    }
  };

  const draft = mergeApiIntoDiscovery(
    discovery,
    inferred.api,
    inferred.productUrlPattern,
    discovery.sampleProductUrls,
  );

  const validation = await validateApiRecipe(draft.crawlRecipe, discovery.key, fetchJson, 3);
  if (!validation.ok) {
    log.warn('inferred API recipe failed validation', {
      key: discovery.key,
      samples: validation.count,
    });
    return discovery;
  }

  log.info('network API recipe validated', {
    key: discovery.key,
    products: validation.count,
    endpoint: inferred.api.baseUrl,
  });

  return mergeApiIntoDiscovery(
    discovery,
    inferred.api,
    inferred.productUrlPattern,
    validation.samples.map((s) => s.sourceUrl),
  );
}

