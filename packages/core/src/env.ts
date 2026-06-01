import { z } from 'zod';

/**
 * Server-side env, validated lazily. Apps/services call `serverEnv()` at
 * startup so a misconfiguration fails fast with a readable message.
 */
const ServerEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  BLOB_READ_WRITE_TOKEN: z.string().optional(),
  AI_GATEWAY_API_KEY: z.string().optional(),
  AI_EXTRACTION_MODEL: z.string().default('openai/gpt-4o-mini'),
  AI_EMBEDDING_MODEL: z.string().default('openai/text-embedding-3-small'),
  CRAWLER_USER_AGENT: z
    .string()
    .default('RetAIlerBot/0.1 (+https://retailer.example/bot)'),
  CRAWLER_PROXY_URL: z.string().optional(),
  CRAWLER_MAX_CONCURRENCY: z.coerce.number().int().positive().default(2),
  RESEND_API_KEY: z.string().optional(),
  REPORTS_FROM_EMAIL: z.string().default('intelligence@retailer.example'),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
});

export type ServerEnv = z.infer<typeof ServerEnvSchema>;

let cached: ServerEnv | null = null;

export function serverEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = ServerEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid server environment:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}
