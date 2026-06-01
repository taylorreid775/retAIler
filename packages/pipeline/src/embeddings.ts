import { embed } from 'ai';
import { embeddingModel, createLogger } from '@retailer/core';
import { db, schema } from '@retailer/db';

const log = createLogger('pipeline:embeddings');

/** Build the text we embed for matching: brand + title + salient attributes. */
export function embeddingText(input: {
  rawTitle: string;
  brandRaw: string | null;
  attributes: Record<string, string>;
}): string {
  const attrs = Object.entries(input.attributes)
    .slice(0, 8)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ');
  return [input.brandRaw, input.rawTitle, attrs].filter(Boolean).join(' | ');
}

/** Compute and upsert the embedding for a retailer product. Returns the vector. */
export async function upsertEmbedding(
  retailerProductId: string,
  text: string,
): Promise<number[] | null> {
  try {
    const { embedding } = await embed({ model: embeddingModel(), value: text });
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
