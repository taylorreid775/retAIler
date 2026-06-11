import type { ApiRecipe } from '@retailer/schema';
import { buildApiFetchInit, buildApiPageUrl, getAtPath } from './api-recipe.js';
import type { DiscoverContext } from '../adapters/types.js';

export type PaginationStyle = 'offset' | 'cursor' | 'page' | 'link_rel' | 'none';

export interface DetectedPagination {
  style: PaginationStyle;
  pageParam: string | null;
  itemsPerPage?: number;
  cursorPath?: string | null;
  nextUrlPath?: string | null;
}

const PAGE_PARAM_CANDIDATES = ['page', 'p', 'pageNumber', 'page_no', 'pg'];
const OFFSET_PARAM_CANDIDATES = ['offset', 'start', 'from', 'skip'];
const CURSOR_PARAM_CANDIDATES = ['cursor', 'after', 'page_cursor', 'next_cursor'];
const CURSOR_RESPONSE_PATHS = [
  'page_info.end_cursor',
  'pagination.endCursor',
  'meta.next_cursor',
  'cursor',
  'pageInfo.endCursor',
  'data.pageInfo.endCursor',
];
const NEXT_URL_PATHS = ['links.next', 'pagination.next', 'next', 'meta.next', '_links.next.href'];

function extractProductRecords(api: ApiRecipe, data: unknown): unknown[] {
  const raw = getAtPath(data, api.productsPath);
  return Array.isArray(raw) ? raw : [];
}

function recordIds(api: ApiRecipe, data: unknown): Set<string> {
  const records = extractProductRecords(api, data);
  const idPath = api.fieldMap.sku ?? api.fieldMap.url ?? 'id';
  const path = (Array.isArray(idPath) ? idPath[0] : idPath) ?? 'id';
  return new Set(
    records.map((item) =>
      item && typeof item === 'object' ? String(getAtPath(item, path) ?? '') : '',
    ),
  );
}

function pagesHaveDistinctProducts(
  api: ApiRecipe,
  page1: unknown,
  page2: unknown,
): boolean {
  const ids1 = recordIds(api, page1);
  const records2 = extractProductRecords(api, page2);
  if (!ids1.size || !records2.length) return false;
  const idPath = api.fieldMap.sku ?? api.fieldMap.url ?? 'id';
  const path = (Array.isArray(idPath) ? idPath[0] : idPath) ?? 'id';
  const newOnPage2 = records2.some((item) => {
    if (!item || typeof item !== 'object') return false;
    const id = String(getAtPath(item, path) ?? '');
    return id && !ids1.has(id);
  });
  return newOnPage2;
}

function findCursorPath(data: unknown): string | null {
  for (const path of CURSOR_RESPONSE_PATHS) {
    const value = getAtPath(data, path);
    if (typeof value === 'string' && value.trim()) return path;
  }
  return null;
}

function findNextUrl(data: unknown, responseHeaders?: Record<string, string>): string | null {
  for (const path of NEXT_URL_PATHS) {
    const value = getAtPath(data, path);
    if (typeof value === 'string' && value.startsWith('http')) return value;
  }
  const link = responseHeaders?.link ?? responseHeaders?.Link;
  if (link) {
    const match = link.match(/<([^>]+)>;\s*rel="next"/i);
    if (match?.[1]) return match[1];
  }
  return null;
}

async function fetchPage(
  fetchJson: NonNullable<DiscoverContext['fetchJson']>,
  url: string,
  headers: Record<string, string>,
): Promise<{ data: Record<string, unknown> | null; headers: Record<string, string> }> {
  const data = (await fetchJson(url, headers)) as Record<string, unknown> | null;
  return { data, headers: {} };
}

function withPagination(api: ApiRecipe, patch: Partial<ApiRecipe['pagination']>): ApiRecipe {
  return {
    ...api,
    pagination: { ...api.pagination, ...patch },
  };
}

async function tryPageStyle(
  api: ApiRecipe,
  fetchJson: NonNullable<DiscoverContext['fetchJson']>,
  param: string,
  style: 'page' | 'offset',
): Promise<DetectedPagination | null> {
  const trial = withPagination(api, { style, pageParam: param });
  const init = buildApiFetchInit(trial);
  const page1 = (await fetchJson(buildApiPageUrl(trial, 1), trial.headers, init)) as Record<
    string,
    unknown
  > | null;
  if (!page1 || extractProductRecords(trial, page1).length === 0) return null;

  const page2 = (await fetchJson(buildApiPageUrl(trial, 2), trial.headers, init)) as Record<
    string,
    unknown
  > | null;
  if (!page2 || !pagesHaveDistinctProducts(trial, page1, page2)) return null;

  const perPage = extractProductRecords(trial, page1).length;
  return {
    style,
    pageParam: param,
    itemsPerPage: perPage > 0 ? perPage : api.pagination.itemsPerPage,
  };
}

