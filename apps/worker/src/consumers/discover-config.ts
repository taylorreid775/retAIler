import { Worker, type Job, queues, redisConnection } from '@retailer/jobs';
import { createLogger } from '@retailer/core';
import { db, schema, eq, or, count } from '@retailer/db';
import { discoverSite, type SiteDiscovery } from '@retailer/crawler';
import { QueueName, PLAN_LIMITS, type DiscoverConfigJob } from '@retailer/schema';
import { fetcherFor } from '../fetchers.js';
import type { BrowserFetcher } from '../browser-fetcher.js';

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

      // Static-first, browser-fallback fetcher: sitemaps/robots fetch fast over
      // HTTP; only bot-walled PDPs render via the browser. Passing a fetchText
      // override makes discoverSite resolve fetchStrategy to 'browser'.
      const staticFetcher = fetcherFor('static');
      const browserFetcher = fetcherFor('browser') as BrowserFetcher;
      const fetchText = async (url: string): Promise<string | null> => {
        try {
          const staticRes = await staticFetcher.fetch(url);
          if (staticRes.status >= 200 && staticRes.status < 300) return staticRes.html;
        } catch (err) {
          log.warn('static fetch failed, trying browser', { url, err: String(err) });
        }
        try {
          const browserRes = await browserFetcher.fetch(url);
          return browserRes.status >= 200 && browserRes.status < 300 ? browserRes.html : null;
        } catch (err) {
          log.warn('browser fetch failed', { url, err: String(err) });
          return null;
        }
      };

      let discovery: SiteDiscovery;
      try {
        discovery = await discoverSite(inputUrl, { fetchText });
      } catch (err) {
        log.error('discovery threw', { onboardingId, inputUrl, err: String(err) });
        await markFailed(onboardingId, `Could not analyze that site: ${String(err)}`);
        return;
      }

      const view = toDiscoveryView(discovery);

      if (!discovery.productUrlPattern || discovery.confidence <= 0) {
        log.warn('no products confirmed', { onboardingId, inputUrl, notes: discovery.notes });
        await markFailed(
          onboardingId,
          'Could not confirm any product pages on that site, so a crawl could not be configured.' +
            (discovery.notes ? ` (${discovery.notes})` : ''),
          view,
        );
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
