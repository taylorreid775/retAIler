import { z } from 'zod';

/** ISO 4217 currency codes we support (Canadian retail focus). */
export const CurrencySchema = z.enum(['CAD', 'USD']);
export type Currency = z.infer<typeof CurrencySchema>;

/** Money stored as integer minor units (cents) to avoid float drift. */
export const MoneySchema = z.object({
  /** Amount in minor units (e.g. cents). 19999 === $199.99 */
  amountMinor: z.number().int(),
  currency: CurrencySchema.default('CAD'),
});
export type Money = z.infer<typeof MoneySchema>;

export function toMinor(amount: number): number {
  return Math.round(amount * 100);
}

export function fromMinor(amountMinor: number): number {
  return amountMinor / 100;
}

export function formatMoney(money: Money): string {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: money.currency,
  }).format(fromMinor(money.amountMinor));
}

/** Availability of a product at a given retailer. */
export const AvailabilitySchema = z.enum([
  'in_stock',
  'out_of_stock',
  'preorder',
  'discontinued',
  'unknown',
]);
export type Availability = z.infer<typeof AvailabilitySchema>;

export const slug = (value: string): string =>
  value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '');
