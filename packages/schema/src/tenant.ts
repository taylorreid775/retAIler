import { z } from 'zod';

export const PlanSchema = z.enum(['trial', 'starter', 'growth', 'scale']);
export type Plan = z.infer<typeof PlanSchema>;

/** Plan entitlements drive feature gating + metering. */
export const PLAN_LIMITS: Record<
  z.infer<typeof PlanSchema>,
  { maxCompetitors: number; maxSeats: number; weeklyReports: boolean }
> = {
  trial: { maxCompetitors: 1, maxSeats: 2, weeklyReports: false },
  starter: { maxCompetitors: 3, maxSeats: 3, weeklyReports: true },
  growth: { maxCompetitors: 10, maxSeats: 10, weeklyReports: true },
  scale: { maxCompetitors: 50, maxSeats: 50, weeklyReports: true },
};

export const OrgSchema = z.object({
  id: z.string().uuid(),
  /** Clerk organization id. */
  clerkOrgId: z.string(),
  name: z.string(),
  plan: PlanSchema.default('trial'),
  ownRetailerId: z.string().uuid().nullable(),
  stripeCustomerId: z.string().nullable(),
  stripeSubscriptionId: z.string().nullable(),
  createdAt: z.date(),
});
export type Org = z.infer<typeof OrgSchema>;

/** A competitor (retailer) that an org actively tracks. */
export const OrgCompetitorSchema = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  retailerId: z.string().uuid(),
  createdAt: z.date(),
});
export type OrgCompetitor = z.infer<typeof OrgCompetitorSchema>;
