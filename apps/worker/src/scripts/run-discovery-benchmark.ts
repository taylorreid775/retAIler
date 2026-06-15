/**
 * Run a multi-retailer discovery benchmark using the generalized discovery pipeline only.
 *
 * usage:
 *   pnpm --filter @retailer/worker exec tsx src/scripts/run-discovery-benchmark.ts
 *   pnpm --filter @retailer/worker exec tsx src/scripts/run-discovery-benchmark.ts --dry-run
 *   pnpm --filter @retailer/worker exec tsx src/scripts/run-discovery-benchmark.ts --resume results.json
 *   pnpm --filter @retailer/worker exec tsx src/scripts/run-discovery-benchmark.ts --enqueue-only
 *   pnpm --filter @retailer/worker exec tsx src/scripts/run-discovery-benchmark.ts --collect-only
 *
 * Remote (recommended): --enqueue-only writes jobs to production Redis; Fly.io discovery
 * worker processes them. Collect results later with --collect-only (no local browser).
 *
 * Local polling mode requires a worker; prefer --enqueue-only + --collect-only instead.
 */
import '../load-env.js';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { execSync } from 'node:child_process';
import { db, schema, eq, desc, and, gte } from '@retailer/db';
import { queues } from '@retailer/jobs';
import { normalizeRetailerDomain } from '@retailer/crawler';
import type {
  RetailerFingerprint,
  StageCheckpoint,
  RecommendedStrategy,
} from '@retailer/schema';

const BENCHMARK_DATE = '2026-06-14';
const POLL_MS = 5_000;
const TIMEOUT_MS = 20 * 60_000; // 20 min per retailer (browser + network sniff)
const BENCHMARK_TAG = `benchmark-${BENCHMARK_DATE}`;

/** Curated mix: Shopify, SFCC, Magento, BigCommerce, WooCommerce, custom, unknown. Includes easy + hard. */
const BENCHMARK_RETAILERS: Array<{ url: string; expectedPlatform?: string; notes?: string }> = [
  // Shopify
  { url: 'https://www.gymshark.com', expectedPlatform: 'shopify' },
  { url: 'https://www.allbirds.com', expectedPlatform: 'shopify' },
  { url: 'https://www.tentree.com', expectedPlatform: 'shopify' },
  { url: 'https://kith.com', expectedPlatform: 'shopify' },
  { url: 'https://www.glossier.com', expectedPlatform: 'shopify' },
  // Salesforce Commerce Cloud
  { url: 'https://www.lululemon.com', expectedPlatform: 'salesforce' },
  { url: 'https://www.patagonia.com', expectedPlatform: 'salesforce' },
  { url: 'https://www.nike.com', expectedPlatform: 'salesforce' },
  { url: 'https://www.columbia.com', expectedPlatform: 'salesforce' },
  { url: 'https://www.underarmour.com', expectedPlatform: 'salesforce' },
  // Magento
  { url: 'https://www.rei.com', expectedPlatform: 'magento' },
  { url: 'https://www.hockeymonkey.ca', expectedPlatform: 'magento' },
  // BigCommerce
  { url: 'https://www.skatewarehouse.com', expectedPlatform: 'bigcommerce' },
  { url: 'https://www.vistaprint.ca', expectedPlatform: 'bigcommerce' },
  // WooCommerce
  { url: 'https://www.saddlebackleather.com', expectedPlatform: 'woocommerce' },
  // Custom / unknown (Canadian sports + big-box — mix of easy and hard)
  { url: 'https://www.mec.ca', expectedPlatform: 'custom', notes: 'likely existing' },
  { url: 'https://www.decathlon.ca', expectedPlatform: 'custom' },
  { url: 'https://www.sportchek.ca', expectedPlatform: 'custom', notes: 'bot-protected API' },
  { url: 'https://www.marks.com', expectedPlatform: 'custom' },
  { url: 'https://www.altitude-sports.com', expectedPlatform: 'custom' },
  { url: 'https://www.runningroom.com', expectedPlatform: 'custom' },
  { url: 'https://www.walmart.ca', expectedPlatform: 'custom', notes: 'hard — bot protection' },
  { url: 'https://www.bestbuy.ca', expectedPlatform: 'custom', notes: 'hard — bot protection' },
  { url: 'https://www.canadiantire.ca', expectedPlatform: 'custom', notes: 'hard — custom API' },
  { url: 'https://www.uniqlo.com', expectedPlatform: 'custom', notes: 'hard — custom React' },
];

type FinalStatus = 'Success' | 'Partial Success' | 'Failed';

