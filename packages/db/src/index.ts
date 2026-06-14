export * from './client';
export * from './recipe-versions';
export * from './discovery-runs';
export * from './rollback-recipe';
export * as schema from './schema';
export { EMBEDDING_DIM } from './schema';
// Curated re-export of the operators we actually use (avoids pulling the
// entire drizzle-orm surface into every consumer).
export {
  and,
  or,
  eq,
  ne,
  gt,
  gte,
  lt,
  lte,
  inArray,
  notInArray,
  isNull,
  isNotNull,
  like,
  ilike,
  between,
  desc,
  asc,
  sql,
  count,
  countDistinct,
  sum,
  avg,
  min,
  max,
} from 'drizzle-orm';
