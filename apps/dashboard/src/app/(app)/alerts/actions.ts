'use server';

import { revalidatePath } from 'next/cache';
import { db, schema, eq, and, isNull, sql } from '@retailer/db';
import type { SignalSeverity, SignalType } from '@retailer/schema';
import { getTenant } from '@/lib/tenant';

export async function createAlertRule(input: {
  signalTypes: SignalType[];
  minSeverity: SignalSeverity;
  emailEnabled: boolean;
}): Promise<{ error?: string }> {
  const tenant = await getTenant();
  if (!tenant) return { error: 'No organization selected' };
  await db.insert(schema.alertRules).values({
    orgId: tenant.org.id,
    signalTypes: input.signalTypes,
    minSeverity: input.minSeverity,
    channels: input.emailEnabled ? ['in_app', 'email'] : ['in_app'],
  });
  revalidatePath('/alerts');
  return {};
}

export async function toggleAlertRule(ruleId: string, enabled: boolean): Promise<void> {
  const tenant = await getTenant();
  if (!tenant) return;
  await db
    .update(schema.alertRules)
    .set({ enabled })
    .where(and(eq(schema.alertRules.id, ruleId), eq(schema.alertRules.orgId, tenant.org.id)));
  revalidatePath('/alerts');
}

export async function markAllRead(): Promise<void> {
  const tenant = await getTenant();
  if (!tenant) return;
  await db
    .update(schema.alertEvents)
    .set({ readAt: sql`now()` })
    .where(and(eq(schema.alertEvents.orgId, tenant.org.id), isNull(schema.alertEvents.readAt)));
  revalidatePath('/alerts');
}
