import { z } from 'zod';

const ISO_DATE = z.string().datetime({ offset: true });

export const memoryKindSchema = z.enum(['working', 'session', 'fact', 'procedural']);
export type MemoryKindInput = z.infer<typeof memoryKindSchema>;

/**
 * Default TTL (seconds) per memory kind. Matches Nia conventions.
 *  - working    → 1 hour
 *  - session    → 7 days
 *  - fact       → permanent (null)
 *  - procedural → permanent (null)
 */
export const TTL_DEFAULTS: Record<MemoryKindInput, number | null> = {
  working: 3_600,
  session: 7 * 24 * 3_600,
  fact: null,
  procedural: null,
};

const editedFileSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
  language: z.string().optional(),
});

const baseMemoryFields = {
  kind: memoryKindSchema,
  title: z.string().min(1).max(500),
  summary: z.string().min(1).max(2_000),
  body: z.string().min(1).max(200_000),
  tags: z.array(z.string().min(1).max(64)).max(64).optional(),
  directory: z.string().max(1024).optional(),
  fileOverlap: z.array(z.string().min(1).max(1024)).max(256).optional(),
  ttlSeconds: z.number().int().nonnegative().nullable().optional(),
  agentOrigin: z.string().max(64).optional(),
  sourceIds: z.array(z.string().uuid()).max(64).optional(),
  derivedFrom: z.string().uuid().nullable().optional(),
  confidence: z.number().min(0).max(1).optional(),
  toolCalls: z.array(z.unknown()).optional(),
  modelVersion: z.string().max(128).optional(),
  editedFiles: z.array(editedFileSchema).max(64).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
};

export const createMemorySchema = z.object(baseMemoryFields).strict();
export type CreateMemoryInput = z.infer<typeof createMemorySchema>;

/**
 * PATCH is intentionally metadata-only (Mem0 v3 ADD-only spirit).
 * Body / title / summary cannot be mutated — create a new memory with
 * `derivedFrom: <old_id>` instead.
 */
export const patchMemorySchema = z
  .object({
    kind: memoryKindSchema.optional(),
    tags: z.array(z.string().min(1).max(64)).max(64).optional(),
    ttlSeconds: z.number().int().nonnegative().nullable().optional(),
    archived: z.boolean().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field required' });

export const listMemoriesQuerySchema = z.object({
  kind: memoryKindSchema.optional(),
  tag: z.string().min(1).optional(), // single tag filter, repeatable as ?tag=a&tag=b later
  directory: z.string().min(1).optional(),
  agent_origin: z.string().min(1).optional(),
  q: z.string().min(1).max(500).optional(),
  include_archived: z.coerce.boolean().optional().default(false),
  include_expired: z.coerce.boolean().optional().default(false),
  include: z.string().optional(), // comma-separated: lineage,embedding
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
  created_after: ISO_DATE.optional(),
  created_before: ISO_DATE.optional(),
});

export const searchBodySchema = z.object({
  query: z.string().min(1).max(1_000),
  kind: memoryKindSchema.optional(),
  tags: z.array(z.string()).max(32).optional(),
  directory: z.string().optional(),
  limit: z.number().int().min(1).max(50).optional().default(20),
  include: z.array(z.enum(['lineage', 'embedding'])).optional(),
});
export type SearchBody = z.infer<typeof searchBodySchema>;

export function parseInclude(raw?: string): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}
