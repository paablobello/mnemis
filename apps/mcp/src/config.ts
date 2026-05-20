import { z } from 'zod';

const envSchema = z.object({
  MNEMIS_API_URL: z.string().url().default('http://localhost:8787'),
  MNEMIS_API_KEY: z.string().min(1, 'MNEMIS_API_KEY is required'),
  MNEMIS_SEARCH_LIMIT: z.coerce.number().int().min(1).max(50).optional(),
});

export type McpConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): McpConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid Mnemis MCP configuration:\n${issues}`);
  }
  return parsed.data;
}
