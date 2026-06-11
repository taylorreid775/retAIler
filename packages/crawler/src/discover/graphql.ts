/**
 * Deterministic GraphQL operation name extraction from captured request bodies.
 * WORKFLOW Stage 2: parse operationName before AI inference.
 */
export function parseGraphqlOperationName(requestBody: string | undefined): string | null {
  if (!requestBody?.trim()) return null;

  const trimmed = requestBody.trim();

  try {
    const json = JSON.parse(trimmed) as Record<string, unknown>;
    if (typeof json.operationName === 'string' && json.operationName.trim()) {
      return json.operationName.trim();
    }
    if (Array.isArray(json)) {
      for (const item of json) {
        if (item && typeof item === 'object' && typeof (item as Record<string, unknown>).operationName === 'string') {
          const name = String((item as Record<string, unknown>).operationName).trim();
          if (name) return name;
        }
      }
    }
    if (typeof json.query === 'string') {
      return parseOperationFromQueryString(json.query);
    }
  } catch {
    // fall through to raw query parsing
  }

  return parseOperationFromQueryString(trimmed);
}

function parseOperationFromQueryString(query: string): string | null {
  const normalized = query.replace(/\s+/g, ' ').trim();

  const named = normalized.match(/\b(query|mutation|subscription)\s+([A-Za-z_][A-Za-z0-9_]*)/);
  if (named?.[2]) return named[2];

  const anonymous = normalized.match(/^\s*(query|mutation|subscription)\s*[\({]/);
  if (anonymous) return anonymous[1] ?? null;

  return null;
}

/** Classify endpoint type when GraphQL signals are present. */
export function isGraphqlCapture(capture: {
  requestBody?: string;
  contentType: string;
  url: string;
  graphqlOperationName?: string | null;
}): boolean {
  if (capture.graphqlOperationName) return true;
  if (capture.contentType.includes('graphql')) return true;
  if (/\/graphql\b/i.test(capture.url)) return true;
  if (capture.requestBody?.includes('query') && capture.requestBody.includes('{')) return true;
  return false;
}
