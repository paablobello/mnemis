import { z } from 'zod';
import { githubInstallationIdSchema } from './github.ts';

export const sourceKindSchema = z.enum([
  'github_repo',
  'docs_site',
  'web_page',
  'pdf_document',
  'academic_paper',
  'research_collection',
]);
export type SourceKindInput = z.infer<typeof sourceKindSchema>;

export const sourceStatusSchema = z.enum(['pending', 'indexing', 'indexed', 'failed']);
export type SourceStatusInput = z.infer<typeof sourceStatusSchema>;

export const indexStrategySchema = z.enum(['manual', 'webhook', 'cron']);
export type IndexStrategyInput = z.infer<typeof indexStrategySchema>;

const githubRepoIdentifier = z
  .string()
  .min(3)
  .max(200)
  .regex(
    /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/,
    'GitHub repo identifier must have the form owner/repo',
  );

const docsSiteIdentifier = z.string().url().max(2_000);
const webIdentifier = z.string().url().max(2_000);

export const sourceConfigSchema = z
  .object({
    branch: z.string().min(1).max(255).optional(),
    githubInstallationId: githubInstallationIdSchema.optional(),
    title: z.string().min(1).max(1_000).optional(),
    sourceUrl: z.string().url().max(2_000).optional(),
    pdfUrl: z.string().url().max(2_000).optional(),
    includePaths: z.array(z.string().min(1).max(1_000)).max(256).optional(),
    excludePaths: z.array(z.string().min(1).max(1_000)).max(256).optional(),
    focusInstructions: z.string().min(1).max(4_000).optional(),
    localPath: z.string().min(1).max(2_000).optional(),
    maxFileBytes: z
      .number()
      .int()
      .positive()
      .max(10 * 1024 * 1024)
      .optional(),
    maxPdfBytes: z
      .number()
      .int()
      .positive()
      .max(100 * 1024 * 1024)
      .optional(),
    chunkMaxChars: z.number().int().min(500).max(20_000).optional(),
    chunkOverlapLines: z.number().int().min(0).max(50).optional(),
    contextualPrefixMode: z.enum(['auto', 'always', 'never']).optional(),
    contextualPrefixMaxDocumentChars: z.number().int().min(1_000).max(250_000).optional(),
    contextualPrefixMaxChunkChars: z.number().int().min(500).max(30_000).optional(),
    maxPages: z.number().int().positive().max(50_000).optional(),
    respectRobots: z.boolean().optional(),
    docsCrawler: z.enum(['auto', 'native', 'firecrawl']).optional(),
    pdfExtractor: z.enum(['auto', 'native', 'sidecar']).optional(),
    research: z.record(z.unknown()).optional(),
  })
  .strict();

export const createSourceSchema = z
  .object({
    kind: sourceKindSchema,
    identifier: z.string().min(1).max(2_000),
    displayName: z.string().min(1).max(255).optional(),
    config: sourceConfigSchema.optional(),
    indexStrategy: indexStrategySchema.optional().default('manual'),
    cronSchedule: z.string().min(1).max(255).nullable().optional(),
    enqueue: z.boolean().optional().default(true),
  })
  .strict()
  .superRefine((value, ctx) => {
    const parsed =
      value.kind === 'github_repo'
        ? githubRepoIdentifier.safeParse(value.identifier)
        : value.kind === 'research_collection'
          ? z.string().min(1).max(2_000).safeParse(value.identifier)
          : value.kind === 'docs_site'
            ? docsSiteIdentifier.safeParse(value.identifier)
            : webIdentifier.safeParse(value.identifier);

    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        ctx.addIssue({ ...issue, path: ['identifier'] });
      }
    }

    if (value.indexStrategy !== 'cron' && value.cronSchedule) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['cronSchedule'],
        message: 'cronSchedule is only valid when indexStrategy is cron',
      });
    }

    if (value.indexStrategy === 'cron') {
      if (!value.cronSchedule) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['cronSchedule'],
          message: 'cronSchedule is required when indexStrategy is cron',
        });
      } else if (value.cronSchedule.trim().split(/\s+/).length !== 5) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['cronSchedule'],
          message: 'cronSchedule must be a standard 5-field cron expression',
        });
      }
    }
  });
export type CreateSourceInput = z.infer<typeof createSourceSchema>;

export const listSourcesQuerySchema = z.object({
  kind: sourceKindSchema.optional(),
  status: sourceStatusSchema.optional(),
  q: z.string().min(1).max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export const searchModeSchema = z.enum(['raw', 'markdown', 'synthesized']);
export type SearchModeInput = z.infer<typeof searchModeSchema>;

export const sourceSearchSchema = z
  .object({
    query: z.string().min(1).max(1_000),
    retrieval: z.enum(['keyword', 'hybrid']).optional().default('hybrid'),
    mode: searchModeSchema.optional().default('raw'),
    synthesisModel: z.string().min(1).max(200).optional(),
    sourceIds: z.array(z.string().uuid()).max(100).optional(),
    kinds: z.array(sourceKindSchema).max(6).optional(),
    pathPrefix: z.string().min(1).max(1_000).optional(),
    limit: z.number().int().min(1).max(50).optional().default(10),
    include: z
      .array(z.enum(['content', 'metadata']))
      .optional()
      .default([]),
  })
  .strict();
export type SourceSearchInput = z.infer<typeof sourceSearchSchema>;
