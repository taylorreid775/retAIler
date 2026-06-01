import { auth } from '@clerk/nextjs/server';
import { db, schema, eq } from '@retailer/db';
import { PLAN_LIMITS, type Plan } from '@retailer/schema';

export interface TenantContext {
  org: typeof schema.orgs.$inferSelect;
  competitorRetailerIds: string[];
  limits: (typeof PLAN_LIMITS)[Plan];
}

/**
 * Resolve the current Clerk organization to our orgs row (creating it on first
 * sight), along with the competitor retailers the org tracks. Returns null when
 * the user has no active organization selected.
 */
export async function getTenant(): Promise<TenantContext | null> {
  const { orgId, orgSlug } = await auth();
  if (!orgId) return null;

  let [org] = await db.select().from(schema.orgs).where(eq(schema.orgs.clerkOrgId, orgId));
  if (!org) {
    [org] = await db
      .insert(schema.orgs)
      .values({ clerkOrgId: orgId, name: orgSlug ?? 'New organization', plan: 'trial' })
      .onConflictDoNothing({ target: schema.orgs.clerkOrgId })
      .returning();
    if (!org) {
      [org] = await db.select().from(schema.orgs).where(eq(schema.orgs.clerkOrgId, orgId));
    }
  }
  if (!org) return null;

  const competitors = await db
    .select({ retailerId: schema.orgCompetitors.retailerId })
    .from(schema.orgCompetitors)
    .where(eq(schema.orgCompetitors.orgId, org.id));

  return {
    org,
    competitorRetailerIds: competitors.map((c) => c.retailerId),
    limits: PLAN_LIMITS[org.plan],
  };
}
