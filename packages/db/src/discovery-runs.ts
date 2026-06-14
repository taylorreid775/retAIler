import type {
  DiscoveryRunStatus,
  DiscoveryStage,
  RetailerFingerprint,
  StageCheckpoint,
} from '@retailer/schema';
import { eq } from 'drizzle-orm';

/** Rough USD cost for gpt-4o-mini-class discovery inference. */
function estimateDiscoveryCostUsd(totalTokens: number): number {
  if (totalTokens <= 0) return 0;
  return Number(((totalTokens / 1_000_000) * 0.15).toFixed(6));
}
import { db, type Database } from './client';
import * as schema from './schema';

type DbExecutor = Pick<Database, 'insert' | 'update' | 'select'>;

export interface CreateDiscoveryRunParams {
  onboardingId?: string;
  retailerId?: string;
}

export async function createDiscoveryRun(
  params: CreateDiscoveryRunParams,
  tx: DbExecutor = db,
): Promise<string> {
  const [row] = await tx
    .insert(schema.discoveryRuns)
    .values({
      onboardingId: params.onboardingId ?? null,
      retailerId: params.retailerId ?? null,
      status: 'running',
      currentStage: 'fingerprint',
      stagesCompleted: [],
    })
    .returning({ id: schema.discoveryRuns.id });
  if (!row) throw new Error('failed to create discovery run');
  return row.id;
}

export interface CheckpointDiscoveryStageParams {
  runId: string;
  stage: DiscoveryStage;
  status: StageCheckpoint['status'];
  artifactUrl?: string;
  tokenUsage?: number;
  fingerprint?: RetailerFingerprint | null;
}

export async function checkpointDiscoveryStage(
  params: CheckpointDiscoveryStageParams,
  tx: DbExecutor = db,
): Promise<void> {
  const [run] = await tx
    .select({
      stagesCompleted: schema.discoveryRuns.stagesCompleted,
      tokenUsage: schema.discoveryRuns.tokenUsage,
    })
    .from(schema.discoveryRuns)
    .where(eq(schema.discoveryRuns.id, params.runId));
  if (!run) return;

  const checkpoint: StageCheckpoint = {
    stage: params.stage,
    status: params.status,
    completedAt: new Date().toISOString(),
    ...(params.artifactUrl ? { artifactUrl: params.artifactUrl } : {}),
    ...(params.tokenUsage != null ? { tokenUsage: params.tokenUsage } : {}),
  };

  const stages = [...(run.stagesCompleted ?? []), checkpoint];
  const addedTokens = params.tokenUsage ?? 0;

  await tx
    .update(schema.discoveryRuns)
    .set({
      currentStage: params.stage,
      stagesCompleted: stages,
      tokenUsage: (run.tokenUsage ?? 0) + addedTokens,
      ...(params.fingerprint ? { fingerprint: params.fingerprint } : {}),
    })
    .where(eq(schema.discoveryRuns.id, params.runId));
}

export interface CompleteDiscoveryRunParams {
  runId: string;
  status: Extract<DiscoveryRunStatus, 'completed' | 'failed'>;
  error?: string;
  retailerId?: string;
  extraTokens?: number;
}

export async function completeDiscoveryRun(
  params: CompleteDiscoveryRunParams,
  tx: DbExecutor = db,
): Promise<void> {
  const [run] = await tx
    .select({ tokenUsage: schema.discoveryRuns.tokenUsage })
    .from(schema.discoveryRuns)
    .where(eq(schema.discoveryRuns.id, params.runId));
  if (!run) return;

  const tokenUsage = (run.tokenUsage ?? 0) + (params.extraTokens ?? 0);
  const costUsd = estimateDiscoveryCostUsd(tokenUsage);

  await tx
    .update(schema.discoveryRuns)
    .set({
      status: params.status,
      completedAt: new Date(),
      error: params.error ?? null,
      tokenUsage,
      costUsd,
      ...(params.retailerId ? { retailerId: params.retailerId } : {}),
    })
    .where(eq(schema.discoveryRuns.id, params.runId));
}

/** Tracks token usage and checkpoints for a single discovery job. */
export class DiscoveryRunTracker {
  private pendingTokens = 0;

  constructor(readonly runId: string) {}

  addTokens(usage: { totalTokens?: number; promptTokens?: number; completionTokens?: number }): void {
    const total =
      usage.totalTokens ?? (usage.promptTokens ?? 0) + (usage.completionTokens ?? 0);
    this.pendingTokens += total;
  }

  async checkpoint(params: Omit<CheckpointDiscoveryStageParams, 'runId' | 'tokenUsage'>): Promise<void> {
    const stageTokens = this.pendingTokens;
    this.pendingTokens = 0;
    await checkpointDiscoveryStage({
      runId: this.runId,
      ...params,
      tokenUsage: stageTokens > 0 ? stageTokens : undefined,
    });
  }

  async complete(params: Omit<CompleteDiscoveryRunParams, 'runId'>): Promise<void> {
    await completeDiscoveryRun({
      runId: this.runId,
      ...params,
      extraTokens: this.pendingTokens,
    });
    this.pendingTokens = 0;
  }

  async fail(error: string): Promise<void> {
    await this.complete({ status: 'failed', error });
  }
}
