import { Redis } from 'ioredis';
import { serverEnv } from '@retailer/core';

let shared: Redis | null = null;

/** Shared Redis connection for BullMQ (maxRetriesPerRequest must be null). */
export function redisConnection(): Redis {
  if (shared) return shared;
  shared = new Redis(serverEnv().REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
  return shared;
}
