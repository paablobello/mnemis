import { z } from 'zod';

export const githubInstallationIdSchema = z
  .union([z.string().regex(/^\d+$/), z.number().int().positive().safe()])
  .transform((value) => String(value));

export const githubInstallationAccountTypeSchema = z
  .enum(['User', 'Organization', 'Bot'])
  .or(z.string().min(1).max(100));

export const registerGitHubInstallationSchema = z
  .object({
    installationId: githubInstallationIdSchema,
    accountLogin: z.string().min(1).max(255),
    accountType: githubInstallationAccountTypeSchema.optional(),
    repositorySelection: z.enum(['all', 'selected']).or(z.string().min(1).max(100)).optional(),
    permissions: z.record(z.unknown()).optional(),
    events: z.array(z.string().min(1).max(100)).max(100).optional(),
    installedAt: z.string().datetime().optional(),
  })
  .strict();

export type RegisterGitHubInstallationInput = z.infer<typeof registerGitHubInstallationSchema>;
