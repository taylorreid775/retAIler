import type { MetadataRoute } from 'next';
import { db, sql } from '@retailer/db';

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.NEXT_PUBLIC_WEB_URL ?? 'http://localhost:3001';
  let products: { id: string; updated_at: Date }[] = [];
  try {
    products = await db.execute<{ id: string; updated_at: Date }>(sql`
      SELECT id, updated_at FROM products ORDER BY updated_at DESC LIMIT 5000
    `);
  } catch {
    products = [];
  }

  return [
    { url: base, changeFrequency: 'daily', priority: 1 },
    ...products.map((p) => ({
      url: `${base}/product/${p.id}`,
      lastModified: p.updated_at,
      changeFrequency: 'daily' as const,
      priority: 0.7,
    })),
  ];
}
