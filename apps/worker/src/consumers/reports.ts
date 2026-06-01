import { createClerkClient } from '@clerk/backend';
import { Worker, type Job, queues, redisConnection } from '@retailer/jobs';
import { createLogger } from '@retailer/core';
import { db, schema, eq } from '@retailer/db';
import { sendWeeklyReport } from '@retailer/reports';
import { QueueName, type ReportJob } from '@retailer/schema';

const log = createLogger('worker:reports');

const FANOUT_SENTINEL = '00000000-0000-0000-0000-000000000000';

/**
 * Reports worker. A weekly fan-out job (sentinel orgId) enumerates orgs and
 * enqueues a per-org report job; per-org jobs resolve member emails from Clerk
 * and send the digest.
 */
export function startReportsWorker(): Worker<ReportJob> {
  const clerk = process.env.CLERK_SECRET_KEY
    ? createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY })
    : null;

  return new Worker<ReportJob>(
    QueueName.Reports,
    async (job: Job<ReportJob>) => {
      const { orgId, periodStart, periodEnd } = job.data;

      if (orgId === FANOUT_SENTINEL) {
        const orgs = await db.select({ id: schema.orgs.id }).from(schema.orgs);
        for (const o of orgs) {
          await queues.reports().add('weekly', { orgId: o.id, periodStart, periodEnd });
        }
        log.info('fanned out weekly reports', { orgs: orgs.length });
        return;
      }

      const [org] = await db.select().from(schema.orgs).where(eq(schema.orgs.id, orgId));
      if (!org) return;

      let emails: string[] = [];
      if (clerk) {
        const members = await clerk.organizations.getOrganizationMembershipList({
          organizationId: org.clerkOrgId,
        });
        emails = members.data
          .map((m) => m.publicUserData?.identifier)
          .filter((e): e is string => Boolean(e && e.includes('@')));
      }

      const result = await sendWeeklyReport(orgId, emails, new Date(periodStart), new Date(periodEnd));
      log.info('report job done', { orgId, ...result });
    },
    { connection: redisConnection(), concurrency: 2 },
  );
}
