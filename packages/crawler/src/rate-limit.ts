/** Token-less per-key serial throttle: ensures >= delayMs between calls. */
export class RateLimiter {
  private last = new Map<string, number>();
  private chains = new Map<string, Promise<void>>();

  constructor(private readonly delayMs: number) {}

  /** Wait until it's polite to make the next request for `key` (e.g. host). */
  async wait(key: string): Promise<void> {
    const prev = this.chains.get(key) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((r) => (release = r));
    this.chains.set(
      key,
      prev.then(() => next),
    );

    await prev;
    const last = this.last.get(key) ?? 0;
    const elapsed = Date.now() - last;
    const remaining = this.delayMs - elapsed;
    if (remaining > 0) await sleep(remaining);
    this.last.set(key, Date.now());
    release();
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
