/** Rough USD cost per 1M tokens for discovery inference models. */
const COST_PER_MILLION_TOKENS: Record<string, number> = {
  'openai/gpt-4o-mini': 0.15,
  default: 0.15,
};

export interface AiTokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

/** Estimate discovery AI cost from token usage (conservative blend). */
export function estimateCostFromTokens(
  usage: AiTokenUsage,
  model = 'openai/gpt-4o-mini',
): number {
  const total =
    usage.totalTokens ??
    (usage.promptTokens ?? 0) + (usage.completionTokens ?? 0);
  if (total <= 0) return 0;
  const rate = COST_PER_MILLION_TOKENS[model] ?? COST_PER_MILLION_TOKENS.default!;
  return Number(((total / 1_000_000) * rate).toFixed(6));
}
