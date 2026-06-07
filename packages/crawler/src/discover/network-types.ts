/** A JSON API response observed during browser onboarding (network sniff). */
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
