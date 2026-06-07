import '../load-env.js';
import { queues } from '@retailer/jobs';

const onboardingId = process.argv[2];
if (!onboardingId) {
  console.error('usage: enqueue-discover-config <onboardingId>');
  process.exit(1);
}

const job = await queues.discoverConfig().add('discover-config', { onboardingId });
console.log('enqueued', job.id, onboardingId);
process.exit(0);
