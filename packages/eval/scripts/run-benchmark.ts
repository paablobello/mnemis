#!/usr/bin/env node
/**
 * Self-corpus benchmark: indexes the running Mnemis repo via the API, then
 * runs the curated queries from `data/mnemis-self/queries.json` against
 * `/v1/search` in keyword and hybrid modes (rerank is controlled by the
 * `MNEMIS_RERANK_PROVIDER` env var on the API).
 *
 * Prerequisites:
 *   - `bun run docker:up` and `bun run db:push` (or migrate) so the DB is fresh.
 *   - `bun run api:dev` and `bun run worker:dev` running.
 *   - MNEMIS_API_URL and MNEMIS_API_KEY pointing to that API with a workspace
 *     that has `sources:write` and `search:read` scopes.
 *   - MNEMIS_ALLOW_LOCAL_SOURCES=true in the worker env (the script indexes
 *     the local repo via config.localPath).
 *   - MNEMIS_BENCHMARK_REPO defaults to the parent of this script's directory.
 */
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MnemisApiError, type MnemisClient, createMnemisClient } from '@mnemis/sdk';
import { mean, mrrAt, ndcgAt, recallAt } from '../src/retrieval.ts';

interface QueryCase {
  id: string;
  query: string;
  relevant: Record<string, number>;
}

interface VariantStats {
  variant: string;
  ndcg10: number;
  mrr10: number;
  recall5: number;
}

const RETRIEVAL_VARIANTS: Array<{ name: string; retrieval: 'keyword' | 'hybrid' }> = [
  { name: 'keyword', retrieval: 'keyword' },
  { name: 'hybrid', retrieval: 'hybrid' },
];

const POLL_INTERVAL_MS = 1_500;
const POLL_TIMEOUT_MS = 5 * 60_000;

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = dirname(HERE);
const DATASET = resolve(PACKAGE_ROOT, 'data', 'mnemis-self', 'queries.json');
const REPO_ROOT = process.env.MNEMIS_BENCHMARK_REPO
  ? resolve(process.env.MNEMIS_BENCHMARK_REPO)
  : resolve(PACKAGE_ROOT, '..', '..');

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

async function ensureClient(): Promise<MnemisClient> {
  const apiUrl = process.env.MNEMIS_API_URL;
  const apiKey = process.env.MNEMIS_API_KEY;
  if (!apiUrl || !apiKey) {
    fail('Set MNEMIS_API_URL and MNEMIS_API_KEY to a workspace with sources:write + search:read');
  }
  return createMnemisClient({ apiUrl, apiKey });
}

async function loadQueries(): Promise<QueryCase[]> {
  const raw = await readFile(DATASET, 'utf8');
  return JSON.parse(raw) as QueryCase[];
}

async function waitForIndexed(client: MnemisClient, sourceId: string): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < POLL_TIMEOUT_MS) {
    const status = await client.sources.status(sourceId);
    if (status.source.status === 'indexed') return;
    if (status.source.status === 'failed') {
      fail(
        `Indexing failed: ${status.source.status_message ?? 'unknown reason'} (job result: ${JSON.stringify(
          status.latest_job?.result ?? null,
        )})`,
      );
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  fail(`Indexing did not finish within ${POLL_TIMEOUT_MS / 1000}s.`);
}

function ranksFromHits(
  hits: Array<{ path: string }>,
  relevant: Record<string, number>,
): { ranked: string[]; qrels: Record<string, number> } {
  const seen = new Set<string>();
  const ranked: string[] = [];
  for (const hit of hits) {
    if (seen.has(hit.path)) continue;
    seen.add(hit.path);
    ranked.push(hit.path);
  }
  // qrels live on path keys; ensure every relevant path is present in qrels
  // even if it never appears in the ranking (recall denominator).
  return { ranked, qrels: { ...relevant } };
}

function table(rows: Array<Record<string, string | number>>): void {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]!);
  const widths = headers.map((h) =>
    Math.max(h.length, ...rows.map((r) => String(r[h] ?? '').length)),
  );
  const line = (cells: string[]): string => cells.map((c, i) => c.padEnd(widths[i]!)).join('  ');
  console.log(line(headers));
  console.log(line(widths.map((w) => '-'.repeat(w))));
  for (const row of rows) {
    console.log(line(headers.map((h) => String(row[h] ?? ''))));
  }
}

async function main(): Promise<void> {
  const client = await ensureClient();
  const queries = await loadQueries();
  const identifier = `mnemis/benchmark-${Date.now()}`;
  console.log(`Indexing local repo at ${REPO_ROOT} as source ${identifier}…`);

  let sourceId: string | null = null;
  try {
    const created = await client.sources.create({
      kind: 'github_repo',
      identifier,
      displayName: 'mnemis-benchmark',
      config: { localPath: REPO_ROOT },
      indexStrategy: 'manual',
      enqueue: true,
    });
    sourceId = created.data.id;
    console.log(`Source ${sourceId} created; waiting for indexing…`);
    await waitForIndexed(client, sourceId);
    console.log('Indexing complete. Running queries…');

    const stats: VariantStats[] = [];
    for (const variant of RETRIEVAL_VARIANTS) {
      const ndcg: number[] = [];
      const mrr: number[] = [];
      const recall: number[] = [];

      for (const q of queries) {
        const response = await client.search({
          query: q.query,
          retrieval: variant.retrieval,
          sourceIds: [sourceId],
          limit: 10,
          mode: 'raw',
          include: ['content'],
        });
        const { ranked, qrels } = ranksFromHits(response.items, q.relevant);
        ndcg.push(ndcgAt(ranked, qrels, 10));
        mrr.push(mrrAt(ranked, qrels, 10));
        recall.push(recallAt(ranked, qrels, 5));
      }

      stats.push({
        variant: variant.name,
        ndcg10: Number(mean(ndcg).toFixed(3)),
        mrr10: Number(mean(mrr).toFixed(3)),
        recall5: Number(mean(recall).toFixed(3)),
      });
    }

    const provider = process.env.MNEMIS_RERANK_PROVIDER ?? 'none';
    console.log(`\nRetrieval provider in effect on API: ${provider}\n`);
    table(stats);
  } catch (err) {
    if (err instanceof MnemisApiError) {
      fail(`API ${err.status} (${err.code}): ${err.message}`);
    }
    throw err;
  } finally {
    if (sourceId) {
      try {
        await client.raw.request({ method: 'DELETE', path: `/v1/sources/${sourceId}` });
      } catch {
        // Best effort cleanup; the worker may have running jobs.
      }
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
