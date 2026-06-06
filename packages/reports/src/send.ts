import { render } from '@react-email/render';
import { Resend } from 'resend';
import { db, schema, eq, sql } from '@retailer/db';
import { recentSignals } from '@retailer/analytics';
import { serverEnv, createLogger } from '@retailer/core';
import { PLAN_LIMITS } from '@retailer/schema';
import { WeeklyDigest } from './weekly-digest';

const log = createLogger('reports:send');

export interface BuildResult {
  html: string;
  subject: string;
  empty: boolean;
}

/** Build the weekly digest HTML for an org over a period. */
export async function buildWeeklyReport(
  orgId: string,
  periodStart: Date,
  periodEnd: Date,
): Promise<BuildResult | null> {
  const [org] = await db.select().from(schema.orgs).where(eq(schema.orgs.id, orgId));
  if (!org) return null;
  if (!PLAN_LIMITS[org.plan].weeklyReports) {
    log.info('plan has no weekly reports, skipping', { orgId, plan: org.plan });
    return null;
  }

  const competitors = await db
    .select({ retailerId: schema.orgCompetitors.retailerId })
    .from(schema.orgCompetitors)
    .where(eq(schema.orgCompetitors.orgId, orgId));
  const ids = competitors.map((c) => c.retailerId);

  const windowDays = Math.max(
    1,
    Math.round((periodEnd.getTime() - periodStart.getTime()) / 86_400_000),
  );
  const [drops, news, inv, highlights] = await Promise.all([
    recentSignals(ids, { types: ['price_drop'], limit: 1000 }),
    recentSignals(ids, { types: ['new_product'], limit: 1000 }),
    recentSignals(ids, { types: ['low_stock', 'out_of_stock'], limit: 1000 }),
    recentSignals(ids, { limit: 12 }),
  ]);

  const periodLabel = `${periodStart.toLocaleDateString('en-CA')} – ${periodEnd.toLocaleDateString('en-CA')}`;
  const html = await render(
    WeeklyDigest({
      orgName: org.name,
      periodLabel,
      stats: { priceDrops: drops.length, newProducts: news.length, inventory: inv.length },
      highlights,
    }),
  );

  return {
    html,
    subject: `RetAIler weekly: ${drops.length} price drops, ${news.length} new products (${windowDays}d)`,
    empty: drops.length + news.length + inv.length === 0,
  };
}

/**
 * Send the weekly report to all member emails of an org. Emails are passed in
 * (resolved from Clerk by the caller) to keep this package Clerk-agnostic.
 */
export async function sendWeeklyReport(
  orgId: string,
  recipientEmails: string[],
  periodStart: Date,
  periodEnd: Date,
): Promise<{ sent: boolean; reason?: string }> {
  const env = serverEnv();
  if (!env.RESEND_API_KEY) return { sent: false, reason: 'RESEND_API_KEY not configured' };
  if (recipientEmails.length === 0) return { sent: false, reason: 'no recipients' };

  const report = await buildWeeklyReport(orgId, periodStart, periodEnd);
  if (!report) return { sent: false, reason: 'no report (plan or org)' };

  const resend = new Resend(env.RESEND_API_KEY);
  await resend.emails.send({
    from: env.REPORTS_FROM_EMAIL,
    to: recipientEmails,
    subject: report.subject,
    html: report.html,
  });

  // Mark unsent alert events as delivered for this org.
  await db
    .update(schema.alertEvents)
    .set({ deliveredEmailAt: sql`now()` })
    .where(
      sql`${schema.alertEvents.orgId} = ${orgId} AND ${schema.alertEvents.deliveredEmailAt} IS NULL`,
    );

  log.info('weekly report sent', { orgId, recipients: recipientEmails.length });
  return { sent: true };
}
