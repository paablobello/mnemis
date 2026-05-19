import { type Chunk, type Source, chunks, sources } from '@mnemis/db';
import { type SQL, and, eq, ilike, inArray, notInArray, sql } from 'drizzle-orm';
import { getDb } from '../db.ts';
import type { SourceKindInput } from '../validators/sources.ts';
import { getEmbeddings } from './embeddings.ts';

const RRF_K = 60;
const POOL_PER_RETRIEVER = 50;

export interface SourceSearchFilters {
  sourceIds?: string[];
  kinds?: SourceKindInput[];
  pathPrefix?: string;
}

export interface ChunkSearchHit {
  chunk: Chunk;
  source: Source;
  score: number;
  ranks: { bm25: number | null; vector: number | null };
  bm25_score: number | null;
  vector_score: number | null;
}

export interface SourceSearchResult {
  hits: ChunkSearchHit[];
  retrieval: 'keyword' | 'keyword_only' | 'hybrid_rrf';
  used_vector: boolean;
  embedding_model: string | null;
  embedding_tokens: number;
}

export interface ChunkDto {
  id: string;
  source_id: string;
  source_kind: SourceKindInput;
  source_identifier: string;
  source_display_name: string;
  path: string;
  line_start: number;
  line_end: number;
  page: number | null;
  section_path: string[];
  raw_text?: string;
  contextual_prefix?: string | null;
  language: string | null;
  metadata?: unknown;
  indexed_at: string;
  last_indexed_at: string | null;
  score: number;
  ranks: { bm25: number | null; vector: number | null };
  bm25_score: number | null;
  vector_score: number | null;
}

function broadLexicalQuery(query: string): string | null {
  const terms = query.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}_-]{2,}/gu) ?? [];
  const unique = [...new Set(terms)].slice(0, 16);
  if (unique.length <= 1) return null;
  return unique.join(' OR ');
}

function buildFilters(workspaceId: string, filters: SourceSearchFilters): SQL<unknown> {
  const clauses: SQL<unknown>[] = [
    eq(chunks.workspaceId, workspaceId),
    eq(sources.workspaceId, workspaceId),
  ];

  if (filters.sourceIds && filters.sourceIds.length > 0) {
    clauses.push(inArray(chunks.sourceId, filters.sourceIds));
  }
  if (filters.kinds && filters.kinds.length > 0) {
    clauses.push(inArray(sources.kind, filters.kinds));
  }
  if (filters.pathPrefix) {
    clauses.push(ilike(chunks.path, `${filters.pathPrefix}%`));
  }

  return and(...clauses) as SQL<unknown>;
}

async function keywordLookup(
  workspaceId: string,
  query: string,
  filters: SourceSearchFilters,
  limit: number,
): Promise<ChunkSearchHit[]> {
  const db = getDb();
  const base = buildFilters(workspaceId, filters);
  const strictRows = await db
    .select({
      chunk: chunks,
      source: sources,
      score: sql<number>`ts_rank_cd(${chunks.bodyTsv}, websearch_to_tsquery('english', ${query}))::float`,
    })
    .from(chunks)
    .innerJoin(sources, eq(sources.id, chunks.sourceId))
    .where(and(base, sql`${chunks.bodyTsv} @@ websearch_to_tsquery('english', ${query})`))
    .orderBy(sql`ts_rank_cd(${chunks.bodyTsv}, websearch_to_tsquery('english', ${query})) desc`)
    .limit(limit);

  if (strictRows.length >= limit) {
    return strictRows.map((row) => ({
      chunk: row.chunk,
      source: row.source,
      score: row.score,
      ranks: { bm25: null, vector: null },
      bm25_score: row.score,
      vector_score: null,
    }));
  }

  const broad = broadLexicalQuery(query);
  if (!broad) {
    return strictRows.map((row) => ({
      chunk: row.chunk,
      source: row.source,
      score: row.score,
      ranks: { bm25: null, vector: null },
      bm25_score: row.score,
      vector_score: null,
    }));
  }

  const existingIds = strictRows.map((row) => row.chunk.id);
  const excludeExisting = existingIds.length > 0 ? notInArray(chunks.id, existingIds) : undefined;
  const broadRows = await db
    .select({
      chunk: chunks,
      source: sources,
      score: sql<number>`ts_rank_cd(${chunks.bodyTsv}, websearch_to_tsquery('english', ${broad}))::float`,
    })
    .from(chunks)
    .innerJoin(sources, eq(sources.id, chunks.sourceId))
    .where(
      and(
        base,
        excludeExisting,
        sql`${chunks.bodyTsv} @@ websearch_to_tsquery('english', ${broad})`,
      ) as SQL<unknown>,
    )
    .orderBy(sql`ts_rank_cd(${chunks.bodyTsv}, websearch_to_tsquery('english', ${broad})) desc`)
    .limit(limit - strictRows.length);

  return [...strictRows, ...broadRows].map((row) => ({
    chunk: row.chunk,
    source: row.source,
    score: row.score,
    ranks: { bm25: null, vector: null },
    bm25_score: row.score,
    vector_score: null,
  }));
}

