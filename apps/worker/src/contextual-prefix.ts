import { createHash } from 'node:crypto';
import type { SourceKind } from '@mnemis/db';
import type { IndexChunk, IndexSourceConfig, LoadedFile } from '@mnemis/indexer';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-haiku-4-5';
const DEFAULT_MAX_DOCUMENT_CHARS = 80_000;
const DEFAULT_MAX_CHUNK_CHARS = 8_000;
const MAX_PREFIX_CHARS = 1_000;
const DOC_LANGUAGES = new Set(['markdown', 'mdx', 'text', 'html']);
const DEFAULT_PROVIDER_TIMEOUT_MS = 30_000;
const DEFAULT_CONTEXTUAL_PREFIX_CONCURRENCY = 4;

type ContextualPrefixMode = NonNullable<IndexSourceConfig['contextualPrefixMode']>;

interface AnthropicTextBlock {
  type: 'text';
  text: string;
}

interface AnthropicResponse {
  content?: AnthropicTextBlock[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

interface ContextualPrefixUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

export interface ContextualPrefixStats {
  enabled: boolean;
  mode: ContextualPrefixMode;
  model: string | null;
  eligible: number;
  generated: number;
  skipped: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  skippedReason: string | null;
}

export interface ContextualPrefixInput {
  sourceKind: SourceKind;
  files: LoadedFile[];
  chunks: IndexChunk[];
  config?: IndexSourceConfig;
}

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function trimText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars).trimEnd();
}

function defaultStats(input: {
  mode: ContextualPrefixMode;
  model: string | null;
  eligible?: number;
  generated?: number;
  skipped?: number;
  skippedReason?: string | null;
}): ContextualPrefixStats {
  return {
    enabled: input.skippedReason === null,
    mode: input.mode,
    model: input.model,
    eligible: input.eligible ?? 0,
    generated: input.generated ?? 0,
    skipped: input.skipped ?? 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    skippedReason: input.skippedReason ?? null,
  };
}

function isDocChunk(chunk: IndexChunk): boolean {
  return chunk.language !== null && DOC_LANGUAGES.has(chunk.language);
}

function shouldContextualize(input: {
  mode: ContextualPrefixMode;
  sourceKind: SourceKind;
  chunk: IndexChunk;
}): boolean {
  if (input.chunk.metadata.retrieval_role === 'parent') return false;
  if (input.mode === 'never') return false;
  if (input.mode === 'always') return true;
  return input.sourceKind === 'docs_site' || isDocChunk(input.chunk);
}

function promptForChunk(chunk: IndexChunk, maxChunkChars: number): string {
  const section =
    chunk.sectionPath.length > 0 ? `\nSection path: ${chunk.sectionPath.join(' > ')}` : '';
  return [
    'Here is the chunk we want to situate within the whole document.',
    section.trim(),
    '<chunk>',
    trimText(chunk.rawText, maxChunkChars),
    '</chunk>',
    'Please give a short succinct context to situate this chunk within the overall document for the purposes of improving search retrieval of the chunk. Answer only with the succinct context and nothing else.',
  ]
    .filter(Boolean)
    .join('\n');
}

