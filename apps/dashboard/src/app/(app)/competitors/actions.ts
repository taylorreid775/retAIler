'use server';

import { revalidatePath } from 'next/cache';
import { db, schema, eq, and, or, desc, inArray, ne, count, writeRecipeVersion, createDiscoveryRun, completeDiscoveryRun, checkpointDiscoveryStage } from '@retailer/db';
import { discoverSite, fingerprintSite, deriveRetailerKey, normalizeRetailerDomain, discoverListingPageUrls, saveListingPageUrls } from '@retailer/crawler';
import { queues } from '@retailer/jobs';
import { PLAN_LIMITS } from '@retailer/schema';
import type { DiscoveryStage, StageCheckpoint } from '@retailer/schema';
import { getTenant } from '@/lib/tenant';
import { isDevCrawlNowEnabled } from '@/lib/dev-flags';

export async function addCompetitor(retailerId: string): Promise<{ error?: string }> {
  const tenant = await getTenant();
  if (!tenant) return { error: 'No organization selected' };
  if (tenant.competitorRetailerIds.length >= tenant.limits.maxCompetitors) {
    return { error: `Your ${tenant.org.plan} plan allows ${tenant.limits.maxCompetitors} competitors. Upgrade to add more.` };
  }
  await db
    .insert(schema.orgCompetitors)
    .values({ orgId: tenant.org.id, retailerId })
    .onConflictDoNothing();
  revalidatePath('/competitors');
  revalidatePath('/');
  return {};
}

export async function removeCompetitor(retailerId: string): Promise<{ error?: string }> {
  const tenant = await getTenant();
  if (!tenant) return { error: 'No organization selected' };
  await db
    .delete(schema.orgCompetitors)
    .where(
      and(
        eq(schema.orgCompetitors.orgId, tenant.org.id),
        eq(schema.orgCompetitors.retailerId, retailerId),
      ),
    );
  revalidatePath('/competitors');
  revalidatePath('/');
  return {};
}

export interface StartAddStoreResult {
  error?: string;
  trackedExisting?: boolean;
  /** Set when a new store onboarding row was created and discovery should run. */
  onboardingId?: string;
  inputUrl?: string;
}

export interface AddStoreResult {
  error?: string;
  /** Set when an already-known store was tracked instead of created. */
  trackedExisting?: boolean;
  /**
   * Set when static discovery couldn't confirm products and the store was
   * handed off to the worker for browser-backed discovery in the background.
   */
  pending?: boolean;
  discovery?: {
    name: string;
    domain: string;
    sitemapUrl: string | null;
    sitemapUrls: string[];
    productUrlPattern: string | null;
    llmsTxtUrl: string | null;
    fetchStrategy: 'static' | 'browser' | 'jina_reader';
    confidence: number;
    sampleProductUrls: string[];
    crawlRecipe?: unknown;
    notes: string;
  };
}

/** Normalize a user-entered store URL to a canonical https form. */
function normalizeStoreUrl(rawUrl: string): { input: string; host: string } | { error: string } {
  const input = rawUrl.trim();
  if (!input) return { error: 'Enter a store URL' };
  try {
    const withProto = /^https?:\/\//i.test(input) ? input : `https://${input}`;
    const host = new URL(withProto).host;
    if (!host) return { error: 'That does not look like a valid URL' };
    return { input: withProto, host };
  } catch {
    return { error: 'That does not look like a valid URL' };
  }
}

/**
 * Fast first step: validate, dedupe, and create a `store_onboarding` row
 * immediately so the UI can show a persistent pending card before any slow
 * discovery work runs.
 */
