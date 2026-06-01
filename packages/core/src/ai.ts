import { createOpenAI } from '@ai-sdk/openai';
import type { EmbeddingModel, LanguageModel } from 'ai';
import { serverEnv } from './env.js';

type OpenAIProvider = ReturnType<typeof createOpenAI>;

/**
 * Vercel AI Gateway client. The Gateway exposes an OpenAI-compatible API and
 * lets us route models, fail over across providers, and track cost centrally.
 * Model ids are namespaced like "openai/gpt-4o-mini".
 */
export function aiGateway(): OpenAIProvider {
  const env = serverEnv();
  return createOpenAI({
    apiKey: env.AI_GATEWAY_API_KEY ?? '',
    baseURL: 'https://ai-gateway.vercel.sh/v1',
  });
}

export function extractionModel(): LanguageModel {
  const env = serverEnv();
  return aiGateway()(env.AI_EXTRACTION_MODEL);
}

export function embeddingModel(): EmbeddingModel<string> {
  const env = serverEnv();
  return aiGateway().embedding(env.AI_EMBEDDING_MODEL);
}
