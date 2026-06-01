import { createServer, type Server } from 'node:http';
import { createLogger } from '@retailer/core';
import { queues } from '@retailer/jobs';
import { crawlHealth, dataFreshness, reviewBacklog } from '@retailer/analytics';

const log = createLogger('worker:health');

/**
 * Minimal health/metrics HTTP server for the worker. Exposes:
 *  - GET /health  → liveness (always 200 if the process is up)
 *  - GET /metrics → queue depths, crawl health, data freshness, review backlog
 * Point an uptime monitor / scrape job at these.
 */
export function startHealthServer(port = Number(process.env.HEALTH_PORT ?? 8080)): Server {
  const server = createServer(async (req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
      return;
    }

    if (req.url === '/metrics') {
      try {
        const [queueDepths, health, freshness, backlog] = await Promise.all([
          queueDepthSnapshot(),
          crawlHealth(),
          dataFreshness(),
          reviewBacklog(),
        ]);
        const stale = freshness.filter((f) => (f.staleHours ?? Infinity) > 36);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            status: stale.length === 0 ? 'ok' : 'degraded',
            queueDepths,
            crawlHealth: health,
            dataFreshness: freshness,
            staleRetailers: stale.map((s) => s.retailerName),
            reviewBacklog: backlog.pending,
          }),
        );
      } catch (err) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ status: 'error', error: String(err) }));
      }
      return;
    }

    res.writeHead(404);
    res.end();
  });

  server.listen(port, () => log.info('health server listening', { port }));
  return server;
}

async function queueDepthSnapshot(): Promise<Record<string, number>> {
  const entries = await Promise.all(
    Object.entries(queues).map(async ([name, factory]) => {
      const counts = await factory().getJobCounts('waiting', 'active', 'delayed', 'failed');
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      return [name, total] as const;
    }),
  );
  return Object.fromEntries(entries);
}
