/** Resource types observed during browser network capture. */
export type CaptureResourceType = 'xhr' | 'fetch' | 'document' | 'script';

/** Full request metadata from Stage 2 network analysis (WORKFLOW / TOOLS). */
export interface CapturedRequest {
  /** Request URL (alias: requestUrl in legacy captures). */
  url: string;
  /** Page URL that initiated the request. */
  pageUrl: string;
  method: string;
  resourceType: CaptureResourceType;
  requestHeaders: Record<string, string>;
  responseHeaders: Record<string, string>;
  requestBody?: string;
  status: number;
  contentType: string;
  /** Truncated response body (max 256KB). */
  responseBody?: string;
  /** Truncated JSON body for AI analysis (legacy alias, ≤12KB). */
  bodyPreview: string;
  productLikeScore: number;
  timing: { startMs: number; durationMs: number };
  /** Same as pageUrl — page that triggered the request. */
  initiatorUrl: string;
  /** Cookie names inferred as required for replay. */
  cookiesRequired: string[];
  /** Prior request URLs that set cookies/tokens used by this request. */
  dependsOn?: string[];
  /** Parsed GraphQL operationName when request is a GraphQL POST. */
  graphqlOperationName?: string | null;
}

/** Legacy shape used by inferApiRecipe — subset of CapturedRequest. */
export interface CapturedJsonResponse {
  pageUrl: string;
  requestUrl: string;
  method: string;
  requestHeaders: Record<string, string>;
  status: number;
  contentType: string;
  /** Truncated JSON body for AI analysis. */
  bodyPreview: string;
  productLikeScore: number;
}

const BODY_PREVIEW_LIMIT = 12_000;
const RESPONSE_BODY_LIMIT = 256 * 1024;

/** Normalize extended capture to legacy infer-api shape. */
export function toCapturedJsonResponse(capture: CapturedRequest): CapturedJsonResponse {
  return {
    pageUrl: capture.pageUrl,
    requestUrl: capture.url,
    method: capture.method,
    requestHeaders: capture.requestHeaders,
    status: capture.status,
    contentType: capture.contentType,
    bodyPreview: capture.bodyPreview,
    productLikeScore: capture.productLikeScore,
  };
}

/** Build a CapturedRequest with consistent preview/body truncation. */
export function buildCapturedRequest(
  partial: Omit<CapturedRequest, 'bodyPreview' | 'initiatorUrl'> & {
    responseBody?: string;
    bodyPreview?: string;
  },
): CapturedRequest {
  const responseBody = partial.responseBody?.slice(0, RESPONSE_BODY_LIMIT);
  const bodyPreview =
    partial.bodyPreview ?? responseBody?.slice(0, BODY_PREVIEW_LIMIT) ?? '';
  return {
    ...partial,
    responseBody,
    bodyPreview,
    initiatorUrl: partial.pageUrl,
  };
}
