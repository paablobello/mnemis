/**
 * Hybrid retrieval over memories.
 *
 *   - BM25 path: Postgres tsvector + websearch_to_tsquery + ts_rank_cd
 *   - Vector path: pgvector cosine distance (`<=>`) on the precomputed embedding
 *   - Fusion: Reciprocal Rank Fusion (RRF, k=60). Robust, no normalisation needed.
 *
 * `searchKeyword` returns BM25-only results (no embedding required).
 * `searchHybrid` returns RRF-fused results and degrades gracefully to BM25
 * alone when embeddings are disabled (no VOYAGE_API_KEY) or when the corpus
 * has no rows with embeddings yet.
 */
import { type Memory, memories } from '@mnemis/db';
import {
  type SQL,
  and,
  arrayOverlaps,
  eq,
  gt,
  inArray,
  isNull,
  notInArray,
  or,
  sql,
} from 'drizzle-orm';
import { getDb } from '../db.ts';
import type { MemoryKindInput } from '../validators/memories.ts';
import { getEmbeddings } from './embeddings.ts';

const RRF_K = 60;
const POOL_PER_RETRIEVER = 50;

export interface SearchFilters {
  kind?: MemoryKindInput;
  tags?: string[];
  directory?: string;
}

export interface SearchHit {
  memory: Memory;
  score: number; // RRF (hybrid) or normalised ts_rank (keyword)
  ranks: { bm25: number | null; vector: number | null };
  bm25_score: number | null;
  vector_score: number | null;
}

function buildBaseFilters(workspaceId: string, f: SearchFilters): SQL<unknown> {
  const clauses: SQL<unknown>[] = [
    eq(memories.workspaceId, workspaceId),
    isNull(memories.archivedAt),
    or(isNull(memories.expiresAt), gt(memories.expiresAt, sql`now()`)) as SQL<unknown>,
  ];
  if (f.kind) clauses.push(eq(memories.kind, f.kind));
  if (f.directory) clauses.push(eq(memories.directory, f.directory));
  if (f.tags && f.tags.length > 0) {
    clauses.push(arrayOverlaps(memories.tags, f.tags));
  }
  return and(...clauses) as SQL<unknown>;
}

/* ----------------------------------------------------------------------------
 *  BM25 (Postgres FTS)
 * --------------------------------------------------------------------------*/
function broadLexicalQuery(query: string): string | null {
  const terms = query.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}_-]{2,}/gu) ?? [];
  const unique = [...new Set(terms)].slice(0, 16);
  if (unique.length <= 1) return null;
  return unique.join(' OR ');
}

async function bm25Lookup(
  workspaceId: string,
  query: string,
  filters: SearchFilters,
  limit: number,
): Promise<{ id: string; score: number }[]> {
  const db = getDb();
  const base = buildBaseFilters(workspaceId, filters);
  const strictRows = await db
    .select({
      id: memories.id,
      score: sql<number>`ts_rank_cd(${memories.bodyTsv}, websearch_to_tsquery('english', ${query}))::float`,
    })
    .from(memories)
    .where(
      and(
        base,
        sql`${memories.bodyTsv} @@ websearch_to_tsquery('english', ${query})`,
      ) as SQL<unknown>,
    )
    .orderBy(sql`ts_rank_cd(${memories.bodyTsv}, websearch_to_tsquery('english', ${query})) desc`)
    .limit(limit);

  if (strictRows.length >= limit) return strictRows;

  const broad = broadLexicalQuery(query);
  if (!broad) return strictRows;

  const existingIds = strictRows.map((row) => row.id);
  const excludeExisting = existingIds.length > 0 ? notInArray(memories.id, existingIds) : undefined;
  const broadRows = await db
    .select({
      id: memories.id,
      score: sql<number>`ts_rank_cd(${memories.bodyTsv}, websearch_to_tsquery('english', ${broad}))::float`,
    })
    .from(memories)
    .where(
      and(
        base,
        excludeExisting,
        sql`${memories.bodyTsv} @@ websearch_to_tsquery('english', ${broad})`,
      ) as SQL<unknown>,
    )
    .orderBy(sql`ts_rank_cd(${memories.bodyTsv}, websearch_to_tsquery('english', ${broad})) desc`)
    .limit(limit - strictRows.length);

  return [...strictRows, ...broadRows];
}

/* ----------------------------------------------------------------------------
 *  Vector (pgvector cosine)
 * --------------------------------------------------------------------------*/
