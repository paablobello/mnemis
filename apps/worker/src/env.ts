import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(1_000),
  WORKER_ONCE: z.coerce.boolean().optional().default(false),
  MNEMIS_ALLOW_LOCAL_SOURCES: z.coerce.boolean().optional().default(false),
  GITHUB_APP_ID: z.string().optional(),
  GITHUB_APP_PRIVATE_KEY: z
    .string()
    .optional()
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
