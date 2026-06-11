import { put } from '@vercel/blob';
import { createLogger, serverEnv } from '@retailer/core';
import { redactHeadersForHar } from './header-deps.js';
import type { CapturedRequest } from './network-types.js';

const log = createLogger('crawler:har');

export interface HarExportResult {
  blobKey: string;
  url?: string;
  entryCount: number;
}

interface HarLog {
  log: {
    version: string;
    creator: { name: string; version: string };
    entries: HarEntry[];
  };
}

interface HarEntry {
  startedDateTime: string;
  time: number;
  request: {
    method: string;
    url: string;
    httpVersion: string;
    headers: Array<{ name: string; value: string }>;
    queryString: Array<{ name: string; value: string }>;
    postData?: { mimeType: string; text: string };
  };
  response: {
    status: number;
    statusText: string;
    httpVersion: string;
    headers: Array<{ name: string; value: string }>;
    content: { size: number; mimeType: string; text?: string };
  };
  cache: Record<string, never>;
  timings: { send: number; wait: number; receive: number };
}

function headersToHar(headers: Record<string, string>): Array<{ name: string; value: string }> {
  return Object.entries(headers).map(([name, value]) => ({ name, value }));
}

function parseQueryString(url: string): Array<{ name: string; value: string }> {
  try {
    const u = new URL(url);
    return [...u.searchParams.entries()].map(([name, value]) => ({ name, value }));
  } catch {
    return [];
  }
}

/** Build HAR 1.2 log from captured browser requests. */
export function buildHarFromCaptures(captures: CapturedRequest[], baseTime = Date.now()): HarLog {
  const entries: HarEntry[] = captures.map((capture, index) => {
    const started = new Date(baseTime + capture.timing.startMs).toISOString();
    const responseText = capture.responseBody ?? capture.bodyPreview;

    return {
      startedDateTime: started,
      time: capture.timing.durationMs,
      request: {
        method: capture.method,
        url: capture.url,
        httpVersion: 'HTTP/1.1',
        headers: headersToHar(redactHeadersForHar(capture.requestHeaders)),
        queryString: parseQueryString(capture.url),
        ...(capture.requestBody
          ? {
              postData: {
                mimeType: capture.contentType || 'application/json',
                text: capture.requestBody,
              },
            }
          : {}),
      },
      response: {
        status: capture.status,
        statusText: capture.status >= 200 && capture.status < 300 ? 'OK' : 'Error',
        httpVersion: 'HTTP/1.1',
        headers: headersToHar(redactHeadersForHar(capture.responseHeaders)),
        content: {
          size: responseText.length,
          mimeType: capture.contentType || 'application/json',
          text: responseText.slice(0, 32_768),
        },
      },
      cache: {},
      timings: {
        send: 0,
        wait: capture.timing.durationMs,
        receive: 0,
      },
    };
  });

  return {
    log: {
      version: '1.2',
      creator: { name: 'retailer-discovery', version: '1.0' },
      entries,
    },
  };
}

/**
 * Persist network HAR to Vercel Blob: discovery/{retailerKey}/{timestamp}/network.har
 */
export async function storeNetworkHar(
  retailerKey: string,
  captures: CapturedRequest[],
  timestamp = Date.now(),
): Promise<HarExportResult> {
  const blobKey = `discovery/${retailerKey}/${timestamp}/network.har`;
  const har = buildHarFromCaptures(captures, timestamp);
  const body = JSON.stringify(har, null, 2);
  const token = serverEnv().BLOB_READ_WRITE_TOKEN;

  if (!token) {
    log.warn('BLOB_READ_WRITE_TOKEN missing — skipping HAR upload', { retailerKey, blobKey });
    return { blobKey, entryCount: captures.length };
  }

  const blob = await put(blobKey, body, {
    access: 'private',
    token,
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
  } as unknown as Parameters<typeof put>[2]);

  log.info('network HAR stored', { retailerKey, blobKey, entries: captures.length });
  return { blobKey, url: blob.url, entryCount: captures.length };
}
