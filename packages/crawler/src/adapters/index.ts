import { type RetailerAdapter } from './types';
import { sportchekAdapter } from './sportchek';
import { mecAdapter } from './mec';
import { sportingLifeAdapter } from './sportinglife';
import { decathlonAdapter } from './decathlon';

const adapters: Record<string, RetailerAdapter> = {
  [sportchekAdapter.key]: sportchekAdapter,
  [mecAdapter.key]: mecAdapter,
  [sportingLifeAdapter.key]: sportingLifeAdapter,
  [decathlonAdapter.key]: decathlonAdapter,
};

/** Register an adapter at runtime (e.g. a generic adapter built from config). */
export function registerAdapter(adapter: RetailerAdapter): void {
  adapters[adapter.key] = adapter;
}

export function getAdapter(key: string): RetailerAdapter | undefined {
  return adapters[key];
}

export function listAdapters(): RetailerAdapter[] {
  return Object.values(adapters);
}

export * from './types';
export * from './generic';
export * from './sportchek-api';
