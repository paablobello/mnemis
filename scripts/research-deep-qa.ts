import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { applyContextualPrefixes } from '../apps/worker/src/contextual-prefix.ts';
import { type ResearchRunConfig, discoverResearchCandidates } from '../apps/worker/src/research.ts';
import { processResearchJob } from '../apps/worker/src/runner.ts';
import {
  chunks,
  createDatabase,
  jobs,
  researchRunSources,
  researchRuns,
  sources,
  users,
  workspaces,
} from '../packages/db/src/index.ts';
import {
  type IndexChunk,
  type LoadedFile,
  buildDocsSiteIndex,
  buildPdfDocumentIndex,
  buildWebPageIndex,
} from '../packages/indexer/src/index.ts';

type SqlResult = unknown[] | { rows?: unknown[] };

interface CheckResult {
  name: string;
  ok: boolean;
  durationMs: number;
  summary: Record<string, unknown>;
  error?: string;
}

interface RunConfigInput {
  name: string;
  query: string;
  config: ResearchRunConfig;
}

function rowsFrom(result: SqlResult): unknown[] {
  return Array.isArray(result) ? result : (result.rows ?? []);
}

function short(value: unknown, max = 180): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function envSet(name: string): boolean {
  return !!process.env[name]?.trim();
}

function providerCounts(candidates: Array<{ provider: string }>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const candidate of candidates) {
    for (const provider of candidate.provider.split(',').map((item) => item.trim())) {
      counts[provider] = (counts[provider] ?? 0) + 1;
    }
  }
  return counts;
}

function firstFileMetadata(files: Array<{ metadata?: Record<string, unknown> }>) {
  return files[0]?.metadata ?? {};
}

