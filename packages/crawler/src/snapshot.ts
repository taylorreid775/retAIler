import { createHash } from 'node:crypto';
import { put } from '@vercel/blob';
import { serverEnv, createLogger } from '@retailer/core';

const log = createLogger('crawler:snapshot');

export function contentHash(html: string): string {
  return createHash('sha256').update(html).digest('hex');
}

export interface SnapshotResult {
  blobKey: string;
  contentHash: string;
  /** Public URL to download the snapshot (undefined when Blob is unconfigured). */
  url?: string;
}

/**
 * Persist raw HTML to Vercel Blob so we can re-extract without re-crawling
 * (provenance + cost control). Key layout: snapshots/<retailer>/<hash>.html
 */
export async function storeSnapshot(
  retailerKey: string,
  html: string,
): Promise<SnapshotResult> {
  const hash = contentHash(html);
  const blobKey = `snapshots/${retailerKey}/${hash}.html`;
  const token = serverEnv().BLOB_READ_WRITE_TOKEN;

  if (!token) {
    log.warn('BLOB_READ_WRITE_TOKEN missing — skipping snapshot upload', { retailerKey });
    return { blobKey, contentHash: hash };
  }

  const blob = await put(blobKey, html, {
    access: 'public',
    token,
    contentType: 'text/html',
    addRandomSuffix: false,
    allowOverwrite: true,
  });
  return { blobKey, contentHash: hash, url: blob.url };
}

/** Download a previously stored snapshot's HTML by its public URL. */
export async function loadSnapshot(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`failed to load snapshot ${url}: ${res.status}`);
  return res.text();
}