export async function startAddStoreByUrl(rawUrl: string): Promise<StartAddStoreResult> {
  const tenant = await getTenant();
  if (!tenant) return { error: 'No organization selected' };

  const parsed = normalizeStoreUrl(rawUrl);
  if ('error' in parsed) return { error: parsed.error };
  const { input, host } = parsed;
  const domain = normalizeRetailerDomain(host);
  const key = deriveRetailerKey(domain);

  const [existing] = await db
    .select()
    .from(schema.retailers)
    .where(or(eq(schema.retailers.key, key), eq(schema.retailers.domain, domain)));
  if (existing) {
    if (tenant.competitorRetailerIds.includes(existing.id)) {
      return { trackedExisting: true };
    }
    if (tenant.competitorRetailerIds.length >= tenant.limits.maxCompetitors) {
      return {
        error: `This store already exists, but your ${tenant.org.plan} plan allows ${tenant.limits.maxCompetitors} competitors. Upgrade to track more.`,
      };
    }
    await db
      .insert(schema.orgCompetitors)
      .values({ orgId: tenant.org.id, retailerId: existing.id })
      .onConflictDoNothing();
    revalidatePath('/competitors');
    revalidatePath('/');
    return { trackedExisting: true };
  }

  if (tenant.competitorRetailerIds.length >= tenant.limits.maxCompetitors) {
    return {
      error: `Your ${tenant.org.plan} plan allows ${tenant.limits.maxCompetitors} competitors. Upgrade to add more.`,
    };
  }

  // Another org may already be discovering this domain — avoid duplicate work.
  const [globalInFlight] = await db
    .select({
      id: schema.storeOnboarding.id,
      retailerId: schema.storeOnboarding.retailerId,
    })
    .from(schema.storeOnboarding)
    .where(
      and(
        eq(schema.storeOnboarding.normalizedDomain, domain),
        inArray(schema.storeOnboarding.status, ['queued', 'discovering']),
      ),
    )
    .limit(1);
  if (globalInFlight) {
    if (globalInFlight.retailerId) {
      const linked = await linkOrgToRetailer(tenant, globalInFlight.retailerId);
      if (linked.error) return linked;
      revalidatePath('/competitors');
      revalidatePath('/');
      return { trackedExisting: true };
    }
    const [waiting] = await db
      .insert(schema.storeOnboarding)
      .values({
        orgId: tenant.org.id,
        inputUrl: input,
        normalizedDomain: domain,
        status: 'queued',
      })
      .returning({ id: schema.storeOnboarding.id });
    if (!waiting) return { error: 'Failed to start store onboarding' };
    revalidatePath('/competitors');
    revalidatePath('/');
    return { onboardingId: waiting.id, inputUrl: input };
  }

  // Re-use an in-flight onboarding for the same URL instead of duplicating.
  const [inFlight] = await db
    .select({ id: schema.storeOnboarding.id })
    .from(schema.storeOnboarding)
    .where(
      and(
        eq(schema.storeOnboarding.orgId, tenant.org.id),
        eq(schema.storeOnboarding.inputUrl, input),
        inArray(schema.storeOnboarding.status, ['queued', 'discovering']),
      ),
    );
  if (inFlight) {
    return { onboardingId: inFlight.id, inputUrl: input };
  }

  const [onboarding] = await db
    .insert(schema.storeOnboarding)
    .values({
      orgId: tenant.org.id,
      inputUrl: input,
      normalizedDomain: domain,
      status: 'discovering',
    })
    .returning({ id: schema.storeOnboarding.id });
  if (!onboarding) return { error: 'Failed to start store onboarding' };

  revalidatePath('/competitors');
  revalidatePath('/');
  return { onboardingId: onboarding.id, inputUrl: input };
}

/**
 * Second step: run a quick static discovery pass in the dashboard. Easy sites
 * are promoted immediately; bot-protected sites are handed off to the worker
 * without blocking the UI for minutes.
 */
export async function processAddStoreByUrl(onboardingId: string): Promise<AddStoreResult> {
  const tenant = await getTenant();
  if (!tenant) return { error: 'No organization selected' };

  const [onboarding] = await db
    .select()
    .from(schema.storeOnboarding)
    .where(
      and(eq(schema.storeOnboarding.id, onboardingId), eq(schema.storeOnboarding.orgId, tenant.org.id)),
    );
  if (!onboarding) return { error: 'Onboarding not found' };
  if (onboarding.status === 'ready') return { discovery: onboarding.result as AddStoreResult['discovery'] };
  if (onboarding.status === 'failed') {
    return { error: onboarding.error ?? 'Discovery failed' };
  }

  const input = onboarding.inputUrl;
  const domain = onboarding.normalizedDomain ?? normalizeRetailerDomain(input);

  // Wait for another org's in-flight discovery — do not enqueue duplicate work.
  if (onboarding.status === 'queued') {
    const [otherOrgDiscovering] = await db
      .select({ id: schema.storeOnboarding.id })
      .from(schema.storeOnboarding)
      .where(
        and(
          eq(schema.storeOnboarding.normalizedDomain, domain),
          inArray(schema.storeOnboarding.status, ['discovering']),
          ne(schema.storeOnboarding.id, onboardingId),
        ),
      )
      .limit(1);
    if (otherOrgDiscovering) {
      return { pending: true };
    }
  }

  let discovery: Awaited<ReturnType<typeof discoverSite>> | null = null;
  try {
    // Cap wall-clock time so bot-walled sites hand off quickly instead of
    // wedging the server action (and the button spinner) for minutes.
    discovery = await Promise.race([
      discoverSite(input, { sampleLimit: 8, corpusLimit: 50 }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 12_000)),
    ]);
  } catch (err) {
    await markOnboardingFailed(onboardingId, `Could not analyze that site: ${String(err)}`);
    revalidatePath('/competitors');
    revalidatePath('/');
    return { error: `Could not analyze that site: ${String(err)}` };
  }

  if (!discovery?.productUrlPattern || discovery.confidence <= 0) {
    return handOffToWorker(onboardingId, discovery);
  }

  return promoteDiscoveredStore(tenant.org.id, onboardingId, discovery);
}