function sanitizePrefix(text: string): string {
  return text
    .replace(/^["'`\s]+|["'`\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_PREFIX_CHARS);
}

function providerFailureReason(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.replace(/\s+/g, ' ').trim().slice(0, 240) || 'unknown provider error';
}

function providerTimeoutMs(): number {
  const configured = Number.parseInt(process.env.MNEMIS_PROVIDER_TIMEOUT_MS ?? '', 10);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_PROVIDER_TIMEOUT_MS;
}

function contextualPrefixConcurrency(): number {
  const configured = Number.parseInt(process.env.MNEMIS_CONTEXTUAL_PREFIX_CONCURRENCY ?? '', 10);
  if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_CONTEXTUAL_PREFIX_CONCURRENCY;
  return Math.min(configured, 16);
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error('provider_timeout')),
    providerTimeoutMs(),
  );
  try {
    return await fetch(url, { ...init, signal: init.signal ?? controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

class AnthropicContextClient {
  readonly model: string;
  private readonly apiKey: string;

  constructor(apiKey: string, model: string) {
    this.apiKey = apiKey;
    this.model = model;
  }

  async generatePrefix(input: {
    documentText: string;
    chunk: IndexChunk;
    maxChunkChars: number;
  }): Promise<{ prefix: string; usage: ContextualPrefixUsage }> {
    const res = await fetchWithTimeout(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 120,
        temperature: 0,
        system: [
          {
            type: 'text',
            text: 'You generate concise context snippets that improve search retrieval. Return only the context snippet.',
          },
          {
            type: 'text',
            text: `<document>\n${input.documentText}\n</document>`,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: promptForChunk(input.chunk, input.maxChunkChars),
              },
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Anthropic contextual prefix error ${res.status}: ${text.slice(0, 500)}`);
    }

    const json = (await res.json()) as AnthropicResponse;
    const text = json.content?.find((block) => block.type === 'text')?.text;
    if (!text) throw new Error('Anthropic returned no text for contextual prefix');

    return {
      prefix: sanitizePrefix(text),
      usage: {
        inputTokens: json.usage?.input_tokens ?? 0,
        outputTokens: json.usage?.output_tokens ?? 0,
        cacheCreationInputTokens: json.usage?.cache_creation_input_tokens ?? 0,
        cacheReadInputTokens: json.usage?.cache_read_input_tokens ?? 0,
      },
    };
  }
}

function addUsage(stats: ContextualPrefixStats, usage: ContextualPrefixUsage): void {
  stats.inputTokens += usage.inputTokens;
  stats.outputTokens += usage.outputTokens;
  stats.cacheCreationInputTokens += usage.cacheCreationInputTokens;
  stats.cacheReadInputTokens += usage.cacheReadInputTokens;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function applyContextualPrefixes(
  input: ContextualPrefixInput,
): Promise<{ chunks: IndexChunk[]; stats: ContextualPrefixStats }> {
  const mode = input.config?.contextualPrefixMode ?? 'auto';
  if (mode === 'never') {
    return {
      chunks: input.chunks,
      stats: defaultStats({
        mode,
        model: null,
        skipped: input.chunks.length,
        skippedReason: 'contextualPrefixMode is never',
      }),
    };
  }

  const fileByPath = new Map(input.files.map((file) => [file.path, file]));
  const eligible = input.chunks.filter((chunk) =>
    shouldContextualize({ mode, sourceKind: input.sourceKind, chunk }),
  );
  if (eligible.length === 0) {
    return {
      chunks: input.chunks,
      stats: defaultStats({
        mode,
        model: null,
        skipped: input.chunks.length,
        skippedReason: 'No chunks are eligible for contextual prefixes',
      }),
    };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  const model = process.env.ANTHROPIC_CONTEXT_MODEL?.trim() || DEFAULT_MODEL;
  if (!apiKey) {
    return {
      chunks: input.chunks,
      stats: defaultStats({
        mode,
        model,
        eligible: eligible.length,
        skipped: eligible.length,
        skippedReason: 'ANTHROPIC_API_KEY is not configured',
      }),
    };
  }

  const maxDocumentChars =
    input.config?.contextualPrefixMaxDocumentChars ?? DEFAULT_MAX_DOCUMENT_CHARS;
  const maxChunkChars = input.config?.contextualPrefixMaxChunkChars ?? DEFAULT_MAX_CHUNK_CHARS;
  const client = new AnthropicContextClient(apiKey, model);
  const stats = defaultStats({
    mode,
    model,
    eligible: eligible.length,
    skippedReason: null,
  });

  const chunks = input.chunks.map((chunk) => ({ ...chunk, metadata: { ...chunk.metadata } }));
  const byPath = new Map<string, IndexChunk[]>();
  for (const chunk of chunks) {
    if (!shouldContextualize({ mode, sourceKind: input.sourceKind, chunk })) continue;
    const group = byPath.get(chunk.path) ?? [];
    group.push(chunk);
    byPath.set(chunk.path, group);
  }

  const tasks: Array<{
    chunk: IndexChunk;
    documentText: string;
    documentHash: string;
  }> = [];

  for (const [path, pathChunks] of byPath) {
    const file = fileByPath.get(path);
    if (!file) {
      continue;
    }

    const documentText = trimText(file.content, maxDocumentChars);
    const documentHash = hashText(documentText);
    for (const chunk of pathChunks) {
      tasks.push({ chunk, documentText, documentHash });
    }
  }

  const results = await mapWithConcurrency(
    tasks,
    contextualPrefixConcurrency(),
    async ({ chunk, documentText, documentHash }) => {
      try {
        const result = await client.generatePrefix({
          documentText,
          chunk,
          maxChunkChars,
        });

        chunk.contextualPrefix = result.prefix;
        chunk.metadata = {
          ...chunk.metadata,
          contextual_prefix_model: model,
          contextual_prefix_document_hash: documentHash,
          contextual_prefix_chunk_hash: hashText(trimText(chunk.rawText, maxChunkChars)),
        };
        return { usage: result.usage };
      } catch (err) {
        return { error: providerFailureReason(err) };
      }
    },
  );

  for (const result of results) {
    if ('error' in result) {
      if (result.error) stats.skippedReason ??= result.error;
      continue;
    }
    if ('usage' in result) {
      stats.generated++;
      addUsage(stats, result.usage);
    }
  }

  stats.skipped = stats.eligible - stats.generated;
  return { chunks, stats };
}
