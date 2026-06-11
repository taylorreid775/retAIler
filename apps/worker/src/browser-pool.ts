import { BrowserFetcher } from './browser-fetcher.js';

export interface BrowserLease {
  fetcher: BrowserFetcher;
  release: () => Promise<void>;
}

/** Exclusive pool: one in-flight discovery job per browser context. */
export class BrowserPool {
  private readonly fetchers: BrowserFetcher[] = [];
  private readonly inUse = new Set<number>();
  private readonly waiters: Array<() => void> = [];

  constructor(
    size = Number(process.env.BROWSER_POOL_SIZE ?? 2),
    fetcherFactory: () => BrowserFetcher = () => new BrowserFetcher(),
  ) {
    const count = Math.max(1, Math.min(size, 4));
    for (let i = 0; i < count; i++) {
      this.fetchers.push(fetcherFactory());
    }
  }

  size(): number {
    return this.fetchers.length;
  }

  /** @deprecated Use runExclusive — round-robin shares session state across jobs. */
  acquire(): BrowserFetcher {
    return this.fetchers[0]!;
  }

  private notifyWaiter(): void {
    const next = this.waiters.shift();
    next?.();
  }

  private async waitForSlot(): Promise<void> {
    if (this.inUse.size < this.fetchers.length) return;
    await new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
    return this.waitForSlot();
  }

  /** Hold an isolated browser context for the duration of one discovery job. */
  async acquireExclusive(): Promise<BrowserLease> {
    await this.waitForSlot();
    const index = this.fetchers.findIndex((_, i) => !this.inUse.has(i));
    if (index < 0) {
      await this.waitForSlot();
      return this.acquireExclusive();
    }
    this.inUse.add(index);
    const fetcher = this.fetchers[index]!;
    let released = false;
    return {
      fetcher,
      release: async () => {
        if (released) return;
        released = true;
        await fetcher.resetSession();
        this.inUse.delete(index);
        this.notifyWaiter();
      },
    };
  }

  async runExclusive<T>(fn: (fetcher: BrowserFetcher) => Promise<T>): Promise<T> {
    const lease = await this.acquireExclusive();
    try {
      return await fn(lease.fetcher);
    } finally {
      await lease.release();
    }
  }

  async close(): Promise<void> {
    await Promise.all(this.fetchers.map((f) => f.close()));
  }
}

let sharedPool: BrowserPool | null = null;

export function getBrowserPool(): BrowserPool {
  if (!sharedPool) sharedPool = new BrowserPool();
  return sharedPool;
}

/** Cap worker concurrency to pool capacity so jobs always get an exclusive browser. */
export function resolveDiscoveryConcurrency(pool = getBrowserPool()): number {
  const requested = Number(process.env.DISCOVERY_CONCURRENCY ?? 1);
  const safe = Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : 1;
  return Math.min(safe, pool.size());
}

export async function closeBrowserPool(): Promise<void> {
  if (!sharedPool) return;
  await sharedPool.close();
  sharedPool = null;
}
