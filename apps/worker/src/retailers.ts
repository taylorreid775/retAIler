import { db, schema, eq } from '@retailer/db';

export type RetailerRow = typeof schema.retailers.$inferSelect;

const cache = new Map<string, { row: RetailerRow; at: number }>();
const TTL = 60_000;

export async function getRetailer(key: string): Promise<RetailerRow | null> {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < TTL) return cached.row;
  const [row] = await db.select().from(schema.retailers).where(eq(schema.retailers.key, key));
  if (row) cache.set(key, { row, at: Date.now() });
  return row ?? null;
}
