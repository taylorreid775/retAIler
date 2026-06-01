import { z } from 'zod';

/** Types of intelligence signals surfaced to B2B clients. */
export const SignalTypeSchema = z.enum([
  'price_drop',
  'price_increase',
  'new_product',
  'back_in_stock',
  'low_stock',
  'out_of_stock',
  'assortment_expansion',
  'seo_keyword_gap',
]);
export type SignalType = z.infer<typeof SignalTypeSchema>;

export const SignalSeveritySchema = z.enum(['info', 'notable', 'critical']);
export type SignalSeverity = z.infer<typeof SignalSeveritySchema>;

export const SignalSchema = z.object({
  id: z.string().uuid(),
  type: SignalTypeSchema,
  severity: SignalSeveritySchema,
  retailerId: z.string().uuid(),
  retailerProductId: z.string().uuid().nullable(),
  productId: z.string().uuid().nullable(),
  /** Human-readable headline, e.g. "Hockey Stick X dropped 10%". */
  title: z.string(),
  /** Structured payload for rendering (old/new price, deltas, etc). */
  data: z.record(z.string(), z.unknown()).default({}),
  occurredAt: z.date(),
  createdAt: z.date(),
});
export type Signal = z.infer<typeof SignalSchema>;

export const AlertRuleSchema = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  /** Which signal types this rule listens to. */
  signalTypes: z.array(SignalTypeSchema),
  /** Only fire for these competitor retailer ids (empty = all tracked). */
  retailerIds: z.array(z.string().uuid()).default([]),
  /** Minimum severity to fire. */
  minSeverity: SignalSeveritySchema.default('notable'),
  /** Delivery channels. */
  channels: z.array(z.enum(['in_app', 'email'])).default(['in_app']),
  enabled: z.boolean().default(true),
});
export type AlertRule = z.infer<typeof AlertRuleSchema>;
