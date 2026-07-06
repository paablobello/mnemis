import { z } from 'zod';

export const researchDepthSchema = z.enum(['quick', 'standard', 'deep']);
export type ResearchDepthInput = z.infer<typeof researchDepthSchema>;

export const researchRunStatusSchema = z.enum(['queued', 'processing', 'completed', 'failed']);
export type ResearchRunStatusInput = z.infer<typeof researchRunStatusSchema>;

export const createResearchRunSchema = z
  .object({
    query: z.string().min(1).max(2_000),
    depth: researchDepthSchema.optional().default('standard'),
    maxSources: z.number().int().min(1).max(50).optional().default(12),
    includeWeb: z.boolean().optional().default(true),
    includeGithub: z.boolean().optional().default(true),
    includePapers: z.boolean().optional().default(true),
    includePdfs: z.boolean().optional().default(true),
    index: z.boolean().optional().default(true),
    urls: z.array(z.string().url().max(2_000)).max(50).optional().default([]),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      !value.includeWeb &&
      !value.includeGithub &&
      !value.includePapers &&
      value.urls.length === 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['includeWeb'],
        message: 'At least one discovery source or seed URL is required',
      });
    }
  });
export type CreateResearchRunInput = z.infer<typeof createResearchRunSchema>;

export const listResearchRunsQuerySchema = z.object({
  status: researchRunStatusSchema.optional(),
  q: z.string().min(1).max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
});
export type ListResearchRunsQuery = z.infer<typeof listResearchRunsQuerySchema>;
