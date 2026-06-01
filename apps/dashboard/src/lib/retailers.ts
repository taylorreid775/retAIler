import { db, schema } from '@retailer/db';

export type RetailerRow = typeof schema.retailers.$inferSelect;

export async function allRetailers(): Promise<RetailerRow[]> {
  return db.select().from(schema.retailers).orderBy(schema.retailers.name);
}

export async function retailerMap(): Promise<Map<string, RetailerRow>> {
  const rows = await allRetailers();
  return new Map(rows.map((r) => [r.id, r]));
}
