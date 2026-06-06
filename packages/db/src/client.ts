import './load-env';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  // eslint-disable-next-line no-console
  console.warn('[db] DATABASE_URL is not set — db client will fail on first query.');
}

/**
 * Single shared postgres connection. `max: 1` is friendly to serverless;
 * the worker overrides via its own pool size if needed.
 */
const queryClient = postgres(connectionString ?? '', {
  max: Number(process.env.DB_POOL_MAX ?? 5),
  prepare: false,
});

export const db = drizzle(queryClient, { schema });
export type Database = typeof db;
export { queryClient };