async function tryCursorStyle(
  api: ApiRecipe,
  fetchJson: NonNullable<DiscoverContext['fetchJson']>,
): Promise<DetectedPagination | null> {
  const apiInit = buildApiFetchInit(api);
  const page1 = (await fetchJson(buildApiPageUrl(api, 1), api.headers, apiInit)) as Record<
    string,
    unknown
  > | null;
  if (!page1) return null;

  const cursorPath = findCursorPath(page1);
  if (!cursorPath) return null;

  const cursorValue = getAtPath(page1, cursorPath);
  if (typeof cursorValue !== 'string' || !cursorValue.trim()) return null;

  for (const param of CURSOR_PARAM_CANDIDATES) {
    const trial = withPagination(api, {
      style: 'cursor',
      pageParam: param,
      cursorPath,
    });
    const trialInit = buildApiFetchInit(trial);
    const base = new URL(buildApiPageUrl(trial, 1));
    base.searchParams.set(param, cursorValue);
    const page2 = (await fetchJson(base.toString(), trial.headers, trialInit)) as Record<string, unknown> | null;
    if (page2 && pagesHaveDistinctProducts(trial, page1, page2)) {
      return {
        style: 'cursor',
        pageParam: param,
        cursorPath,
        itemsPerPage: extractProductRecords(trial, page1).length || api.pagination.itemsPerPage,
      };
    }
  }

  return null;
}

async function tryLinkRelStyle(
  api: ApiRecipe,
  fetchJson: NonNullable<DiscoverContext['fetchJson']>,
): Promise<DetectedPagination | null> {
  const linkInit = buildApiFetchInit(api);
  const page1Url = buildApiPageUrl(api, 1);
  const page1 = (await fetchJson(page1Url, api.headers, linkInit)) as Record<string, unknown> | null;
  if (!page1) return null;

  const nextUrl = findNextUrl(page1);
  if (!nextUrl) return null;

  const page2 = (await fetchJson(nextUrl, api.headers, linkInit)) as Record<string, unknown> | null;
  if (!page2 || !pagesHaveDistinctProducts(api, page1, page2)) return null;

  const nextUrlPath =
    NEXT_URL_PATHS.find((path) => {
      const value = getAtPath(page1, path);
      return typeof value === 'string' && value.startsWith('http');
    }) ?? 'links.next';

  return {
    style: 'link_rel',
    pageParam: null,
    nextUrlPath,
    itemsPerPage: extractProductRecords(api, page1).length || api.pagination.itemsPerPage,
  };
}

/**
 * Probe page 1 vs page 2 and detect offset, cursor, page, or link_rel pagination.
 * Deterministic — no LLM (AI-STRATEGY).
 */
export async function detectPaginationStyle(
  api: ApiRecipe,
  fetchJson: NonNullable<DiscoverContext['fetchJson']>,
): Promise<DetectedPagination | null> {
  const configured = api.pagination;
  if (configured.style === 'page' || configured.style === 'offset') {
    const verified = await tryPageStyle(api, fetchJson, configured.pageParam, configured.style);
    if (verified) return verified;
  }

  for (const param of PAGE_PARAM_CANDIDATES) {
    const detected = await tryPageStyle(api, fetchJson, param, 'page');
    if (detected) return detected;
  }

  for (const param of OFFSET_PARAM_CANDIDATES) {
    const detected = await tryPageStyle(api, fetchJson, param, 'offset');
    if (detected) return detected;
  }

  const cursor = await tryCursorStyle(api, fetchJson);
  if (cursor) return cursor;

  const linkRel = await tryLinkRelStyle(api, fetchJson);
  if (linkRel) return linkRel;

  return null;
}

/** Merge detected pagination into an ApiRecipe copy. */
export function applyDetectedPagination(api: ApiRecipe, detected: DetectedPagination): ApiRecipe {
  return {
    ...api,
    pagination: {
      ...api.pagination,
      style: detected.style === 'none' ? api.pagination.style : detected.style,
      pageParam: detected.pageParam ?? api.pagination.pageParam,
      itemsPerPage: detected.itemsPerPage ?? api.pagination.itemsPerPage,
      cursorPath: detected.cursorPath ?? api.pagination.cursorPath,
      nextUrlPath: detected.nextUrlPath ?? api.pagination.nextUrlPath,
    },
  };
}
