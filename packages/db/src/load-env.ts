import { config } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Load monorepo root `.env` for local dev — skip on Vercel where env is injected. */
if (!process.env.DATABASE_URL && !process.env.VERCEL) {
  try {
    const dir = dirname(fileURLToPath(import.meta.url));
    config({ path: resolve(dir, '../../../.env') });
  } catch {
    // Bundled/serverless: rely on platform environment variables.
  }
}