interface RetailerBenchmarkResult {
  name: string;
  url: string;
  expectedPlatform?: string;
  domain: string;
  retailerKey: string | null;
  mode: 'onboard' | 'rediscover';
  onboardingId: string | null;
  discoveryRunId: string | null;
  platformDetected: string | null;
  fingerprintConfidence: number | null;
  discoveryStrategy: RecommendedStrategy | string | null;
  recipeGenerated: boolean;
  recipeValidated: boolean;
  discoveryMode: string | null;
  coverageScore: number | null;
  healthScore: number | null;
  discoveryDurationMs: number | null;
  discoveryCostUsd: number | null;
  finalStatus: FinalStatus;
  error: string | null;
  stagesCompleted: StageCheckpoint[];
  validationReport: Record<string, unknown> | null;
  artifactPaths: {
    knowledgeDocsDir: string | null;
    harUrl: string | null;
    validationReportPath: string | null;
  };
  failureAnalysis: {
    failurePoint: string | null;
    rootCause: string | null;
    discoveryStage: string | null;
    repairAttempted: boolean;
    repairSucceeded: boolean;
    recommendedImprovement: string | null;
  } | null;
  startedAt: string;
  completedAt: string | null;
}

interface BenchmarkState {
  meta: {
    date: string;
    gitCommit: string;
    branch: string;
    discoverySystemVersion: string;
    startedAt: string;
    completedAt: string | null;
    executionMode?: 'local-poll' | 'remote-enqueue';
  };
  results: RetailerBenchmarkResult[];
}

interface BenchmarkJobManifest {
  date: string;
  tag: string;
  startedAt: string;
  jobs: Array<{
    url: string;
    domain: string;
    expectedPlatform?: string;
    mode: 'onboard' | 'rediscover';
    onboardingId: string | null;
    retailerKey: string | null;
    enqueuedAt: string;
  }>;
}