/** @deprecated Use startAddStoreByUrl + processAddStoreByUrl for responsive UI. */
export async function addStoreByUrl(rawUrl: string): Promise<AddStoreResult> {
  const start = await startAddStoreByUrl(rawUrl);
  if (start.error || start.trackedExisting || !start.onboardingId) {
    return start;
  }
  return processAddStoreByUrl(start.onboardingId);
}

async function linkOrgToRetailer(
  tenant: NonNullable<Awaited<ReturnType<typeof getTenant>>>,
  retailerId: string,
): Promise<{ error?: string }> {
  if (tenant.competitorRetailerIds.includes(retailerId)) return {};
  if (tenant.competitorRetailerIds.length >= tenant.limits.maxCompetitors) {
    return {
      error: `This store already exists, but your ${tenant.org.plan} plan allows ${tenant.limits.maxCompetitors} competitors. Upgrade to track more.`,
    };
  }
  await db
    .insert(schema.orgCompetitors)
    .values({ orgId: tenant.org.id, retailerId })
    .onConflictDoNothing();
  return {};
}

async function handOffToWorker(
  onboardingId: string,
  discovery: Awaited<ReturnType<typeof discoverSite>> | null,
): Promise<AddStoreResult> {
  const view = discovery ? toDiscoveryView(discovery) : null;
  const normalizedDomain = discovery
    ? normalizeRetailerDomain(discovery.domain)
    : undefined;
  await db
    .update(schema.storeOnboarding)
    .set({
      status: 'queued',
      result: view,
      normalizedDomain,
      updatedAt: new Date(),
    })
    .where(eq(schema.storeOnboarding.id, onboardingId));

  await queues.discoverConfig().add('discover-config', { onboardingId });

  revalidatePath('/competitors');
  revalidatePath('/');
  return { pending: true, discovery: view ?? undefined };
}

async function markOnboardingFailed(onboardingId: string, error: string): Promise<void> {
  await db
    .update(schema.storeOnboarding)
    .set({ status: 'failed', error, updatedAt: new Date() })
    .where(eq(schema.storeOnboarding.id, onboardingId));
}

