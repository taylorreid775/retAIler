import { z } from 'zod';

export const BrandSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  createdAt: z.date(),
});
export type Brand = z.infer<typeof BrandSchema>;

export const CategorySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  parentId: z.string().uuid().nullable(),
  /** Materialized path for fast subtree queries, e.g. "footwear/running". */
  path: z.string(),
  depth: z.number().int().nonnegative(),
  createdAt: z.date(),
});
export type Category = z.infer<typeof CategorySchema>;
