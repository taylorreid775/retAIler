import { z } from 'zod';
import { AvailabilitySchema, CurrencySchema } from './common.js';

/**
 * RawExtractedProduct is what a crawler/extractor produces from a single
 * product-detail page (PDP). It is intentionally permissive: extraction is
 * lossy and we normalize downstream in the pipeline.
 */
export const RawExtractedProductSchema = z.object({
  sourceUrl: z.string().url(),
  retailerKey: z.string(),
  /** Retailer's own SKU / product id if discoverable. */
  retailerSku: z.string().nullable().default(null),
  title: z.string().min(1),
  brand: z.string().nullable().default(null),
  description: z.string().nullable().default(null),
  /** Free-text breadcrumb/category path as seen on the site. */
  categoryPath: z.array(z.string()).default([]),
  /** Hard identifiers, when present — gold for matching. */
  gtin: z.string().nullable().default(null),
  mpn: z.string().nullable().default(null),
  /** Price in major units as parsed from the page. */
  price: z.number().nonnegative().nullable().default(null),
  listPrice: z.number().nonnegative().nullable().default(null),
  currency: CurrencySchema.default('CAD'),
  availability: AvailabilitySchema.default('unknown'),
  /** Estimated units in stock if the site exposes it. */
  stockQty: z.number().int().nonnegative().nullable().default(null),
  imageUrl: z.string().url().nullable().default(null),
  /** Arbitrary attribute bag (color, size, weight, ...). */
  attributes: z.record(z.string(), z.string()).default({}),
  /** When the page was captured. */
  capturedAt: z.coerce.date().default(() => new Date()),
});
export type RawExtractedProduct = z.infer<typeof RawExtractedProductSchema>;

/** A product as listed at a single retailer (one row per retailer listing). */
export const RetailerProductSchema = z.object({
  id: z.string().uuid(),
  retailerId: z.string().uuid(),
  productId: z.string().uuid().nullable(),
  url: z.string().url(),
  retailerSku: z.string().nullable(),
  rawTitle: z.string(),
  brandRaw: z.string().nullable(),
  categoryPathRaw: z.array(z.string()),
  gtin: z.string().nullable(),
  mpn: z.string().nullable(),
  imageUrl: z.string().url().nullable(),
  firstSeenAt: z.date(),
  lastSeenAt: z.date(),
  active: z.boolean(),
});
export type RetailerProduct = z.infer<typeof RetailerProductSchema>;

/** A canonical, cross-retailer matched product. */
export const ProductSchema = z.object({
  id: z.string().uuid(),
  canonicalTitle: z.string(),
  brandId: z.string().uuid().nullable(),
  categoryId: z.string().uuid().nullable(),
  gtin: z.string().nullable(),
  mpn: z.string().nullable(),
  imageUrl: z.string().url().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Product = z.infer<typeof ProductSchema>;

export const PriceObservationSchema = z.object({
  id: z.string().uuid(),
  retailerProductId: z.string().uuid(),
  amountMinor: z.number().int(),
  listAmountMinor: z.number().int().nullable(),
  currency: CurrencySchema,
  capturedAt: z.date(),
});
export type PriceObservation = z.infer<typeof PriceObservationSchema>;

export const StockObservationSchema = z.object({
  id: z.string().uuid(),
  retailerProductId: z.string().uuid(),
  availability: AvailabilitySchema,
  qty: z.number().int().nonnegative().nullable(),
  capturedAt: z.date(),
});
export type StockObservation = z.infer<typeof StockObservationSchema>;
