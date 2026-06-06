import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const DIR = join(process.cwd(), '.snapshots');

/** Persist HTML locally when Vercel Blob is unconfigured (dev/worker). */
export async function storeLocalSnapshot(key: string, html: string): Promise<void> {
  await mkdir(DIR, { recursive: true });
  const safe = key.replace(/\//g, '_');
  await writeFile(join(DIR, `${safe}.html`), html, 'utf8');
}

export async function loadLocalSnapshot(key: string): Promise<string | null> {
  try {
    const safe = key.replace(/\//g, '_');
    return await readFile(join(DIR, `${safe}.html`), 'utf8');
  } catch {
    return null;
  }
}
