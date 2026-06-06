'use server';

import { revalidatePath } from 'next/cache';
import { db, schema, eq, and, or, desc } from '@retailer/db';
import { discoverSite } from '@retailer/crawler';
import { queues } from '@retailer/jobs';
import { getTenant } from '@/lib/tenant';

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
    fetchStrategy: 'static' | 'browser';
    confidence: number;
    sampleProductUrls: string[];
    notes: string;
  };
}

/**
 * Self-serve onboarding: add a store from its homepage URL. If the store is
 * already known, just track it. Otherwise auto-discover its crawl config
 * (sitemap / robots / llms.txt / product-URL pattern / fetch strategy), create
 * a global retailer row, track it for this org, and enqueue an immediate crawl.
 */
export async function addStoreByUrl(rawUrl: string): Promise<AddStoreResult> {
  const tenant = await getTenant();
  if (!tenant) return { error: 'No organization selected' };

  const input = rawUrl.trim();
  if (!input) return { error: 'Enter a store URL' };

  let host: string;
  try {
    const withProto = /^https?:\/\//i.test(input) ? input : `https://${input}`;
    host = new URL(withProto).host;
  } catch {
    return { error: 'That does not look like a valid URL' };
  }
  if (!host) return { error: 'That does not look like a valid URL' };

  const key = slugifyHost(host);

  // Already in the platform? Just track it (subject to plan limits).
  const [existing] = await db
    .select()
    .from(schema.retailers)
    .where(or(eq(schema.retailers.key, key), eq(schema.retailers.domain, host)));
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

  // New store counts as a tracked competitor — enforce the plan limit up front.
  if (tenant.competitorRetailerIds.length >= tenant.limits.maxCompetitors) {
    return {
      error: `Your ${tenant.org.plan} plan allows ${tenant.limits.maxCompetitors} competitors. Upgrade to add more.`,
    };
  }

  // Auto-discover crawl config from the homepage. No browser fetcher is
  // available in the dashboard runtime, so JS-only sites may not confirm here.
  let discovery;
  try {
    discovery = await discoverSite(input);
  } catch (err) {
    return { error: `Could not analyze that site: ${String(err)}` };
  }

  if (!discovery.productUrlPattern || discovery.confidence <= 0) {
    // Static discovery (no browser in the dashboard runtime) couldn't confirm
    // products — likely a bot-walled / JS-only site (e.g. Walmart returns 307
    // to non-browser clients). Hand off to the worker, which retries discovery
    // through a real browser. Track progress in store_onboarding so the UI can
    // show a pending card that persists across navigation.
    const [onboarding] = await db
      .insert(schema.storeOnboarding)
      .values({
        orgId: tenant.org.id,
        inputUrl: input,
        status: 'queued',
        result: toDiscoveryView(discovery) ?? null,
      })
      .returning({ id: schema.storeOnboarding.id });
    if (!onboarding) return { error: 'Failed to start background discovery' };

    await queues.discoverConfig().add('discover-config', { onboardingId: onboarding.id });

    revalidatePath('/competitors');
    revalidatePath('/');
    return { pending: true, discovery: toDiscoveryView(discovery) };
  }

  const [retailer] = await db
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
      // Store every product-bearing sitemap (newline-separated); the worker
      // walks all of them when building the generic adapter.
      sitemapUrl: (discovery.sitemapUrls.length ? discovery.sitemapUrls : [discovery.sitemapUrl])
        .filter(Boolean)
        .join('\n'),
      productUrlPattern: discovery.productUrlPattern,
      llmsTxtUrl: discovery.llmsTxtUrl,
      discoveryNotes: discovery.notes,
    })
    .returning();
  if (!retailer) return { error: 'Failed to create the store record' };

  await db
    .insert(schema.orgCompetitors)
    .values({ orgId: tenant.org.id, retailerId: retailer.id })
    .onConflictDoNothing();

  // Kick off an immediate crawl. It only runs once a worker consumes the queue.
  const [run] = await db
    .insert(schema.crawlRuns)
    .values({ retailerId: retailer.id, status: 'queued' })
    .returning({ id: schema.crawlRuns.id });
  if (run) {
    await queues.discover().add('discover', { retailerKey: retailer.key, crawlRunId: run.id });
  }

  revalidatePath('/competitors');
  revalidatePath('/');
  return { discovery: toDiscoveryView(discovery) };
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
    notes: d.notes,
  };
}

function slugifyHost(host: string): string {
  return host
    .replace(/^www\./i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
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
  return rows.map((r) => ({
    id: r.id,
    inputUrl: r.inputUrl,
    status: r.status,
    error: r.error,
    updatedAt: r.updatedAt.toISOString(),
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
