/**
 * One-off: create store_onboarding row and enqueue discover-config.
 * usage: pnpm --filter @retailer/worker exec tsx src/scripts/test-onboard-store.ts <url>
 */
import '../load-env.js';
import { db, schema, eq } from '@retailer/db';
import { queues } from '@retailer/jobs';

const inputUrl = process.argv[2];
if (!inputUrl) {
  console.error('usage: test-onboard-store.ts <url>');
  process.exit(1);
}

const [org] = await db.select().from(schema.orgs).limit(1);
if (!org) {
  console.error('no org in database');
  process.exit(1);
}

const retailers = await db
  .select({ key: schema.retailers.key, domain: schema.retailers.domain })
  .from(schema.retailers);
console.log('existing retailers:', retailers.map((r) => `${r.key} (${r.domain})`).join(', '));

const [onboarding] = await db
  .insert(schema.storeOnboarding)
  .values({
    orgId: org.id,
    inputUrl,
    status: 'queued',
  })
  .returning({ id: schema.storeOnboarding.id });

if (!onboarding) {
  console.error('failed to create onboarding');
  process.exit(1);
}

const job = await queues.discoverConfig().add('discover-config', { onboardingId: onboarding.id });
console.log('created onboarding', onboarding.id, 'for', inputUrl);
console.log('enqueued job', job.id);

async function poll() {
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const [row] = await db
      .select()
      .from(schema.storeOnboarding)
      .where(eq(schema.storeOnboarding.id, onboarding.id));
    console.log(`[${i * 5}s] status=${row?.status}`, row?.error ?? '');
    if (row?.status === 'ready' || row?.status === 'failed') {
      if (row.result) console.log('result:', JSON.stringify(row.result, null, 2));
      if (row.status === 'ready') {
        const [retailer] = await db
          .select({
            key: schema.retailers.key,
            domain: schema.retailers.domain,
            crawlRecipe: schema.retailers.crawlRecipe,
            productUrlPattern: schema.retailers.productUrlPattern,
          })
          .from(schema.retailers)
          .where(eq(schema.retailers.domain, (row.result as { domain?: string })?.domain ?? ''));
        if (retailer) {
          console.log('promoted retailer:', retailer.key, retailer.domain);
          console.log(
            'discoveryMode:',
            (retailer.crawlRecipe as { discoveryMode?: string })?.discoveryMode,
          );
        }
      }
      process.exit(row.status === 'ready' ? 0 : 1);
    }
  }
  console.error('timed out waiting for onboarding');
  process.exit(1);
}

await poll();
