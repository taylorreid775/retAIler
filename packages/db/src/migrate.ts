import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required to run migrations');

  const migrationClient = postgres(url, { max: 1 });
  const db = drizzle(migrationClient);

  // Ensure pgvector is available before applying schema.
  await migrationClient`CREATE EXTENSION IF NOT EXISTS vector`;

  // eslint-disable-next-line no-console
  console.log('[db] running migrations…');
  await migrate(db, { migrationsFolder: './drizzle' });

  // Vector ANN index (drizzle-kit can't express HNSW yet). Idempotent.
  await migrationClient`
    CREATE INDEX IF NOT EXISTS product_embeddings_hnsw_idx
    ON product_embeddings USING hnsw (embedding vector_cosine_ops)
  `;

  // eslint-disable-next-line no-console
  console.log('[db] migrations complete');

  await migrationClient.end();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