async function promoteDiscoveredStore(
  orgId: string,
  onboardingId: string,
  discovery: Awaited<ReturnType<typeof discoverSite>>,
): Promise<AddStoreResult> {
  const view = toDiscoveryView(discovery);
  const normalizedDomain = normalizeRetailerDomain(discovery.domain);
  const fingerprint = fingerprintSite({
    domain: discovery.domain,
    homepageUrl: discovery.homepageUrl,
    homepageHtml: discovery.homepageHtml,
    agentUrls: discovery.crawlRecipe.sampleProductUrls,
  });

  const [existing] = await db
    .select()
    .from(schema.retailers)
    .where(
      or(eq(schema.retailers.key, discovery.key), eq(schema.retailers.domain, normalizedDomain)),
    );
  if (existing) {
    const [org] = await db
      .select({ plan: schema.orgs.plan })
      .from(schema.orgs)
      .where(eq(schema.orgs.id, orgId));
    const plan = org?.plan ?? 'trial';
    const [{ value: trackedCount } = { value: 0 }] = await db
      .select({ value: count() })
      .from(schema.orgCompetitors)
      .where(eq(schema.orgCompetitors.orgId, orgId));
    const limit = PLAN_LIMITS[plan].maxCompetitors;

    const [alreadyTracked] = await db
      .select({ retailerId: schema.orgCompetitors.retailerId })
      .from(schema.orgCompetitors)
      .where(
        and(
          eq(schema.orgCompetitors.orgId, orgId),
          eq(schema.orgCompetitors.retailerId, existing.id),
        ),
      )
      .limit(1);
    if (!alreadyTracked && trackedCount >= limit) {
      await markOnboardingFailed(
        onboardingId,
        `This store already exists, but your ${plan} plan allows ${limit} competitors. Upgrade to track more.`,
      );
      revalidatePath('/competitors');
      revalidatePath('/');
      return {
        error: `This store already exists, but your ${plan} plan allows ${limit} competitors. Upgrade to track more.`,
      };
    }

    await db
      .insert(schema.orgCompetitors)
      .values({ orgId, retailerId: existing.id })
      .onConflictDoNothing();
    await db
      .update(schema.storeOnboarding)
      .set({
        status: 'ready',
        retailerId: existing.id,
        result: view,
        error: null,
        normalizedDomain,
        updatedAt: new Date(),
      })
      .where(eq(schema.storeOnboarding.id, onboardingId));

    revalidatePath('/competitors');
    revalidatePath('/');
    return { trackedExisting: true, discovery: view };
  }

  const [retailer] = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.retailers)
      .values({
        key: discovery.key,
        name: discovery.name,
        domain: normalizedDomain,
        country: 'CA',
        source: 'user',
        enabled: true,
        respectRobotsTxt: true,
        requestDelayMs: discovery.crawlDelayMs ?? 3000,
        fetchStrategy: discovery.fetchStrategy,
        homepageUrl: discovery.homepageUrl,
        sitemapUrl: (discovery.sitemapUrls.length ? discovery.sitemapUrls : [discovery.sitemapUrl])
          .filter(Boolean)
          .join('\n'),
        productUrlPattern: discovery.productUrlPattern,
        llmsTxtUrl: discovery.llmsTxtUrl,
        crawlRecipe: discovery.crawlRecipe,
        discoveryNotes: discovery.notes,
        fingerprint,
        discoveryConfidence: discovery.confidence,
      })
      .returning();
    if (!row) return [];
    await writeRecipeVersion(
      {
        retailerId: row.id,
        crawlRecipe: discovery.crawlRecipe,
        fingerprint,
        confidence: discovery.confidence,
        createdBy: 'discovery',
      },
      tx,
    );
    return [row];
  });
  if (!retailer) {
    await markOnboardingFailed(onboardingId, 'Failed to create the store record');
    revalidatePath('/competitors');
    revalidatePath('/');
    return { error: 'Failed to create the store record' };
  }

  if (discovery.crawlRecipe.discoveryMode === 'listing_pages') {
    const listingUrls = discoverListingPageUrls({
      homepageUrl: discovery.homepageUrl,
      homepageHtml: discovery.homepageHtml,
      crawlRecipe: discovery.crawlRecipe,
    });
    await saveListingPageUrls(retailer.id, listingUrls, discovery.crawlRecipe);
  }

  await db
    .insert(schema.orgCompetitors)
    .values({ orgId, retailerId: retailer.id })
    .onConflictDoNothing();

  const [run] = await db
    .insert(schema.crawlRuns)
    .values({ retailerId: retailer.id, status: 'queued' })
    .returning({ id: schema.crawlRuns.id });
  if (run) {
    await queues.discover().add('discover', { retailerKey: retailer.key, crawlRunId: run.id });
  }

  await db
    .update(schema.storeOnboarding)
    .set({
      status: 'ready',
      retailerId: retailer.id,
      result: view,
      error: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.storeOnboarding.id, onboardingId));

  try {
    const runId = await createDiscoveryRun({ onboardingId, retailerId: retailer.id });
    await checkpointDiscoveryStage({
      runId,
      stage: 'static',
      status: 'completed',
      fingerprint,
    });
    await checkpointDiscoveryStage({ runId, stage: 'promote', status: 'completed' });
    await completeDiscoveryRun({ runId, status: 'completed', retailerId: retailer.id });
  } catch {
    // discovery_runs table may not exist until migration is applied
  }

  revalidatePath('/competitors');
  revalidatePath('/');
  return { discovery: view };
}

