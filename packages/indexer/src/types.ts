export interface IndexSourceConfig {
  includePaths?: string[];
  excludePaths?: string[];
  focusInstructions?: string;
  localPath?: string;
  maxFileBytes?: number;
  chunkMaxChars?: number;
  chunkOverlapLines?: number;
  maxPages?: number;
  respectRobots?: boolean;
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
}

export interface IndexChunk {
  path: string;
  lineStart: number;
  lineEnd: number;
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
