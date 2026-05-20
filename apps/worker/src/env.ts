import { z } from 'zod';

function emptyToUndefined(value: unknown): unknown {
  return value === '' ? undefined : value;
}

const optionalString = z.preprocess(emptyToUndefined, z.string().optional());
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
  DATABASE_URL: z.string().url(),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(1_000),
  WORKER_ONCE: envBoolean(false),
  MNEMIS_ALLOW_LOCAL_SOURCES: envBoolean(false),
  MNEMIS_MODE: z.enum(['self-host', 'cloud']).default('self-host'),
  MNEMIS_LOCAL_SOURCE_ROOTS: optionalString,
  JOB_STALE_AFTER_MS: optionalPositiveInt.default(30 * 60_000),
  JOB_MAX_ATTEMPTS: optionalPositiveInt.default(3),
  GITHUB_APP_ID: optionalString,
  GITHUB_APP_PRIVATE_KEY: z
    .preprocess(emptyToUndefined, z.string().optional())
    .transform((value) => (value ? value.replace(/\\n/g, '\n') : value)),
});

export type WorkerEnv = z.infer<typeof envSchema>;

export function loadEnv(): WorkerEnv {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid worker environment:\n${issues}`);
  }
  return parsed.data;
}
