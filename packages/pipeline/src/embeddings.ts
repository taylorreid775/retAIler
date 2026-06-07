import { embed } from 'ai';
import { embeddingModel, createLogger } from '@retailer/core';
import { db, schema } from '@retailer/db';

const log = createLogger('pipeline:embeddings');

/** Build the text we embed for matching: brand + category + title + attributes. */
export function embeddingText(input: {
  rawTitle: string;
  brandRaw: string | null;
  categoryPath?: string[];
  attributes: Record<string, string>;
}): string {
  const attrs = Object.entries(input.attributes)
    .slice(0, 8)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ');
  const category = (input.categoryPath ?? []).filter(Boolean).slice(-2).join(' > ');
  return [input.brandRaw, category, input.rawTitle, attrs].filter(Boolean).join(' | ');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isRateLimited(err: unknown): boolean {
  const msg = String(err);
  return msg.includes('rate-limited') || msg.includes('429') || msg.includes('RetryError');
}

/** Compute and upsert the embedding for a retailer product. Returns the vector. */
export async function upsertEmbedding(
  retailerProductId: string,
  text: string,
): Promise<number[] | null> {
  try {
    const embedding = await embedWithRetry(text);
    await db
      .insert(schema.productEmbeddings)
      .values({ retailerProductId, embedding })
      .onConflictDoUpdate({
        target: schema.productEmbeddings.retailerProductId,
        set: { embedding },
      });
    return embedding;
  } catch (err) {
    log.warn('embedding failed', { retailerProductId, err: String(err) });
    return null;
  }
}

/** Retry embeddings on gateway rate limits with exponential backoff. */
async function embedWithRetry(text: string, maxAttempts = 4): Promise<number[]> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const { embedding } = await embed({ model: embeddingModel(), value: text });
      return embedding;
    } catch (err) {
      lastErr = err;
      if (!isRateLimited(err) || attempt === maxAttempts - 1) throw err;
      const delayMs = Math.min(30_000, 2_000 * 2 ** attempt);
      log.warn('embedding rate limited, retrying', { attempt: attempt + 1, delayMs });
      await sleep(delayMs);
    }
  }
  throw lastErr;
}
