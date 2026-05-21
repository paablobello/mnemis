export interface IndexSourceConfig {
  includePaths?: string[];
  excludePaths?: string[];
  focusInstructions?: string;
  title?: string;
  localPath?: string;
  maxFileBytes?: number;
  maxPdfBytes?: number;
  chunkMaxChars?: number;
  chunkOverlapLines?: number;
  maxPages?: number;
  respectRobots?: boolean;
  docsCrawler?: 'auto' | 'native' | 'firecrawl';
  pdfExtractor?: 'auto' | 'native' | 'sidecar';
  contextualPrefixMode?: 'auto' | 'always' | 'never';
  contextualPrefixMaxDocumentChars?: number;
  contextualPrefixMaxChunkChars?: number;
}

export interface LoadedFile {
  path: string;
  absolutePath: string;
  content: string;
  language: string | null;
  byteLength: number;
  modifiedAt: Date;
  page?: number | null;
  metadata?: Record<string, unknown>;
}

export interface IndexChunk {
  chunkKey?: string;
  parentKey?: string | null;
  path: string;
  lineStart: number;
  lineEnd: number;
  page?: number | null;
  rawText: string;
  contextualPrefix: string | null;
  language: string | null;
  sectionPath: string[];
  metadata: Record<string, unknown>;
}

export interface BuildIndexResult {
  files: LoadedFile[];
  chunks: IndexChunk[];
  lastChangeAt: Date | null;
}