async function vectorLookup(
  workspaceId: string,
  qvec: number[],
  filters: SourceSearchFilters,
  limit: number,
): Promise<ChunkSearchHit[]> {
  const db = getDb();
  const base = buildFilters(workspaceId, filters);
  const literal = `[${qvec.join(',')}]`;
  const rows = await db
    .select({
      chunk: chunks,
      source: sources,
      score: sql<number>`(1 - (${chunks.embedding} <=> ${literal}::vector))::float`,
    })
    .from(chunks)
    .innerJoin(sources, eq(sources.id, chunks.sourceId))
    .where(and(base, sql`${chunks.embedding} IS NOT NULL`) as SQL<unknown>)
    .orderBy(sql`${chunks.embedding} <=> ${literal}::vector`)
    .limit(limit);

  return rows.map((row) => ({
    chunk: row.chunk,
    source: row.source,
    score: row.score,
    ranks: { bm25: null, vector: null },
    bm25_score: null,
    vector_score: row.score,
  }));
}

function keywordResult(hits: ChunkSearchHit[], limit: number): SourceSearchResult {
  const ranked = hits.slice(0, limit).map((hit, i) => ({
    ...hit,
    ranks: { bm25: i + 1, vector: null },
    score: hit.bm25_score ?? hit.score,
  }));

  return {
    hits: ranked,
    retrieval: 'keyword',
    used_vector: false,
    embedding_model: null,
    embedding_tokens: 0,
  };
}

function fuseHits(input: {
  bm25: ChunkSearchHit[];
  vector: ChunkSearchHit[];
  limit: number;
}): ChunkSearchHit[] {
  const fused = new Map<
    string,
    {
      row: ChunkSearchHit;
      rrf: number;
      bm25Rank?: number;
      vectorRank?: number;
      bm25Score?: number | null;
      vectorScore?: number | null;
    }
  >();

  input.bm25.forEach((row, i) => {
    const cur = fused.get(row.chunk.id) ?? { row, rrf: 0 };
    cur.rrf += 1 / (RRF_K + i + 1);
    cur.bm25Rank = i + 1;
    cur.bm25Score = row.bm25_score;
    fused.set(row.chunk.id, cur);
  });

  input.vector.forEach((row, i) => {
    const cur = fused.get(row.chunk.id) ?? { row, rrf: 0 };
    cur.rrf += 1 / (RRF_K + i + 1);
    cur.vectorRank = i + 1;
    cur.vectorScore = row.vector_score;
    fused.set(row.chunk.id, cur);
  });

  return [...fused.values()]
    .sort((a, b) => b.rrf - a.rrf)
    .slice(0, input.limit)
    .map((item) => ({
      chunk: item.row.chunk,
      source: item.row.source,
      score: item.rrf,
      ranks: {
        bm25: item.bm25Rank ?? null,
        vector: item.vectorRank ?? null,
      },
      bm25_score: item.bm25Score ?? null,
      vector_score: item.vectorScore ?? null,
    }));
}

export async function searchSourceChunks(
  workspaceId: string,
  query: string,
  filters: SourceSearchFilters,
  limit: number,
  opts: { retrieval?: 'keyword' | 'hybrid' } = {},
): Promise<SourceSearchResult> {
  const pool = Math.max(limit, POOL_PER_RETRIEVER);
  const retrieval = opts.retrieval ?? 'hybrid';

  if (retrieval === 'keyword') {
    const bm25 = await keywordLookup(workspaceId, query, filters, pool);
    return keywordResult(bm25, limit);
  }

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

  const [bm25, vector] = await Promise.all([
    keywordLookup(workspaceId, query, filters, pool),
    qvec ? vectorLookup(workspaceId, qvec, filters, pool) : Promise.resolve([]),
  ]);

  if (!qvec || vector.length === 0) {
    return {
      ...keywordResult(bm25, limit),
      retrieval: 'keyword_only',
      embedding_model: model,
      embedding_tokens: tokens,
    };
  }

  return {
    hits: fuseHits({ bm25, vector, limit }),
    retrieval: 'hybrid_rrf',
    used_vector: true,
    embedding_model: model,
    embedding_tokens: tokens,
  };
}

export function chunkToDto(
  hit: ChunkSearchHit,
  opts: { includeContent?: boolean; includeMetadata?: boolean } = {},
): ChunkDto {
  const dto: ChunkDto = {
    id: hit.chunk.id,
    source_id: hit.source.id,
    source_kind: hit.source.kind as SourceKindInput,
    source_identifier: hit.source.identifier,
    source_display_name: hit.source.displayName,
    path: hit.chunk.path,
    line_start: hit.chunk.lineStart,
    line_end: hit.chunk.lineEnd,
    page: hit.chunk.page,
    section_path: hit.chunk.sectionPath,
    language: hit.chunk.language,
    indexed_at: hit.chunk.indexedAt.toISOString(),
    last_indexed_at: hit.source.lastIndexedAt?.toISOString() ?? null,
    score: hit.score,
    ranks: hit.ranks,
    bm25_score: hit.bm25_score,
    vector_score: hit.vector_score,
  };

  if (opts.includeContent) {
    dto.raw_text = hit.chunk.rawText;
    dto.contextual_prefix = hit.chunk.contextualPrefix;
  }
  if (opts.includeMetadata) {
    dto.metadata = hit.chunk.metadata;
  }

  return dto;
}
