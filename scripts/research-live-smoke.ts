import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { processResearchJob } from '../apps/worker/src/runner.ts';
import {
  chunks,
  createDatabase,
  jobs,
  researchRuns,
  sources,
  users,
  workspaces,
} from '../packages/db/src/index.ts';

type SqlResult = unknown[] | { rows?: unknown[] };

function rowsFrom(result: SqlResult): unknown[] {
  return Array.isArray(result) ? result : (result.rows ?? []);
}

function short(value: unknown, max = 120): string {
  return String(value ?? '').slice(0, max);
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

  // This smoke verifies indexing + embeddings. Contextual prefixes are skipped
  // to avoid many live Anthropic calls during repeatable QA.
  process.env.ANTHROPIC_API_KEY = '';

  const db = createDatabase({ url: process.env.DATABASE_URL });
  const stamp = new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, '')
    .slice(0, 14);
  const slug = `smoke-research-${stamp}-${randomUUID().slice(0, 8)}`;
  const email = `${slug}@mnemis.local`;

  const [user] = await db.insert(users).values({ email, name: 'research smoke' }).returning();
  if (!user) throw new Error('failed to create smoke user');

  const [workspace] = await db
    .insert(workspaces)
    .values({ slug, name: slug, ownerId: user.id })
    .returning();
  if (!workspace) throw new Error('failed to create smoke workspace');

  const config = {
    depth: 'quick',
    maxSources: 3,
    includeWeb: false,
    includePapers: false,
    includePdfs: true,
    index: true,
    urls: [
      'https://react.dev/reference/react/useActionState',
      'https://blog.logrocket.com/react-useactionstate/',
      'https://arxiv.org/pdf/1706.03762',
    ],
  };

  const [run] = await db
    .insert(researchRuns)
    .values({
      workspaceId: workspace.id,
      query: 'research smoke: React useActionState docs blog and transformer PDF',
      depth: 'quick',
      status: 'queued',
      config,
    })
    .returning();
  if (!run) throw new Error('failed to create research run');

  const [job] = await db
    .insert(jobs)
    .values({
      workspaceId: workspace.id,
      kind: 'research_run',
      status: 'queued',
      payload: { research_run_id: run.id, query: run.query, config },
    })
    .returning();
  if (!job) throw new Error('failed to create research job');

  await db
    .update(jobs)
    .set({
      status: 'processing',
      startedAt: new Date(),
      attempts: sql`${jobs.attempts} + 1`,
      progress: { done: 0, total: null, current: 'claiming' },
    })
    .where(eq(jobs.id, job.id));

  await processResearchJob(db, job.id);
  const [finished] = await db
    .select()
    .from(researchRuns)
    .where(eq(researchRuns.id, run.id))
    .limit(1);
  if (!finished) throw new Error('research run disappeared');

  const sourceSummary = await db
    .select({
      id: sources.id,
      kind: sources.kind,
      identifier: sources.identifier,
      status: sources.status,
      chunkCount: sql<number>`count(${chunks.id})::int`,
      pages: sql<number>`count(distinct ${chunks.page}) filter (where ${chunks.page} is not null)::int`,
      embedded: sql<number>`count(${chunks.embedding})::int`,
    })
    .from(sources)
    .leftJoin(chunks, eq(chunks.sourceId, sources.id))
    .where(eq(sources.workspaceId, workspace.id))
    .groupBy(sources.id)
    .orderBy(sources.kind, sources.identifier);

  async function search(query: string) {
    const result = await db.execute(sql`
      select s.kind,
             s.identifier,
             c.path,
             c.page,
             ts_rank_cd(c.body_tsv, websearch_to_tsquery('english', ${query}))::float as score,
             left(c.raw_text, 260) as snippet
      from ${chunks} c
      join ${sources} s on s.id = c.source_id
      where c.workspace_id = ${workspace.id}
        and c.body_tsv @@ websearch_to_tsquery('english', ${query})
        and coalesce(c.metadata->>'retrieval_role', 'chunk') <> 'parent'
      order by score desc
      limit 5
    `);
    return rowsFrom(result as SqlResult);
  }

  const result = (finished.result ?? {}) as Record<string, unknown>;
  const indexed = Array.isArray(result.sources) ? result.sources : [];

  console.log(
    JSON.stringify(
      {
        workspace: { id: workspace.id, slug },
        job: { id: job.id, processed: true },
        run: {
          id: run.id,
          status: finished.status,
          error: finished.error,
          result: {
            candidates: result.candidates,
            indexed_sources: result.indexed_sources,
            failed_sources: result.failed_sources,
            issues: result.issues,
          },
        },
        sources: sourceSummary.map((source) => ({
          ...source,
          identifier: short(source.identifier),
        })),
        embeddings: indexed.map((entry) => {
          const item = entry as Record<string, unknown>;
          const indexing = (item.indexing ?? {}) as Record<string, unknown>;
          return {
            kind: item.source_kind,
            chunks: item.chunks,
            embedded: indexing.chunks_embedded,
            embeddingModels: indexing.embedding_model_counts,
            embeddingSkipped: indexing.embedding_skipped_reason,
            contextSkipped: indexing.contextual_prefix_skipped_reason,
          };
        }),
        search: {
          react: await search('useActionState form action state'),
          pdf: await search('attention heads decoder encoder'),
        },
      },
      null,
      2,
    ),
  );
}

await main();
process.exit(0);
