import { z } from 'zod';

function emptyToUndefined(value: unknown): unknown {
  return value === '' ? undefined : value;
}

const optionalString = z.preprocess(emptyToUndefined, z.string().optional());
const optionalUrl = z.preprocess(emptyToUndefined, z.string().url().optional());
const optionalPositiveInt = z.preprocess(
  emptyToUndefined,
  z.coerce.number().int().positive().optional(),
);

function envBoolean(defaultValue: boolean) {
  return z
    .preprocess((value) => {
      if (value === undefined || value === '') return undefined;
      if (typeof value !== 'string') return value;
      const normalized = value.trim().toLowerCase();
      if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
      if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
      return value;
    }, z.boolean().optional())
    .default(defaultValue);
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  DATABASE_URL: z.string().url(),

  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: z.coerce.number().int().positive().default(8787),

  GITHUB_WEBHOOK_SECRET: optionalString,
  GITHUB_APP_ID: optionalString,
  GITHUB_APP_PRIVATE_KEY: z
    .preprocess(emptyToUndefined, z.string().optional())
    .transform((value) => (value ? value.replace(/\\n/g, '\n') : value)),

  ANTHROPIC_API_KEY: optionalString,
  VOYAGE_API_KEY: optionalString,
  COHERE_API_KEY: optionalString,

  INTERNAL_AUTH_SECRET: z.string().min(8),

  MNEMIS_MODE: z.enum(['self-host', 'cloud']).default('self-host'),
  MNEMIS_ALLOW_LOCAL_SOURCES: envBoolean(false),
  MNEMIS_LOCAL_SOURCE_ROOTS: optionalString,
  MNEMIS_MAX_BODY_BYTES: optionalPositiveInt,
  MNEMIS_RATE_LIMIT_PER_MINUTE: optionalPositiveInt,
  FIRECRAWL_API_KEY: optionalString,
  FIRECRAWL_API_URL: optionalUrl,
  MNEMIS_RERANK_PROVIDER: z.preprocess(
    emptyToUndefined,
    z.enum(['none', 'voyage', 'local']).optional(),
  ),
  MNEMIS_RERANK_MODEL: optionalString,
  MNEMIS_LOCAL_RERANK_MODEL: optionalString,
  ANTHROPIC_CONTEXT_MODEL: optionalString,
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function loadEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}