function git(cmd: string): string {
  try {
    return execSync(cmd, { cwd: resolve(import.meta.dirname, '../../../..'), encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function docsDirForKey(key: string): string {
  return resolve(import.meta.dirname, '../../../../docs/discovery/retailers', key);
}

function classifyStatus(r: Omit<RetailerBenchmarkResult, 'finalStatus'> & { finalStatus?: FinalStatus }): FinalStatus {
  const validated =
    r.recipeValidated ||
    (r.validationReport != null &&
      typeof (r.validationReport as { confidence?: number }).confidence === 'number' &&
      (r.validationReport as { confidence: number }).confidence >= 0.7);

  if (r.error && !r.recipeGenerated) return 'Failed';

  if (r.recipeGenerated && validated && (r.coverageScore == null || r.coverageScore >= 50)) {
    return 'Success';
  }

  if (r.recipeGenerated || (r.fingerprintConfidence != null && r.fingerprintConfidence >= 0.5)) {
    return 'Partial Success';
  }

  return 'Failed';
}

function inferFailureAnalysis(r: RetailerBenchmarkResult): RetailerBenchmarkResult['failureAnalysis'] {
  if (r.finalStatus === 'Success') return null;

  const stages = r.stagesCompleted.map((s) => s.stage);
  const lastStage = stages[stages.length - 1] ?? 'unknown';
  const err = r.error ?? '';

  let rootCause = err || 'Discovery did not produce a promotable recipe';
  let failurePoint = lastStage;
  let recommendedImprovement = 'Review discovery logs and retry with network capture';

  if (err.includes('Incapsula') || err.includes('bot') || err.includes('blocked')) {
    rootCause = 'Bot protection blocks automated browser/network capture';
    failurePoint = 'fingerprint/static';
    recommendedImprovement = 'Add bot-protection bypass strategy or manual HAR seed for platform pack';
  } else if (err.includes('no products') || err.includes('Could not confirm')) {
    rootCause = 'No product URL pattern or samples confirmed';
    failurePoint = stages.includes('validate') ? 'validate' : 'static';
    recommendedImprovement = 'Improve Jina category navigation or sitemap discovery fallback';
  } else if (!r.recipeGenerated && stages.includes('network')) {
    rootCause = 'Network capture did not yield inferrable catalog API';
    failurePoint = 'network';
    recommendedImprovement = 'Expand endpoint pattern library or improve API recipe inference';
  } else if (r.recipeGenerated && !r.recipeValidated) {
    rootCause = 'Recipe generated but failed validation thresholds (confidence/catalog/reliability)';
    failurePoint = 'validate';
    recommendedImprovement = 'Tune validation thresholds or improve field-map inference for this platform';
  } else if (r.finalStatus === 'Partial Success' && r.mode === 'rediscover') {
    rootCause = 'Rediscovery completed but candidate was not stronger than existing recipe';
    failurePoint = 'promote';
    recommendedImprovement = 'Force full network sniff (preserveEndpoints=false) and clear stale endpoints before benchmark';
  }

  return {
    failurePoint,
    rootCause,
    discoveryStage: lastStage,
    repairAttempted: false,
    repairSucceeded: false,
    recommendedImprovement,
  };
}

async function collectResult(
  input: { url: string; expectedPlatform?: string },
  ctx: {
    mode: 'onboard' | 'rediscover';
    onboardingId: string | null;
    retailerKey: string | null;
    startedAt: Date;
    benchmarkStartedAt: Date;
  },
): Promise<RetailerBenchmarkResult> {
  const domain = normalizeRetailerDomain(input.url);
  let onboardingId = ctx.onboardingId;
  let retailerKey = ctx.retailerKey;
  let error: string | null = null;
  let discoveryRunId: string | null = null;

  // Resolve onboarding / retailer after job completes
  if (ctx.mode === 'onboard' && onboardingId) {
    const [ob] = await db
      .select()
      .from(schema.storeOnboarding)
      .where(eq(schema.storeOnboarding.id, onboardingId));
    if (ob?.status === 'failed') error = ob.error;
    if (ob?.retailerId) {
      const [ret] = await db
        .select({ key: schema.retailers.key })
        .from(schema.retailers)
        .where(eq(schema.retailers.id, ob.retailerId));
      retailerKey = ret?.key ?? retailerKey;
    }
  }

  if (!retailerKey) {
    const [ret] = await db
      .select({ key: schema.retailers.key, id: schema.retailers.id })
      .from(schema.retailers)
      .where(eq(schema.retailers.domain, domain));
    retailerKey = ret?.key ?? null;
  }

  let discoveryRunQueryRetailerId: string | null = null;
  if (!onboardingId) {
    const [retByDomain] = await db
      .select({ id: schema.retailers.id })
      .from(schema.retailers)
      .where(eq(schema.retailers.domain, domain));
    discoveryRunQueryRetailerId = retByDomain?.id ?? null;
  }

  const [run] = onboardingId
    ? await db
        .select()
        .from(schema.discoveryRuns)
        .where(eq(schema.discoveryRuns.onboardingId, onboardingId))
        .orderBy(desc(schema.discoveryRuns.startedAt))
        .limit(1)
    : discoveryRunQueryRetailerId
      ? await db
          .select()
          .from(schema.discoveryRuns)
          .where(
            and(
              eq(schema.discoveryRuns.retailerId, discoveryRunQueryRetailerId),
              gte(schema.discoveryRuns.startedAt, ctx.benchmarkStartedAt),
            ),
          )
          .orderBy(desc(schema.discoveryRuns.startedAt))
          .limit(1)
      : [undefined];

  // Fallback: latest run for retailer since benchmark start
  let discoveryRun = run;
  if (!discoveryRun && retailerKey) {
    const [ret] = await db
      .select({ id: schema.retailers.id })
      .from(schema.retailers)
      .where(eq(schema.retailers.key, retailerKey));
    if (ret) {
      const [latest] = await db
        .select()
        .from(schema.discoveryRuns)
        .where(
          and(eq(schema.discoveryRuns.retailerId, ret.id), gte(schema.discoveryRuns.startedAt, ctx.benchmarkStartedAt)),
        )
        .orderBy(desc(schema.discoveryRuns.startedAt))
        .limit(1);
      discoveryRun = latest;
    }
  }

  discoveryRunId = discoveryRun?.id ?? null;
  if (!error && discoveryRun?.error) error = discoveryRun.error;

  const fingerprint = (discoveryRun?.fingerprint ?? null) as RetailerFingerprint | null;

  let retailerRow: {
    key: string;
    name: string | null;
    crawlRecipe: unknown;
    fingerprint: unknown;
    discoveryConfidence: number | null;
    crawlHealthScore: number | null;
  } | null = null;

  if (retailerKey) {
    const [ret] = await db
      .select({
        key: schema.retailers.key,
        name: schema.retailers.name,
        crawlRecipe: schema.retailers.crawlRecipe,
        fingerprint: schema.retailers.fingerprint,
        discoveryConfidence: schema.retailers.discoveryConfidence,
        crawlHealthScore: schema.retailers.crawlHealthScore,
      })
      .from(schema.retailers)
      .where(eq(schema.retailers.key, retailerKey));
    retailerRow = ret ?? null;
  }

  const fp = fingerprint ?? (retailerRow?.fingerprint as RetailerFingerprint | null);
  const crawlRecipe = retailerRow?.crawlRecipe as { discoveryMode?: string; api?: unknown; jina?: unknown } | null;

  let validationReport: Record<string, unknown> | null = null;
  if (retailerKey) {
    const [ver] = await db
      .select({ validationReport: schema.retailerRecipeVersions.validationReport })
      .from(schema.retailerRecipeVersions)
      .innerJoin(schema.retailers, eq(schema.retailerRecipeVersions.retailerId, schema.retailers.id))
      .where(eq(schema.retailers.key, retailerKey))
      .orderBy(desc(schema.retailerRecipeVersions.version))
      .limit(1);
    validationReport = (ver?.validationReport as Record<string, unknown>) ?? null;
  }

  const stagesCompleted = (discoveryRun?.stagesCompleted ?? []) as StageCheckpoint[];
  const harCheckpoint = stagesCompleted.find((s) => s.stage === 'network' && s.artifactUrl);
  const recipeGenerated =
    crawlRecipe != null &&
    (crawlRecipe.discoveryMode === 'api'
      ? crawlRecipe.api != null
      : crawlRecipe.discoveryMode === 'jina_categories'
        ? crawlRecipe.jina != null
        : !!crawlRecipe.discoveryMode);

  const valConf =
    validationReport && typeof validationReport.confidence === 'number'
      ? validationReport.confidence
      : null;
  const recipeValidated = valConf != null && valConf >= 0.7;

  const coverageScore =
    validationReport && typeof validationReport.estimatedCatalogSize === 'number'
      ? validationReport.estimatedCatalogSize
      : null;

  const durationMs =
    discoveryRun?.startedAt && discoveryRun.completedAt
      ? discoveryRun.completedAt.getTime() - discoveryRun.startedAt.getTime()
      : null;

  const knowledgeDocsDir = retailerKey ? docsDirForKey(retailerKey) : null;
  const validationReportPath =
    knowledgeDocsDir != null ? join(knowledgeDocsDir, 'validation-report.md') : null;

  const partial: Omit<RetailerBenchmarkResult, 'finalStatus' | 'failureAnalysis'> = {
    name: retailerRow?.name ?? new URL(input.url).hostname.replace(/^www\./, ''),
    url: input.url,
    expectedPlatform: input.expectedPlatform,
    domain,
    retailerKey,
    mode: ctx.mode,
    onboardingId,
    discoveryRunId,
    platformDetected: fp?.platform ?? null,
    fingerprintConfidence: fp?.platformConfidence ?? null,
    discoveryStrategy: fp?.recommendedStrategy ?? null,
    recipeGenerated: !!recipeGenerated,
    recipeValidated,
    discoveryMode: crawlRecipe?.discoveryMode ?? null,
    coverageScore,
    healthScore: retailerRow?.crawlHealthScore ?? null,
    discoveryDurationMs: durationMs,
    discoveryCostUsd: discoveryRun?.costUsd ?? null,
    error,
    stagesCompleted,
    validationReport,
    artifactPaths: {
      knowledgeDocsDir,
      harUrl: harCheckpoint?.artifactUrl ?? null,
      validationReportPath,
    },
    startedAt: ctx.startedAt.toISOString(),
    completedAt: discoveryRun?.completedAt?.toISOString() ?? new Date().toISOString(),
  };

  const finalStatus = classifyStatus(partial);
  const result: RetailerBenchmarkResult = { ...partial, finalStatus, failureAnalysis: null };
  result.failureAnalysis = inferFailureAnalysis(result);
  return result;
}

async function waitForOnboarding(onboardingId: string, startedAt: Date): Promise<'ready' | 'failed' | 'timeout'> {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    const [row] = await db
      .select({ status: schema.storeOnboarding.status })
      .from(schema.storeOnboarding)
      .where(eq(schema.storeOnboarding.id, onboardingId));
    if (row?.status === 'ready') return 'ready';
    if (row?.status === 'failed') return 'failed';
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  return 'timeout';
}

async function waitForDiscoveryRun(
  retailerId: string,
  benchmarkStartedAt: Date,
): Promise<'completed' | 'failed' | 'timeout'> {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    const [run] = await db
      .select({ status: schema.discoveryRuns.status })
      .from(schema.discoveryRuns)
      .where(
        and(eq(schema.discoveryRuns.retailerId, retailerId), gte(schema.discoveryRuns.startedAt, benchmarkStartedAt)),
      )
      .orderBy(desc(schema.discoveryRuns.startedAt))
      .limit(1);
    if (run?.status === 'completed') return 'completed';
    if (run?.status === 'failed') return 'failed';
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  return 'timeout';
}

async function enqueueOne(
  entry: (typeof BENCHMARK_RETAILERS)[number],
  orgId: string,
): Promise<BenchmarkJobManifest['jobs'][number]> {
  const domain = normalizeRetailerDomain(entry.url);
  const [existing] = await db
    .select({ id: schema.retailers.id, key: schema.retailers.key })
    .from(schema.retailers)
    .where(eq(schema.retailers.domain, domain));

  if (existing) {
    await queues.discoverConfig().add(
      'rediscover',
      {
        rediscover: {
          retailerKey: existing.key,
          reason: BENCHMARK_TAG,
          preserveEndpoints: false,
        },
      },
      { jobId: `${BENCHMARK_TAG}-rediscover-${existing.key}-${Date.now()}` },
    );
    console.log(`  → enqueued rediscover key=${existing.key}`);
    return {
      url: entry.url,
      domain,
      expectedPlatform: entry.expectedPlatform,
      mode: 'rediscover',
      onboardingId: null,
      retailerKey: existing.key,
      enqueuedAt: new Date().toISOString(),
    };
  }

  const [onboarding] = await db
    .insert(schema.storeOnboarding)
    .values({ orgId, inputUrl: entry.url, status: 'queued' })
    .returning({ id: schema.storeOnboarding.id });
  if (!onboarding) throw new Error(`failed to create onboarding for ${entry.url}`);

  await queues.discoverConfig().add(
    'discover-config',
    { onboardingId: onboarding.id },
    { jobId: `${BENCHMARK_TAG}-onboard-${domain}-${Date.now()}` },
  );
  console.log(`  → enqueued onboard id=${onboarding.id}`);
  return {
    url: entry.url,
    domain,
    expectedPlatform: entry.expectedPlatform,
    mode: 'onboard',
    onboardingId: onboarding.id,
    retailerKey: null,
    enqueuedAt: new Date().toISOString(),
  };
}

async function runOne(
  entry: (typeof BENCHMARK_RETAILERS)[number],
  orgId: string,
  benchmarkStartedAt: Date,
): Promise<RetailerBenchmarkResult> {
  const domain = normalizeRetailerDomain(entry.url);
  const startedAt = new Date();
  console.log(`\n▶ Starting: ${entry.url} (${domain})`);

  const [existing] = await db
    .select({ id: schema.retailers.id, key: schema.retailers.key, enabled: schema.retailers.enabled })
    .from(schema.retailers)
    .where(eq(schema.retailers.domain, domain));

  if (existing) {
    console.log(`  → rediscover (preserveEndpoints=false) key=${existing.key}`);
    await queues.discoverConfig().add(
      'rediscover',
      {
        rediscover: {
          retailerKey: existing.key,
          reason: BENCHMARK_TAG,
          preserveEndpoints: false,
        },
      },
      { jobId: `${BENCHMARK_TAG}-rediscover-${existing.key}-${Date.now()}` },
    );
    const outcome = await waitForDiscoveryRun(existing.id, benchmarkStartedAt);
    console.log(`  → rediscover outcome: ${outcome}`);
    return collectResult(entry, {
      mode: 'rediscover',
      onboardingId: null,
      retailerKey: existing.key,
      startedAt,
      benchmarkStartedAt,
    });
  }

  const [onboarding] = await db
    .insert(schema.storeOnboarding)
    .values({
      orgId,
      inputUrl: entry.url,
      status: 'queued',
    })
    .returning({ id: schema.storeOnboarding.id });

  if (!onboarding) throw new Error(`failed to create onboarding for ${entry.url}`);

  await queues.discoverConfig().add(
    'discover-config',
    { onboardingId: onboarding.id },
    { jobId: `${BENCHMARK_TAG}-onboard-${domain}-${Date.now()}` },
  );
  console.log(`  → onboard onboardingId=${onboarding.id}`);

  const outcome = await waitForOnboarding(onboarding.id, startedAt);
  console.log(`  → onboard outcome: ${outcome}`);

  return collectResult(entry, {
    mode: 'onboard',
    onboardingId: onboarding.id,
    retailerKey: null,
    startedAt,
    benchmarkStartedAt,
  });
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const enqueueOnly = process.argv.includes('--enqueue-only');
  const collectOnly = process.argv.includes('--collect-only');
  const retryFailed = process.argv.includes('--retry-failed');
  const resumeIdx = process.argv.indexOf('--resume');
  const resumeFile = resumeIdx >= 0 ? process.argv[resumeIdx + 1] : null;

  const outDir = resolve(import.meta.dirname, '../../../../docs/discovery/benchmarks');
  await mkdir(outDir, { recursive: true });
  const jsonPath = join(outDir, `benchmark-${BENCHMARK_DATE}.json`);
  const mdPath = join(outDir, `benchmark-${BENCHMARK_DATE}.md`);
  const manifestPath = join(outDir, `benchmark-${BENCHMARK_DATE}.manifest.json`);

  const resumePath = resumeIdx >= 0 ? process.argv[resumeIdx + 1] : null;
  const resolvedResume = resumePath
    ? resumePath.startsWith('/')
      ? resumePath
      : resolve(process.cwd(), resumePath)
    : null;

  const state: BenchmarkState = resolvedResume
    ? (JSON.parse(await readFile(resolvedResume, 'utf8')) as BenchmarkState)
    : {
        meta: {
          date: BENCHMARK_DATE,
          gitCommit: git('git rev-parse HEAD'),
          branch: git('git branch --show-current'),
          discoverySystemVersion: 'phase-5-generalized-discovery',
          startedAt: new Date().toISOString(),
          completedAt: null,
        },
        results: [],
      };

  const completedDomains = new Set(
    retryFailed
      ? state.results.filter((r) => r.finalStatus === 'Success').map((r) => r.domain)
      : state.results.map((r) => r.domain),
  );
  const pending = BENCHMARK_RETAILERS.filter(
    (r) => !completedDomains.has(normalizeRetailerDomain(r.url)),
  );

  if (retryFailed) {
    state.results = state.results.filter((r) => r.finalStatus === 'Success');
  }

  console.log(`Benchmark ${BENCHMARK_DATE}: ${pending.length} retailers pending (${state.results.length} done)`);

  if (dryRun) {
    for (const r of BENCHMARK_RETAILERS) {
      const domain = normalizeRetailerDomain(r.url);
      const [existing] = await db
        .select({ key: schema.retailers.key })
        .from(schema.retailers)
        .where(eq(schema.retailers.domain, domain));
      console.log(`${domain}: ${existing ? `rediscover (${existing.key})` : 'onboard'}`);
    }
    return;
  }

  const [org] = await db.select().from(schema.orgs).limit(1);
  if (!org) throw new Error('no org in database — run pnpm db:seed');

  const benchmarkStartedAt = new Date(state.meta.startedAt);

  if (enqueueOnly) {
    state.meta.executionMode = 'remote-enqueue';
    const manifest: BenchmarkJobManifest = {
      date: BENCHMARK_DATE,
      tag: BENCHMARK_TAG,
      startedAt: benchmarkStartedAt.toISOString(),
      jobs: [],
    };
    console.log(`Enqueue-only: ${pending.length} retailers → production Redis (Fly discovery worker)`);
    for (const entry of pending) {
      console.log(`\n▶ Enqueue: ${entry.url}`);
      manifest.jobs.push(await enqueueOne(entry, org.id));
    }
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(`\nManifest: ${manifestPath}`);
    console.log('Discovery runs on Fly.io. Collect later with --collect-only');
    return;
  }

  if (collectOnly) {
    let manifest: BenchmarkJobManifest;
    try {
      manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as BenchmarkJobManifest;
    } catch {
      throw new Error(`missing manifest ${manifestPath} — run --enqueue-only first`);
    }
    const collectedStartedAt = new Date(manifest.startedAt);
    state.meta.executionMode = 'remote-enqueue';
    for (const job of manifest.jobs) {
      if (state.results.some((r) => r.domain === job.domain && r.finalStatus === 'Success')) continue;
      const result = await collectResult(
        { url: job.url, expectedPlatform: job.expectedPlatform },
        {
          mode: job.mode,
          onboardingId: job.onboardingId,
          retailerKey: job.retailerKey,
          startedAt: new Date(job.enqueuedAt),
          benchmarkStartedAt: collectedStartedAt,
        },
      );
      const idx = state.results.findIndex((r) => r.domain === job.domain);
      if (idx >= 0) state.results[idx] = result;
      else state.results.push(result);
      console.log(`  ${result.domain}: ${result.finalStatus}`);
    }
    state.meta.completedAt = new Date().toISOString();
    await writeFile(jsonPath, JSON.stringify(state, null, 2));
    await writeFile(mdPath, generateMarkdownReport(state));
    console.log(`Report: ${mdPath}`);
    return;
  }

  state.meta.executionMode = 'local-poll';

  for (const entry of pending) {
    try {
      const result = await runOne(entry, org.id, benchmarkStartedAt);
      state.results.push(result);
      console.log(
        `  ✓ ${result.name}: ${result.finalStatus} platform=${result.platformDetected} strategy=${result.discoveryStrategy} cost=$${result.discoveryCostUsd?.toFixed(4) ?? '0'}`,
      );
    } catch (err) {
      console.error(`  ✗ ${entry.url}: ${String(err)}`);
      state.results.push({
        name: new URL(entry.url).hostname,
        url: entry.url,
        expectedPlatform: entry.expectedPlatform,
        domain: normalizeRetailerDomain(entry.url),
        retailerKey: null,
        mode: 'onboard',
        onboardingId: null,
        discoveryRunId: null,
        platformDetected: null,
        fingerprintConfidence: null,
        discoveryStrategy: null,
        recipeGenerated: false,
        recipeValidated: false,
        discoveryMode: null,
        coverageScore: null,
        healthScore: null,
        discoveryDurationMs: null,
        discoveryCostUsd: null,
        finalStatus: 'Failed',
        error: String(err),
        stagesCompleted: [],
        validationReport: null,
        artifactPaths: { knowledgeDocsDir: null, harUrl: null, validationReportPath: null },
        failureAnalysis: {
          failurePoint: 'enqueue',
          rootCause: String(err),
          discoveryStage: 'pre-discovery',
          repairAttempted: false,
          repairSucceeded: false,
          recommendedImprovement: 'Ensure worker is running and Redis/DB are reachable',
        },
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      });
    }
    await writeFile(jsonPath, JSON.stringify(state, null, 2));
  }

  state.meta.completedAt = new Date().toISOString();
  await writeFile(jsonPath, JSON.stringify(state, null, 2));

  const report = generateMarkdownReport(state);
  await writeFile(mdPath, report);
  console.log(`\nBenchmark complete. Report: ${mdPath}`);
}

function generateMarkdownReport(state: BenchmarkState): string {
  const results = state.results;
  const success = results.filter((r) => r.finalStatus === 'Success').length;
  const partial = results.filter((r) => r.finalStatus === 'Partial Success').length;
  const failed = results.filter((r) => r.finalStatus === 'Failed').length;
  const total = results.length;
  const successRate = total > 0 ? ((success / total) * 100).toFixed(1) : '0';

  const avg = (vals: (number | null)[]) => {
    const nums = vals.filter((v): v is number => v != null);
    return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
  };

  const avgDuration = avg(results.map((r) => r.discoveryDurationMs));
  const avgCost = avg(results.map((r) => r.discoveryCostUsd));
  const avgCoverage = avg(results.map((r) => r.coverageScore));
  const avgHealth = avg(results.map((r) => r.healthScore));

  const platformGroups = new Map<string, RetailerBenchmarkResult[]>();
  for (const r of results) {
    const p = r.platformDetected ?? 'unknown';
    if (!platformGroups.has(p)) platformGroups.set(p, []);
    platformGroups.get(p)!.push(r);
  }

  const failureGroups = new Map<string, { count: number; retailers: string[] }>();
  for (const r of results.filter((x) => x.finalStatus !== 'Success')) {
    const cause = r.failureAnalysis?.rootCause ?? r.error ?? 'unknown';
    const key = cause.slice(0, 120);
    if (!failureGroups.has(key)) failureGroups.set(key, { count: 0, retailers: [] });
    const g = failureGroups.get(key)!;
    g.count++;
    g.retailers.push(r.name);
  }

  const sortedFailures = [...failureGroups.entries()].sort((a, b) => b[1].count - a[1].count);

  let md = `# Discovery Benchmark Report — ${state.meta.date}

# Executive Summary

| Field | Value |
|-------|-------|
| Date | ${state.meta.date} |
| Git commit | \`${state.meta.gitCommit}\` |
| Branch | \`${state.meta.branch}\` |
| Discovery system version | ${state.meta.discoverySystemVersion} |
| Total retailers tested | ${total} |
| Success | ${success} |
| Partial success | ${partial} |
| Failed | ${failed} |
| Overall success rate | ${successRate}% |

Benchmark started: ${state.meta.startedAt}
Benchmark completed: ${state.meta.completedAt ?? 'in progress'}

---

# Retailer Results

`;

  for (const r of results) {
    md += `## ${r.name}

| Metric | Value |
|--------|-------|
| URL | ${r.url} |
| Expected platform | ${r.expectedPlatform ?? '—'} |
| Platform detected | ${r.platformDetected ?? '—'} |
| Fingerprint confidence | ${r.fingerprintConfidence?.toFixed(2) ?? '—'} |
| Discovery strategy | ${r.discoveryStrategy ?? '—'} |
| Discovery mode | ${r.discoveryMode ?? '—'} |
| Discovery duration | ${r.discoveryDurationMs != null ? `${(r.discoveryDurationMs / 1000).toFixed(0)}s` : '—'} |
| Discovery cost | ${r.discoveryCostUsd != null ? `$${r.discoveryCostUsd.toFixed(4)}` : '—'} |
| Recipe generated | ${r.recipeGenerated ? 'Yes' : 'No'} |
| Recipe validated | ${r.recipeValidated ? 'Yes' : 'No'} |
| Coverage score | ${r.coverageScore ?? '—'} |
| Health score | ${r.healthScore?.toFixed(2) ?? '—'} |
| Final status | **${r.finalStatus}** |
| Mode | ${r.mode} |
| Retailer key | ${r.retailerKey ?? '—'} |

### Discovery Timeline

| Stage | Status | Completed |
|-------|--------|-----------|
`;
    for (const s of r.stagesCompleted) {
      md += `| ${s.stage} | ${s.status} | ${s.completedAt ?? '—'} |\n`;
    }
    if (r.stagesCompleted.length === 0) md += `| — | — | No checkpoints recorded |\n`;

    md += `
### Artifacts

- Knowledge docs: ${r.artifactPaths.knowledgeDocsDir ?? '—'}
- HAR: ${r.artifactPaths.harUrl ?? '—'}
- Validation report: ${r.artifactPaths.validationReportPath ?? '—'}
- Discovery run ID: \`${r.discoveryRunId ?? '—'}\`

`;
    if (r.finalStatus !== 'Success' && r.failureAnalysis) {
      md += `### Failure Analysis

- **Root cause:** ${r.failureAnalysis.rootCause}
- **Failure stage:** ${r.failureAnalysis.discoveryStage}
- **Failure point:** ${r.failureAnalysis.failurePoint}
- **Repair attempted:** ${r.failureAnalysis.repairAttempted ? 'Yes' : 'No'}
- **Repair succeeded:** ${r.failureAnalysis.repairSucceeded ? 'Yes' : 'No'}
- **Recommended fix:** ${r.failureAnalysis.recommendedImprovement}

`;
    }
    if (r.error) md += `**Error:** ${r.error}\n\n`;
    md += `---\n\n`;
  }

  md += `# Aggregate Metrics

| Metric | Value |
|--------|-------|
| Average discovery duration | ${avgDuration != null ? `${(avgDuration / 1000).toFixed(0)}s` : '—'} |
| Average discovery cost | ${avgCost != null ? `$${avgCost.toFixed(4)}` : '—'} |
| Average coverage score | ${avgCoverage != null ? Math.round(avgCoverage) : '—'} |
| Average health score | ${avgHealth != null ? avgHealth.toFixed(2) : '—'} |

## Success Rate by Platform

| Platform | Tested | Success | Partial | Failed | Success rate |
|----------|--------|---------|---------|--------|--------------|
`;
  for (const [platform, group] of platformGroups) {
    const s = group.filter((r) => r.finalStatus === 'Success').length;
    const p = group.filter((r) => r.finalStatus === 'Partial Success').length;
    const f = group.filter((r) => r.finalStatus === 'Failed').length;
    md += `| ${platform} | ${group.length} | ${s} | ${p} | ${f} | ${((s / group.length) * 100).toFixed(0)}% |\n`;
  }

  md += `
## Success Rate by Discovery Strategy

| Strategy | Tested | Success | Partial | Failed |
|----------|--------|---------|---------|--------|
`;
  const stratGroups = new Map<string, RetailerBenchmarkResult[]>();
  for (const r of results) {
    const s = r.discoveryStrategy ?? 'unknown';
    if (!stratGroups.has(s)) stratGroups.set(s, []);
    stratGroups.get(s)!.push(r);
  }
  for (const [strat, group] of stratGroups) {
    const s = group.filter((r) => r.finalStatus === 'Success').length;
    const p = group.filter((r) => r.finalStatus === 'Partial Success').length;
    const f = group.filter((r) => r.finalStatus === 'Failed').length;
    md += `| ${strat} | ${group.length} | ${s} | ${p} | ${f} |\n`;
  }

  md += `
# Failure Analysis

Failures grouped by root cause (ranked by frequency):

`;
  for (const [cause, info] of sortedFailures) {
    md += `## ${info.count}× — ${cause}

Affected: ${info.retailers.join(', ')}

`;
  }

  md += `# GitHub Issues Created

_Issues created during benchmark post-processing — see benchmark issue script output._

# Recommendations

## Immediate Improvements

_Highest ROI changes based on benchmark results — populated after issue triage._

## Medium-Term Improvements

_Changes that would meaningfully increase onboarding success._

## Long-Term Improvements

_Architectural improvements worth considering later._

# Final Assessment

- **Production ready?** ${successRate}% full success rate across ${total} diverse retailers (${partial} partial).
- **Handled well:** Platforms/strategies with highest success rates above.
- **Problematic:** Bot-protected custom storefronts, retailers where network sniff fails to infer APIs.
- **Estimated arbitrary retailer success rate today:** ~${successRate}% full success, ~${(((success + partial) / Math.max(total, 1)) * 100).toFixed(0)}% partial-or-better.

# Retailer-Specific Code Removal Plan

The following retailer-specific adapters/scripts should be evaluated for removal once generalized discovery exceeds their reliability:

- \`apps/worker/src/retailers.ts\` hand-configured retailer entries — migrate to discovery-only onboarding
- Any per-retailer API adapters under \`packages/crawler/src/adapters/\` not used by \`createRecipeAdapter\`
- Probe scripts with hardcoded retailer URLs (\`batch-probe-discovery.ts\` DEFAULT_SITES)

---

_Generated by \`run-discovery-benchmark.ts\` on ${state.meta.date}._
`;

  return md;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
