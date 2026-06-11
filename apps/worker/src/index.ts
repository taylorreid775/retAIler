import './load-env.js';
import { createLogger } from '@retailer/core';
import { Worker } from '@retailer/jobs';
import { startDiscoverConfigWorker } from './consumers/discover-config.js';
import { startDiscoverWorker } from './consumers/discover.js';
import { startCrawlHealthWorker } from './consumers/crawl-health.js';
import { startDiscoverRepairWorker } from './consumers/discover-repair.js';
import { startFetchWorker } from './consumers/fetch.js';
import { startExtractWorker } from './consumers/extract.js';
import { startMatchWorker } from './consumers/match.js';
import { startAnalyticsWorker } from './consumers/analytics.js';
import { startReportsWorker } from './consumers/reports.js';
import { registerSchedules } from './scheduler.js';
import { startHealthServer } from './health.js';
import { closeFetchers } from './fetchers.js';
import { closeBrowserPool } from './browser-pool.js';
import { parseWorkerGroups, shouldStartWorker } from './worker-groups.js';

const log = createLogger('worker');

async function main() {
  const groups = parseWorkerGroups(process.argv);
  log.info('starting workers', { groups: [...groups] });

  const healthServer = startHealthServer();
  const workers: Worker[] = [];

  if (shouldStartWorker(groups, 'discovery')) {
    workers.push(startDiscoverConfigWorker(), startDiscoverRepairWorker());
  }

  if (shouldStartWorker(groups, 'crawl')) {
    workers.push(
      startDiscoverWorker(),
      startFetchWorker(),
      startExtractWorker(),
      startMatchWorker(),
      startCrawlHealthWorker(),
      startAnalyticsWorker(),
      startReportsWorker(),
    );
  }

  if (
    shouldStartWorker(groups, 'crawl') &&
    process.env.REGISTER_SCHEDULES !== 'false'
  ) {
    await registerSchedules().catch((err) =>
      log.error('failed to register schedules', { err: String(err) }),
    );
  }

  const shutdown = async (signal: string) => {
    log.info('shutting down', { signal });
    healthServer?.close();
    await Promise.all(workers.map((w) => w.close()));
    await closeFetchers();
    await closeBrowserPool();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  log.info('workers ready', { count: workers.length, groups: [...groups] });
}

main().catch((err) => {
  log.error('worker crashed', { err: String(err) });
  process.exit(1);
});
