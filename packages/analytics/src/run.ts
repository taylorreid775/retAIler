import { createLogger } from '@retailer/core';
import { computePriceChanges } from './price-changes';
import { computeNewProducts } from './new-products';
import { computeInventorySignals } from './inventory';

const log = createLogger('analytics:run');

export interface AnalyticsSummary {
  priceChanges: number;
  newProducts: number;
  inventory: number;
}

/** Run all signal computations for a window (called by the analytics cron). */
export async function runAnalytics(windowDays = 1): Promise<AnalyticsSummary> {
  log.info('running analytics', { windowDays });
  const priceChanges = await computePriceChanges(windowDays);
  const newProducts = await computeNewProducts(windowDays);
  const inventory = await computeInventorySignals(windowDays);
  const summary = { priceChanges, newProducts, inventory };
  log.info('analytics complete', summary);
  return summary;
}
