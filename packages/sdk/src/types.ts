/* DTOs returned by the Mnemis HTTP API. Mirror apps/api response shapes. */

export type MemoryKind = 'working' | 'session' | 'fact' | 'procedural';
export type SourceKind =
  | 'github_repo'
  | 'docs_site'
  | 'web_page'
  | 'pdf_document'
  | 'academic_paper'
  | 'research_collection';
export type SourceStatus = 'pending' | 'indexing' | 'indexed' | 'failed';
export type IndexStrategy = 'manual' | 'webhook' | 'cron';
export type SearchMode = 'raw' | 'markdown' | 'synthesized';
export type ResearchDepth = 'quick' | 'standard' | 'deep';
export type ResearchRunStatus = 'queued' | 'processing' | 'completed' | 'failed';

export interface EditedFile {
  path: string;
  content: string;
  language?: string;
}

export interface MemoryLineage {
  source_ids: string[];
  derived_from: string | null;
  confidence: number | null;
  tool_calls: unknown;
  model_version: string | null;
  edited_files: unknown;
}

export interface MemoryDto {
  id: string;
  kind: MemoryKind;
  title: string;
  summary: string;
  body: string;
  tags: string[];
  directory: string | null;
  file_overlap: string[];
  ttl_seconds: number | null;
  expires_at: string | null;
  archived_at: string | null;
  agent_origin: string | null;
  created_at: string;
  updated_at: string;
  has_embedding: boolean;
  /** Present only when the request asks for `?include=lineage`. */
  lineage?: MemoryLineage;
  /** Present only when the request asks for `?include=embedding`. */
  embedding?: number[];
  metadata?: Record<string, unknown>;
}

export interface MemoryListResponse {
  items: MemoryDto[];
  total: number;
  has_more: boolean;
}

export interface CreateMemoryInput {
  kind: MemoryKind;
  title: string;
  summary: string;
  body: string;
  tags?: string[];
  directory?: string;
  fileOverlap?: string[];
  agentOrigin?: string;
  ttlSeconds?: number | null;
  sourceIds?: string[];
  derivedFrom?: string | null;
  confidence?: number;
  toolCalls?: unknown[];
  modelVersion?: string;
  editedFiles?: EditedFile[];
  metadata?: Record<string, unknown>;
}

export interface PatchMemoryInput {
  kind?: MemoryKind;
  tags?: string[];
  ttlSeconds?: number | null;
  archived?: boolean;
  metadata?: Record<string, unknown>;
}

export interface MemorySearchInput {
  query: string;
  kind?: MemoryKind;
  tags?: string[];
  directory?: string;
  limit?: number;
  include?: Array<'lineage' | 'embedding'>;
}

export type MemorySearchMode = 'keyword' | 'keyword_only' | 'hybrid_rrf';

export interface MemorySearchHit {
  score: number;
  ranks: { bm25: number | null; vector: number | null };
  bm25_score: number | null;
  vector_score: number | null;
  memory: MemoryDto;
}

export interface MemorySearchResponse {
  query: string;
  mode: MemorySearchMode;
  embedding_model?: string | null;
  embedding_tokens?: number;
  reranked?: boolean;
  reranker_model?: string | null;
  reranker_tokens?: number;
  items: MemorySearchHit[];
  count: number;
}

export interface ListMemoriesQuery {
  kind?: MemoryKind;
  tag?: string;
  directory?: string;
  agentOrigin?: string;
  q?: string;
  includeArchived?: boolean;
  includeExpired?: boolean;
  include?: Array<'lineage' | 'embedding'>;
  limit?: number;
  offset?: number;
  createdAfter?: string;
  createdBefore?: string;
}

