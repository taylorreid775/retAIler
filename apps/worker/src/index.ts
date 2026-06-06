import './load-env.js';
import { createLogger } from '@retailer/core';
import { startDiscoverConfigWorker } from './consumers/discover-config.js';
import { startDiscoverWorker } from './consumers/discover.js';
import { startFetchWorker } from './consumers/fetch.js';
import { startExtractWorker } from './consumers/extract.js';
import { startMatchWorker } from './consumers/match.js';
import { startAnalyticsWorker } from './consumers/analytics.js';
import { startReportsWorker } from './consumers/reports.js';
import { registerSchedules } from './scheduler.js';
import { startHealthServer } from './health.js';
import { closeFetchers } from './fetchers.js';

const log = createLogger('worker');

async function main() {
  log.info('starting crawl workers');
  const healthServer = startHealthServer();
  const workers = [
    startDiscoverConfigWorker(),
    startDiscoverWorker(),
    startFetchWorker(),
    startExtractWorker(),
    startMatchWorker(),
    startAnalyticsWorker(),
    startReportsWorker(),
  ];

  if (process.env.REGISTER_SCHEDULES !== 'false') {
    await registerSchedules().catch((err) =>
      log.error('failed to register schedules', { err: String(err) }),
    );
  }

  const shutdown = async (signal: string) => {
    log.info('shutting down', { signal });
    healthServer?.close();
    await Promise.all(workers.map((w) => w.close()));
    await closeFetchers();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  log.info('workers ready', { count: workers.length });
}

main().catch((err) => {
  log.error('worker crashed', { err: String(err) });
  process.exit(1);
});