async function timed(
  name: string,
  fn: () => Promise<Record<string, unknown>>,
): Promise<CheckResult> {
  const started = Date.now();
  console.error(`[deep-qa] start ${name}`);
  try {
    const summary = await fn();
    console.error(`[deep-qa] pass ${name} ${Date.now() - started}ms`);
    return {
      name,
      ok: true,
      durationMs: Date.now() - started,
      summary,
    };
  } catch (err) {
    console.error(`[deep-qa] fail ${name} ${Date.now() - started}ms`);
    return {
      name,
      ok: false,
      durationMs: Date.now() - started,
      summary: {},
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function health(url: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(url.replace(/\/extract$/, '/health'));
    return res.ok ? ((await res.json()) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function chunkStats(result: { files: LoadedFile[]; chunks: IndexChunk[] }) {
  const metadata = firstFileMetadata(result.files);
  return {
    files: result.files.length,
    chunks: result.chunks.length,
    chars: result.files.reduce((total, file) => total + file.content.length, 0),
    pages: new Set(result.files.map((file) => file.page).filter(Boolean)).size,
    crawler_provider: metadata.crawler_provider ?? null,
    pdf_extractor: metadata.pdf_extractor ?? null,
    pdf_auto_decision: metadata.pdf_auto_decision ?? null,
    sample_path: result.files[0]?.path ?? null,
    sample_title: short(result.files[0]?.content.split('\n')[0] ?? ''),
  };
}

async function createWorkspace() {
  const db = createDatabase({ url: process.env.DATABASE_URL! });
  const stamp = new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, '')
    .slice(0, 14);
  const slug = `deep-research-qa-${stamp}-${randomUUID().slice(0, 8)}`;
  const [user] = await db
    .insert(users)
    .values({ email: `${slug}@mnemis.local`, name: 'deep research QA' })
    .returning();
  if (!user) throw new Error('failed to create QA user');
  const [workspace] = await db
    .insert(workspaces)
    .values({ slug, name: slug, ownerId: user.id })
    .returning();
  if (!workspace) throw new Error('failed to create QA workspace');
  return { db, user, workspace };
}

async function runResearchJob(input: RunConfigInput & { workspaceId: string }) {
  const db = createDatabase({ url: process.env.DATABASE_URL! });
  const [run] = await db
    .insert(researchRuns)
    .values({
      workspaceId: input.workspaceId,
      query: input.query,
      depth: input.config.depth,
      status: 'queued',
      config: input.config,
    })
    .returning();
  if (!run) throw new Error(`failed to create run: ${input.name}`);

  const [job] = await db
    .insert(jobs)
    .values({
      workspaceId: input.workspaceId,
      kind: 'research_run',
      status: 'queued',
      payload: { research_run_id: run.id, query: input.query, config: input.config },
    })
    .returning();
  if (!job) throw new Error(`failed to create job: ${input.name}`);

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
  if (!finished) throw new Error(`research run disappeared: ${input.name}`);

  const links = await db
    .select()
    .from(researchRunSources)
    .where(eq(researchRunSources.researchRunId, run.id));

  const result = (finished.result ?? {}) as Record<string, unknown>;
  const sourcesResult = Array.isArray(result.sources) ? result.sources : [];
  const failedResult = Array.isArray(result.failures) ? result.failures : [];

  return {
    run_id: run.id,
    job_id: job.id,
    processed: true,
    status: finished.status,
    error: finished.error,
    candidates: result.candidates ?? null,
    indexed_sources: result.indexed_sources ?? null,
    failed_sources: result.failed_sources ?? null,
    issues: result.issues ?? [],
    link_statuses: links.reduce<Record<string, number>>((counts, link) => {
      counts[link.status] = (counts[link.status] ?? 0) + 1;
      return counts;
    }, {}),
    indexed: sourcesResult.map((entry) => {
      const row = entry as Record<string, unknown>;
      const indexing = (row.indexing ?? {}) as Record<string, unknown>;
      const candidate = (row.candidate ?? {}) as Record<string, unknown>;
      return {
        kind: row.source_kind,
        identifier: short(row.identifier, 120),
        provider: candidate.provider,
        chunks: row.chunks,
        embedded: indexing.chunks_embedded,
        pdf_extractor: indexing.pdf_extractor,
        embedding_models: indexing.embedding_model_counts,
      };
    }),
    failed: failedResult.map((entry) => {
      const row = entry as Record<string, unknown>;
      const candidate = (row.candidate ?? {}) as Record<string, unknown>;
      return {
        kind: row.source_kind,
        identifier: short(row.identifier, 120),
        provider: candidate.provider,
        error: short(row.error, 180),
      };
    }),
  };
}

async function searchWorkspace(workspaceId: string, query: string) {
  const db = createDatabase({ url: process.env.DATABASE_URL! });
  const result = await db.execute(sql`
    select s.kind,
           s.identifier,
           c.path,
           c.page,
           c.metadata->>'crawler_provider' as crawler_provider,
           c.metadata->>'pdf_extractor' as pdf_extractor,
           ts_rank_cd(c.body_tsv, websearch_to_tsquery('english', ${query}))::float as score,
           left(c.raw_text, 280) as snippet
    from ${chunks} c
    join ${sources} s on s.id = c.source_id
    where c.workspace_id = ${workspaceId}
      and c.body_tsv @@ websearch_to_tsquery('english', ${query})
      and coalesce(c.metadata->>'retrieval_role', 'chunk') <> 'parent'
    order by score desc
    limit 6
  `);
  return rowsFrom(result as SqlResult).map((row) => {
    const record = row as Record<string, unknown>;
    return {
      kind: record.kind,
      identifier: short(record.identifier, 100),
      path: record.path,
      page: record.page,
      crawler_provider: record.crawler_provider,
      pdf_extractor: record.pdf_extractor,
      score: record.score,
      snippet: short(record.snippet, 220),
    };
  });
}

async function sourceSummary(workspaceId: string) {
  const db = createDatabase({ url: process.env.DATABASE_URL! });
  return db
    .select({
      kind: sources.kind,
      identifier: sources.identifier,
      status: sources.status,
      chunkCount: sql<number>`count(${chunks.id})::int`,
      pages: sql<number>`count(distinct ${chunks.page}) filter (where ${chunks.page} is not null)::int`,
      embedded: sql<number>`count(${chunks.embedding})::int`,
      crawlerProvider: sql<string | null>`max(${chunks.metadata}->>'crawler_provider')`,
      pdfExtractor: sql<string | null>`max(${chunks.metadata}->>'pdf_extractor')`,
    })
    .from(sources)
    .leftJoin(chunks, eq(chunks.sourceId, sources.id))
    .where(eq(sources.workspaceId, workspaceId))
    .groupBy(sources.id)
    .orderBy(sources.kind, sources.identifier);
}

async function contextualPrefixSmoke() {
  const content = [
    '# RAG evaluation',
    '',
    'Modern research agents should discover sources, index PDFs and blogs, and cite page-level evidence.',
    'A retrieval benchmark should verify source quality, citations, embeddings, and provider fallback behavior.',
  ].join('\n');
  const file: LoadedFile = {
    path: 'qa-context.md',
    absolutePath: 'qa-context.md',
    content,
    language: 'markdown',
    byteLength: new TextEncoder().encode(content).byteLength,
    modifiedAt: new Date(),
  };
  const chunk: IndexChunk = {
    path: file.path,
    lineStart: 1,
    lineEnd: 4,
    rawText: content,
    contextualPrefix: null,
    language: 'markdown',
    sectionPath: ['RAG evaluation'],
    metadata: {},
  };
  const result = await applyContextualPrefixes({
    sourceKind: 'docs_site',
    files: [file],
    chunks: [chunk],
    config: {
      contextualPrefixMode: 'always',
      contextualPrefixMaxDocumentChars: 2_000,
      contextualPrefixMaxChunkChars: 800,
    },
  });
  return {
    generated: result.stats.generated,
    eligible: result.stats.eligible,
    skipped: result.stats.skipped,
    skippedReason: result.stats.skippedReason,
    model: result.stats.model,
    sample: short(result.chunks[0]?.contextualPrefix, 220),
  };
}

function markdownReport(input: {
  env: Record<string, boolean>;
  pdfHealth: Record<string, unknown> | null;
  checks: CheckResult[];
  workspaceId: string;
  workspaceSlug: string;
  sources: Awaited<ReturnType<typeof sourceSummary>>;
  searches: Record<string, unknown[]>;
  hardFailures: string[];
}) {
  const lines: string[] = [];
  lines.push(`# Deep Research QA - ${new Date().toISOString().slice(0, 10)}`);
  lines.push('');
  lines.push(`Workspace: \`${input.workspaceSlug}\` / \`${input.workspaceId}\``);
  lines.push('');
  lines.push('## Environment');
  for (const [name, isSet] of Object.entries(input.env)) {
    lines.push(`- \`${name}\`: ${isSet ? 'set' : 'empty'}`);
  }
  lines.push(`- PDF sidecar health: \`${JSON.stringify(input.pdfHealth)}\``);
  lines.push('');
  lines.push('## Checks');
  for (const check of input.checks) {
    lines.push(`### ${check.ok ? 'PASS' : 'FAIL'} - ${check.name}`);
    lines.push(`- Duration: ${check.durationMs}ms`);
    if (check.error) lines.push(`- Error: \`${short(check.error, 500)}\``);
    lines.push('');
    lines.push('```json');
    lines.push(JSON.stringify(check.summary, null, 2));
    lines.push('```');
    lines.push('');
  }
  lines.push('## Indexed Sources');
  for (const source of input.sources) {
    lines.push(
      `- \`${source.kind}\` ${short(source.identifier, 120)}: status=${source.status}, chunks=${source.chunkCount}, pages=${source.pages}, embedded=${source.embedded}, crawler=${source.crawlerProvider ?? 'n/a'}, pdf=${source.pdfExtractor ?? 'n/a'}`,
    );
  }
  lines.push('');
  lines.push('## Search Checks');
  for (const [query, rows] of Object.entries(input.searches)) {
    lines.push(`### ${query}`);
    lines.push('');
    lines.push('```json');
    lines.push(JSON.stringify(rows, null, 2));
    lines.push('```');
    lines.push('');
  }
  lines.push('## Hard Failures');
  if (input.hardFailures.length === 0) {
    lines.push('- None.');
  } else {
    for (const failure of input.hardFailures) lines.push(`- ${failure}`);
  }
  lines.push('');
  lines.push('## Distilled Assessment');
  lines.push(
    '- Discovery and extraction are intentionally separated: Tavily/Exa/OpenAlex/arXiv/Crossref find candidates; Firecrawl/Docling/native extractors turn selected URLs into indexed chunks.',
  );
  lines.push(
    '- PDF `auto` mode is latency-first: native text extraction handles text-rich papers, while the Docling/GROBID sidecar is reserved for sparse/scanned PDFs or explicit `pdfExtractor=sidecar` runs.',
  );
  lines.push(
    '- A user research flow should prefer `includeWeb=true`, `includePapers=true`, `includePdfs=true`, `index=true`, and a modest `maxSources` first; then expand or force premium PDF extraction only if results are weak.',
  );
  lines.push(
    '- Critical quality signals are: multiple providers represented, sources indexed despite provider failures, page metadata on PDFs, crawler/extractor metadata on chunks, and search hits from the indexed workspace.',
  );
  return lines.join('\n');
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

  const env = {
    TAVILY_API_KEY: envSet('TAVILY_API_KEY') || envSet('MNEMIS_TAVILY_API_KEY'),
    EXA_API_KEY: envSet('EXA_API_KEY') || envSet('MNEMIS_EXA_API_KEY'),
    FIRECRAWL_API_KEY: envSet('FIRECRAWL_API_KEY'),
    OPENALEX_EMAIL: envSet('OPENALEX_EMAIL'),
    SEMANTIC_SCHOLAR_API_KEY: envSet('SEMANTIC_SCHOLAR_API_KEY'),
    VOYAGE_API_KEY: envSet('VOYAGE_API_KEY'),
    ANTHROPIC_API_KEY: envSet('ANTHROPIC_API_KEY'),
    MNEMIS_PDF_EXTRACTOR_URL: envSet('MNEMIS_PDF_EXTRACTOR_URL'),
    MNEMIS_DEEP_QA_FORCE_SIDECAR: envSet('MNEMIS_DEEP_QA_FORCE_SIDECAR'),
  };
  const pdfHealth = process.env.MNEMIS_PDF_EXTRACTOR_URL
    ? await health(process.env.MNEMIS_PDF_EXTRACTOR_URL)
    : null;
  const checks: CheckResult[] = [];

  checks.push(
    await timed('web discovery: Tavily + Exa candidates', async () => {
      const config: ResearchRunConfig = {
        depth: 'standard',
        maxSources: 12,
        includeWeb: true,
        includeGithub: false,
        includePapers: false,
        includePdfs: true,
        index: false,
        urls: [],
      };
      const result = await discoverResearchCandidates({
        query: 'React 19 useActionState server actions form state technical guide',
        config,
      });
      return {
        candidates: result.candidates.length,
        providers: providerCounts(result.candidates),
        issues: result.issues,
        top: result.candidates.slice(0, 5).map((candidate) => ({
          provider: candidate.provider,
          kind: candidate.kind,
          title: short(candidate.title, 100),
          url: short(candidate.url, 120),
        })),
      };
    }),
  );

  checks.push(
    await timed('academic discovery: papers and PDFs', async () => {
      const config: ResearchRunConfig = {
        depth: 'standard',
        maxSources: 12,
        includeWeb: false,
        includeGithub: false,
        includePapers: true,
        includePdfs: true,
        index: false,
        urls: [],
      };
      const result = await discoverResearchCandidates({
        query: 'retrieval augmented generation evaluation reranking citations 2025',
        config,
      });
      return {
        candidates: result.candidates.length,
        providers: providerCounts(result.candidates),
        issues: result.issues,
        top: result.candidates.slice(0, 6).map((candidate) => ({
          provider: candidate.provider,
          title: short(candidate.title, 100),
          pdfUrl: short(candidate.pdfUrl, 120),
          doi: candidate.doi ?? null,
          year: candidate.year ?? null,
        })),
      };
    }),
  );

  checks.push(
    await timed('direct index: React docs web page', async () =>
      chunkStats(
        await buildWebPageIndex('https://react.dev/reference/react/useActionState', {
          docsCrawler: 'auto',
        }),
      ),
    ),
  );

  checks.push(
    await timed('direct index: technical blog web page', async () =>
      chunkStats(
        await buildWebPageIndex('https://blog.logrocket.com/react-useactionstate/', {
          docsCrawler: 'auto',
        }),
      ),
    ),
  );

  checks.push(
    await timed('direct index: docs site crawl', async () =>
      chunkStats(
        await buildDocsSiteIndex('https://docs.firecrawl.dev/api-reference/endpoint/scrape', {
          docsCrawler: 'auto',
          maxPages: 4,
        }),
      ),
    ),
  );

  checks.push(
    await timed('direct index: arXiv PDF auto fast path', async () =>
      chunkStats(
        await buildPdfDocumentIndex('https://arxiv.org/pdf/1706.03762', {
          pdfExtractor: 'auto',
        }),
      ),
    ),
  );

  if (process.env.MNEMIS_DEEP_QA_FORCE_SIDECAR === 'true') {
    checks.push(
      await timed('direct index: arXiv PDF sidecar forced', async () =>
        chunkStats(
          await buildPdfDocumentIndex('https://arxiv.org/pdf/1706.03762', {
            pdfExtractor: 'sidecar',
          }),
        ),
      ),
    );
  }

  checks.push(
    await timed('live contextual prefix: one chunk', async () =>
      env.ANTHROPIC_API_KEY
        ? await contextualPrefixSmoke()
        : {
            generated: 0,
            skippedReason: 'ANTHROPIC_API_KEY is not configured',
          },
    ),
  );

  const { workspace } = await createWorkspace();
  const runs: RunConfigInput[] = [
    {
      name: 'seed URLs: docs + blog + PDF',
      query: 'research QA seed URLs for React forms and Transformer paper',
      config: {
        depth: 'quick',
        maxSources: 3,
        includeWeb: false,
        includeGithub: false,
        includePapers: false,
        includePdfs: true,
        index: true,
        urls: [
          'https://react.dev/reference/react/useActionState',
          'https://blog.logrocket.com/react-useactionstate/',
          'https://arxiv.org/pdf/1706.03762',
        ],
      },
    },
    {
      name: 'web discovery + indexing',
      query: 'React 19 useActionState server actions form state technical guide',
      config: {
        depth: 'standard',
        maxSources: 4,
        includeWeb: true,
        includeGithub: false,
        includePapers: false,
        includePdfs: false,
        index: true,
        urls: [],
      },
    },
    {
      name: 'academic paper discovery + indexing (bounded)',
      query: 'Attention Is All You Need Vaswani transformer arXiv 2017',
      config: {
        depth: 'quick',
        maxSources: 1,
        includeWeb: false,
        includeGithub: false,
        includePapers: true,
        includePdfs: true,
        index: true,
        urls: [],
      },
    },
  ];

  for (const run of runs) {
    checks.push(
      await timed(`research run: ${run.name}`, async () =>
        runResearchJob({ ...run, workspaceId: workspace.id }),
      ),
    );
  }

  const sourcesIndexed = await sourceSummary(workspace.id);
  const searches = {
    'useActionState form action state': await searchWorkspace(
      workspace.id,
      'useActionState form action state',
    ),
    'attention heads decoder encoder': await searchWorkspace(
      workspace.id,
      'attention heads decoder encoder',
    ),
    'retrieval augmented generation reranking citations': await searchWorkspace(
      workspace.id,
      'retrieval augmented generation reranking citations',
    ),
  };

  const hardFailures: string[] = [];
  for (const check of checks) {
    if (!check.ok) hardFailures.push(`${check.name}: ${check.error}`);
  }
  for (const check of checks.filter((item) => item.name.startsWith('research run:'))) {
    if (check.ok && check.summary.status !== 'completed') {
      hardFailures.push(`${check.name}: run status was ${String(check.summary.status)}`);
    }
  }
  const webDiscovery = checks.find((check) => check.name.startsWith('web discovery'));
  const webProviders = (webDiscovery?.summary.providers ?? {}) as Record<string, number>;
  if (!webProviders.tavily) hardFailures.push('Tavily did not return web candidates');
  if (!webProviders.exa) hardFailures.push('Exa did not return web candidates');
  const directWebChecks = checks.filter(
    (check) =>
      check.name.startsWith('direct index: React docs') ||
      check.name.startsWith('direct index: technical blog') ||
      check.name.startsWith('direct index: docs site'),
  );
  if (
    env.FIRECRAWL_API_KEY &&
    directWebChecks.some((check) => check.summary.crawler_provider !== 'firecrawl')
  ) {
    hardFailures.push(
      'A direct web/docs index check did not use Firecrawl despite FIRECRAWL_API_KEY',
    );
  }
  const directPdf = checks.find((check) => check.name === 'direct index: arXiv PDF auto fast path');
  if (
    directPdf?.ok &&
    !['unpdf', 'sidecar'].includes(String(directPdf.summary.pdf_extractor ?? ''))
  ) {
    hardFailures.push('Direct PDF indexing did not record a PDF extractor');
  }
  if (
    directPdf?.ok &&
    directPdf.summary.pdf_extractor === 'unpdf' &&
    directPdf.summary.pdf_auto_decision !== 'native_text_sufficient'
  ) {
    hardFailures.push(
      'Direct PDF auto mode used native extraction without a sufficient-text decision',
    );
  }
  if (!sourcesIndexed.some((source) => source.kind === 'pdf_document' && source.pages > 0)) {
    hardFailures.push('No indexed PDF source has page metadata');
  }
  if (!Object.values(searches).some((rows) => rows.length > 0)) {
    hardFailures.push('Workspace searches returned no hits');
  }

  const report = markdownReport({
    env,
    pdfHealth,
    checks,
    workspaceId: workspace.id,
    workspaceSlug: workspace.slug,
    sources: sourcesIndexed,
    searches,
    hardFailures,
  });
  const reportPath = join(process.cwd(), 'reports', '2026-05-21-deep-research-qa.md');
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, report);

  console.log(
    JSON.stringify(
      {
        reportPath,
        hardFailures,
        checks: checks.map((check) => ({
          name: check.name,
          ok: check.ok,
          durationMs: check.durationMs,
          error: check.error,
          summary: check.summary,
        })),
      },
      null,
      2,
    ),
  );

  if (hardFailures.length > 0) process.exitCode = 1;
}

await main();