export interface SourceDto {
  id: string;
  kind: SourceKind;
  identifier: string;
  display_name: string;
  config: Record<string, unknown>;
  last_indexed_at: string | null;
  last_change_at: string | null;
  index_strategy: IndexStrategy;
  cron_schedule: string | null;
  status: SourceStatus;
  status_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface SourceListResponse {
  items: SourceDto[];
  total: number;
  has_more: boolean;
}

export interface JobDto {
  id: string;
  kind: string;
  status: string;
  payload: Record<string, unknown>;
  progress: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  scheduled_at: string;
  started_at: string | null;
  completed_at: string | null;
  attempts: number;
}

export interface SourceStatusDto {
  source: SourceDto;
  chunk_count: number;
  latest_job: JobDto | null;
}

export interface ResearchRunDto {
  id: string;
  workspace_id: string;
  query: string;
  depth: ResearchDepth;
  status: ResearchRunStatus;
  config: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface CreateResearchRunInput {
  query: string;
  depth?: ResearchDepth;
  maxSources?: number;
  includeWeb?: boolean;
  includePapers?: boolean;
  includePdfs?: boolean;
  index?: boolean;
  urls?: string[];
}

export interface ListResearchRunsQuery {
  status?: ResearchRunStatus;
  q?: string;
  limit?: number;
  offset?: number;
}

export interface ResearchRunListResponse {
  items: ResearchRunDto[];
  total: number;
  has_more: boolean;
}

export interface CreateSourceInput {
  kind: SourceKind;
  identifier: string;
  displayName?: string;
  config?: {
    branch?: string;
    githubInstallationId?: string;
    title?: string;
    sourceUrl?: string;
    pdfUrl?: string;
    includePaths?: string[];
    excludePaths?: string[];
    focusInstructions?: string;
    maxFileBytes?: number;
    maxPdfBytes?: number;
    chunkMaxChars?: number;
    chunkOverlapLines?: number;
    contextualPrefixMode?: 'auto' | 'always' | 'never';
    contextualPrefixMaxDocumentChars?: number;
    contextualPrefixMaxChunkChars?: number;
    maxPages?: number;
    respectRobots?: boolean;
    docsCrawler?: 'auto' | 'native' | 'firecrawl';
    pdfExtractor?: 'auto' | 'native' | 'sidecar';
    research?: Record<string, unknown>;
  };
  indexStrategy?: IndexStrategy;
  cronSchedule?: string | null;
  enqueue?: boolean;
}

export interface ListSourcesQuery {
  kind?: SourceKind;
  status?: SourceStatus;
  q?: string;
  limit?: number;
  offset?: number;
}

export interface GitHubInstallationDto {
  id: string;
  workspace_id: string;
  installation_id: string;
  account_login: string;
  account_type: string | null;
  repository_selection: string | null;
  permissions: unknown;
  events: string[];
  installed_at: string | null;
  suspended_at: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RegisterGitHubInstallationInput {
  installationId: string;
  accountLogin: string;
  accountType?: string;
  repositorySelection?: string;
  permissions?: Record<string, unknown>;
  events?: string[];
  installedAt?: string;
}

export interface ChunkSearchCitation {
  n: number;
  chunk_id: string;
  source_id: string;
  source_kind: SourceKind;
  source_identifier: string;
  source_display_name: string;
  path: string;
  line_start: number;
  line_end: number;
  page: number | null;
  permalink: string | null;
  last_indexed_at: string | null;
}

export interface ChunkSearchItem {
  id: string;
  source_id: string;
  source_kind: SourceKind;
  source_identifier: string;
  source_display_name: string;
  path: string;
  line_start: number;
  line_end: number;
  citation_number: number;
  permalink: string | null;
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

export interface ChunkSearchResponse {
  query: string;
  mode: SearchMode;
  retrieval: 'keyword' | 'keyword_only' | 'hybrid_rrf';
  used_vector: boolean;
  embedding_model: string | null;
  embedding_tokens: number;
  reranked: boolean;
  reranker_model: string | null;
  reranker_tokens: number;
  items: ChunkSearchItem[];
  citations: ChunkSearchCitation[];
  count: number;
  markdown?: string;
  answer?: string;
  synthesis_model?: string;
  synthesis_usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
  };
}

export interface ChunkSearchInput {
  query: string;
  retrieval?: 'keyword' | 'hybrid';
  mode?: SearchMode;
  synthesisModel?: string;
  sourceIds?: string[];
  kinds?: SourceKind[];
  pathPrefix?: string;
  limit?: number;
  include?: Array<'content' | 'metadata'>;
}
