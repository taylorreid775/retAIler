'use server';

import { revalidatePath } from 'next/cache';
import { db, schema, eq, and } from '@retailer/db';
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
