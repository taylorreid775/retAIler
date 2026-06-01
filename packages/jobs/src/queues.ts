import { Queue } from 'bullmq';
import {
  QueueName,
  type AnalyticsJob,
  type DiscoverJob,
  type ExtractJob,
  type FetchJob,
  type MatchJob,
  type ReportJob,
} from '@retailer/schema';
import { redisConnection } from './connection.js';

type JobMap = {
  [QueueName.Discover]: DiscoverJob;
  [QueueName.Fetch]: FetchJob;
  [QueueName.Extract]: ExtractJob;
  [QueueName.Match]: MatchJob;
  [QueueName.Analytics]: AnalyticsJob;
  [QueueName.Reports]: ReportJob;
};

const defaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 5000 },
  removeOnComplete: { age: 86_400, count: 5000 },
  removeOnFail: { age: 604_800 },
};

const registry = new Map<string, Queue>();

export function getQueue<K extends keyof JobMap>(name: K): Queue<JobMap[K]> {
  const existing = registry.get(name);
  if (existing) return existing as Queue<JobMap[K]>;
  // BullMQ's conditional generics don't round-trip cleanly; cast through unknown.
  const queue = new Queue(name, {
    connection: redisConnection(),
    defaultJobOptions,
  }) as unknown as Queue<JobMap[K]>;
  registry.set(name, queue as unknown as Queue);
  return queue;
}

export const queues = {
  discover: () => getQueue(QueueName.Discover),
  fetch: () => getQueue(QueueName.Fetch),
  extract: () => getQueue(QueueName.Extract),
  match: () => getQueue(QueueName.Match),
  analytics: () => getQueue(QueueName.Analytics),
  reports: () => getQueue(QueueName.Reports),
};

export type { JobMap };
