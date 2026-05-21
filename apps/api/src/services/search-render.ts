import type { Source } from '@mnemis/db';
import type { ChunkSearchHit } from './source-search.ts';

const EXCERPT_MAX_CHARS = 800;

export interface SearchCitation {
  n: number;
  chunk_id: string;
  source_id: string;
  source_kind: string;
  source_identifier: string;
  source_display_name: string;
  path: string;
  line_start: number;
  line_end: number;
  page: number | null;
  permalink: string | null;
  last_indexed_at: string | null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function gitRef(source: Source, chunkMetadata: Record<string, unknown>): string {
  const sha = typeof chunkMetadata.commit_sha === 'string' ? chunkMetadata.commit_sha : null;
  if (sha && /^[0-9a-f]{7,64}$/i.test(sha)) return sha;
  const config = asRecord(source.config);
  const branch = typeof config.branch === 'string' ? config.branch : null;
  return branch && branch.length > 0 ? branch : 'HEAD';
}

export function buildChunkPermalink(hit: ChunkSearchHit): string | null {
  const { source, chunk } = hit;
  if (source.kind === 'github_repo') {
    const ref = gitRef(source, asRecord(chunk.metadata));
    const path = chunk.path.replace(/^\/+/, '');
    const fragment = `#L${chunk.lineStart}-L${chunk.lineEnd}`;
    return `https://github.com/${source.identifier}/blob/${encodeURIComponent(ref)}/${path}${fragment}`;
  }
  if (source.kind === 'docs_site') {
    const meta = asRecord(chunk.metadata);
    const candidate =
      (typeof meta.permalink === 'string' && meta.permalink) ||
      (typeof meta.page_url === 'string' && meta.page_url) ||
      null;
    return candidate || source.identifier;
  }
  if (
    source.kind === 'web_page' ||
    source.kind === 'pdf_document' ||
    source.kind === 'academic_paper'
  ) {
    const meta = asRecord(chunk.metadata);
    const candidate =
      (typeof meta.permalink === 'string' && meta.permalink) ||
      (typeof meta.source_url === 'string' && meta.source_url) ||
      source.identifier;
    return chunk.page ? `${candidate.replace(/#.*$/, '')}#page=${chunk.page}` : candidate;
  }
  return null;
}

export function buildCitations(hits: ChunkSearchHit[]): SearchCitation[] {
  return hits.map((hit, index) => ({
    n: index + 1,
    chunk_id: hit.chunk.id,
    source_id: hit.source.id,
    source_kind: hit.source.kind,
    source_identifier: hit.source.identifier,
    source_display_name: hit.source.displayName,
    path: hit.chunk.path,
    line_start: hit.chunk.lineStart,
    line_end: hit.chunk.lineEnd,
    page: hit.chunk.page,
    permalink: buildChunkPermalink(hit),
    last_indexed_at: hit.source.lastIndexedAt?.toISOString() ?? null,
  }));
}

function truncate(text: string, max = EXCERPT_MAX_CHARS): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}…`;
}

function fence(language: string | null): string {
  return language && /^[a-zA-Z0-9_+-]{1,30}$/.test(language) ? language : '';
}

export function renderSearchMarkdown(
  query: string,
  hits: ChunkSearchHit[],
  citations: SearchCitation[],
): string {
  const lines: string[] = [];
  lines.push(`# Results for "${query.replace(/[\r\n]+/g, ' ').slice(0, 200)}"`);
  lines.push('');

  if (hits.length === 0) {
    lines.push('_No matching chunks found._');
    return lines.join('\n');
  }

  hits.forEach((hit, index) => {
    const cite = citations[index]!;
    const lineRange =
      cite.line_start === cite.line_end
        ? `L${cite.line_start}`
        : `L${cite.line_start}-${cite.line_end}`;
    const location = cite.page ? `p. ${cite.page} · ${lineRange}` : lineRange;
    const heading = `### [${cite.n}] \`${cite.path}\` · ${location}`;
    const meta = [
      cite.source_display_name,
      cite.permalink ? `[link](${cite.permalink})` : null,
      cite.last_indexed_at ? `indexed ${cite.last_indexed_at}` : null,
    ]
      .filter(Boolean)
      .join(' · ');

    lines.push(heading);
    if (meta) lines.push(`_${meta}_`);
    lines.push('');
    const lang = fence(hit.chunk.language);
    lines.push(`\`\`\`${lang}`);
    lines.push(truncate(hit.chunk.rawText));
    lines.push('```');
    lines.push('');
  });

  return lines.join('\n').trimEnd();
}