async function vectorLookup(
  workspaceId: string,
  qvec: number[],
  filters: SearchFilters,
  limit: number,
): Promise<{ id: string; score: number }[]> {
  const db = getDb();
  const base = buildBaseFilters(workspaceId, filters);
  const literal = `[${qvec.join(',')}]`;
  const rows = await db
    .select({
      id: memories.id,
      // 1 - cosine_distance => similarity in [-1, 1]; for our purposes, higher = better
      score: sql<number>`(1 - (${memories.embedding} <=> ${literal}::vector))::float`,
    })
    .from(memories)
    .where(and(base, sql`${memories.embedding} IS NOT NULL`) as SQL<unknown>)
    .orderBy(sql`${memories.embedding} <=> ${literal}::vector`)
    .limit(limit);
  return rows;
}

/* ----------------------------------------------------------------------------
 *  Fetch full memories by id (preserves order)
 * --------------------------------------------------------------------------*/
async function loadByIds(workspaceId: string, ids: string[]): Promise<Map<string, Memory>> {
  if (ids.length === 0) return new Map();
  const db = getDb();
  const rows = await db
    .select()
    .from(memories)
    .where(and(eq(memories.workspaceId, workspaceId), inArray(memories.id, ids)) as SQL<unknown>);
  const map = new Map<string, Memory>();
  for (const m of rows) map.set(m.id, m);
  return map;
}

/* ----------------------------------------------------------------------------
 *  Public: keyword-only search
 * --------------------------------------------------------------------------*/
export async function searchKeyword(
  workspaceId: string,
  query: string,
  filters: SearchFilters,
  limit: number,
): Promise<SearchHit[]> {
  const bm25 = await bm25Lookup(workspaceId, query, filters, Math.max(limit, POOL_PER_RETRIEVER));
  if (bm25.length === 0) return [];
  const ids = bm25.slice(0, limit).map((r) => r.id);
  const loaded = await loadByIds(workspaceId, ids);
  const hits: SearchHit[] = [];
  ids.forEach((id, i) => {
    const memory = loaded.get(id);
    if (!memory) return;
    const score = bm25[i]!.score;
    hits.push({
      memory,
      score,
      ranks: { bm25: i + 1, vector: null },
      bm25_score: score,
      vector_score: null,
    });
  });
  return hits;
}

/* ----------------------------------------------------------------------------
 *  Public: hybrid (BM25 + vector) with RRF
 * --------------------------------------------------------------------------*/
export interface HybridResult {
  hits: SearchHit[];
  used_vector: boolean;
  embedding_model: string | null;
  embedding_tokens: number;
}

export async function searchHybrid(
  workspaceId: string,
  query: string,
  filters: SearchFilters,
  limit: number,
): Promise<HybridResult> {
  const embedClient = getEmbeddings();

  let qvec: number[] | null = null;
  let model: string | null = null;
  let tokens = 0;
  if (embedClient) {
    const embed = await embedClient.embed(query, { inputType: 'query' });
    qvec = embed.vector;
    model = embed.model;
    tokens = embed.tokens;
  }

  const [bm25, vec] = await Promise.all([
    bm25Lookup(workspaceId, query, filters, POOL_PER_RETRIEVER),
    qvec ? vectorLookup(workspaceId, qvec, filters, POOL_PER_RETRIEVER) : Promise.resolve([]),
  ]);

  const fused = new Map<
    string,
    { rrf: number; bm25Rank?: number; vecRank?: number; bm25Score?: number; vecScore?: number }
  >();
  bm25.forEach((row, i) => {
    const cur = fused.get(row.id) ?? { rrf: 0 };
    cur.rrf += 1 / (RRF_K + i + 1);
    cur.bm25Rank = i + 1;
    cur.bm25Score = row.score;
    fused.set(row.id, cur);
  });
  vec.forEach((row, i) => {
    const cur = fused.get(row.id) ?? { rrf: 0 };
    cur.rrf += 1 / (RRF_K + i + 1);
    cur.vecRank = i + 1;
    cur.vecScore = row.score;
    fused.set(row.id, cur);
  });

  const ranked = [...fused.entries()].sort((a, b) => b[1].rrf - a[1].rrf).slice(0, limit);

  const ids = ranked.map(([id]) => id);
  const loaded = await loadByIds(workspaceId, ids);

  const hits: SearchHit[] = [];
  for (const [id, info] of ranked) {
    const memory = loaded.get(id);
    if (!memory) continue;
    hits.push({
      memory,
      score: info.rrf,
      ranks: { bm25: info.bm25Rank ?? null, vector: info.vecRank ?? null },
      bm25_score: info.bm25Score ?? null,
      vector_score: info.vecScore ?? null,
    });
  }

  return {
    hits,
    used_vector: qvec !== null,
    embedding_model: model,
    embedding_tokens: tokens,
  };
}
