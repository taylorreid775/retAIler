import { config } from 'dotenv';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Load monorepo root `.env` before any package imports that read env. */
config({ path: resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../.env') });