function toDiscoveryView(d: Awaited<ReturnType<typeof discoverSite>>): AddStoreResult['discovery'] {
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

/**
 * Remove a `ready`/`failed` onboarding row from the org's list. `ready` rows
 * have already been promoted to a tracked retailer, so dropping the onboarding
 * record just clears the transient card; `failed` rows are dismissed manually.
 */
export async function dismissOnboarding(id: string): Promise<{ error?: string }> {
  const tenant = await getTenant();
  if (!tenant) return { error: 'No organization selected' };
  await db
    .delete(schema.storeOnboarding)
    .where(
      and(eq(schema.storeOnboarding.id, id), eq(schema.storeOnboarding.orgId, tenant.org.id)),
    );
  revalidatePath('/competitors');
  revalidatePath('/');
  return {};
}

export interface OnboardingStatus {
  id: string;
  inputUrl: string;
  status: 'queued' | 'discovering' | 'ready' | 'failed';
  error: string | null;
  updatedAt: string;
  discovery?: {
    currentStage: DiscoveryStage | null;
    stagesCompleted: StageCheckpoint[];
    runStatus: string;
  };
}

/**
 * Lightweight poll target for the site-wide notifier and the competitors list.
 * Returns the org's non-dismissed onboarding rows.
 */
export async function getOnboardingStatuses(): Promise<OnboardingStatus[]> {
  const tenant = await getTenant();
  if (!tenant) return [];
  const rows = await db
    .select({
      id: schema.storeOnboarding.id,
      inputUrl: schema.storeOnboarding.inputUrl,
      status: schema.storeOnboarding.status,
      error: schema.storeOnboarding.error,
      updatedAt: schema.storeOnboarding.updatedAt,
    })
    .from(schema.storeOnboarding)
    .where(eq(schema.storeOnboarding.orgId, tenant.org.id))
    .orderBy(desc(schema.storeOnboarding.createdAt));

  const activeIds = rows
    .filter((r) => r.status === 'queued' || r.status === 'discovering')
    .map((r) => r.id);
  const runByOnboarding = new Map<
    string,
    { currentStage: DiscoveryStage | null; stagesCompleted: StageCheckpoint[]; runStatus: string }
  >();

  if (activeIds.length > 0) {
    const runs = await db
      .select({
        onboardingId: schema.discoveryRuns.onboardingId,
        currentStage: schema.discoveryRuns.currentStage,
        stagesCompleted: schema.discoveryRuns.stagesCompleted,
        status: schema.discoveryRuns.status,
        startedAt: schema.discoveryRuns.startedAt,
      })
      .from(schema.discoveryRuns)
      .where(inArray(schema.discoveryRuns.onboardingId, activeIds))
      .orderBy(desc(schema.discoveryRuns.startedAt));

    for (const run of runs) {
      if (!run.onboardingId || runByOnboarding.has(run.onboardingId)) continue;
      runByOnboarding.set(run.onboardingId, {
        currentStage: (run.currentStage as DiscoveryStage | null) ?? null,
        stagesCompleted: run.stagesCompleted ?? [],
        runStatus: run.status,
      });
    }
  }

  return rows.map((r) => ({
    id: r.id,
    inputUrl: r.inputUrl,
    status: r.status,
    error: r.error,
    updatedAt: r.updatedAt.toISOString(),
    discovery: runByOnboarding.get(r.id),
  }));
}

export async function setOwnRetailer(retailerId: string | null): Promise<{ error?: string }> {
  const tenant = await getTenant();
  if (!tenant) return { error: 'No organization selected' };
  await db
    .update(schema.orgs)
    .set({ ownRetailerId: retailerId })
    .where(eq(schema.orgs.id, tenant.org.id));
  revalidatePath('/competitors');
  revalidatePath('/seo');
  return {};
}

/** Dev-only: enqueue an immediate discover crawl for a retailer (same as worker CLI `enqueue`). */
export async function triggerCrawlNow(
  retailerId: string,
): Promise<{ error?: string; crawlRunId?: string }> {
  if (!isDevCrawlNowEnabled()) {
    return { error: 'Crawl now is disabled (set ENABLE_DEV_CRAWL_NOW=true while testing).' };
  }

  const tenant = await getTenant();
  if (!tenant) return { error: 'No organization selected' };

  const [retailer] = await db
    .select()
    .from(schema.retailers)
    .where(eq(schema.retailers.id, retailerId));
  if (!retailer) return { error: 'Store not found' };
  if (!retailer.enabled) return { error: 'Store is disabled' };

  const [run] = await db
    .insert(schema.crawlRuns)
    .values({ retailerId: retailer.id, status: 'queued' })
    .returning({ id: schema.crawlRuns.id });
  if (!run) return { error: 'Failed to create crawl run' };

  await queues.discover().add('discover', {
    retailerKey: retailer.key,
    crawlRunId: run.id,
  });

  revalidatePath('/competitors');
  revalidatePath('/status');
  return { crawlRunId: run.id };
}
