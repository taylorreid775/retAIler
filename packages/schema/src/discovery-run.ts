import { z } from 'zod';
import { RetailerFingerprintSchema } from './fingerprint';

export const DiscoveryRunStatusSchema = z.enum(['running', 'completed', 'failed', 'repair']);
export type DiscoveryRunStatus = z.infer<typeof DiscoveryRunStatusSchema>;

export const DiscoveryStageSchema = z.enum([
  'fingerprint',
  'static',
  'network',
  'validate',
  'generate',
  'promote',
]);
export type DiscoveryStage = z.infer<typeof DiscoveryStageSchema>;

export const StageCheckpointStatusSchema = z.enum(['running', 'completed', 'failed', 'skipped']);
export type StageCheckpointStatus = z.infer<typeof StageCheckpointStatusSchema>;

export const StageCheckpointSchema = z.object({
  stage: DiscoveryStageSchema,
  status: StageCheckpointStatusSchema,
  completedAt: z.string().optional(),
  artifactUrl: z.string().url().optional(),
  tokenUsage: z.number().int().nonnegative().optional(),
});
export type StageCheckpoint = z.infer<typeof StageCheckpointSchema>;

export const DiscoveryRunRecordSchema = z.object({
  id: z.string().uuid(),
  retailerId: z.string().uuid().nullable(),
  onboardingId: z.string().uuid().nullable(),
  status: DiscoveryRunStatusSchema,
  currentStage: DiscoveryStageSchema.nullable(),
  stagesCompleted: z.array(StageCheckpointSchema),
  fingerprint: RetailerFingerprintSchema.nullable(),
  startedAt: z.coerce.date(),
  completedAt: z.coerce.date().nullable(),
  error: z.string().nullable(),
  tokenUsage: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
});
export type DiscoveryRunRecord = z.infer<typeof DiscoveryRunRecordSchema>;
