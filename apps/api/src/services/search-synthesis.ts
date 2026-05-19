import type { SearchCitation } from './search-render.ts';
import type { ChunkSearchHit } from './source-search.ts';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-3-5-haiku-latest';
const MAX_CHUNK_CHARS = 2_500;
const MAX_OUTPUT_TOKENS = 1_024;
const SYSTEM_PROMPT = `You answer the user's question using only the provided sources.

Rules:
- Cite every factual claim using the bracket form [N], where N matches the source number.
- If the sources do not answer the question, say so explicitly.
- Do not invent information that isn't in the sources.
- Be concise.`;

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

export interface SynthesisUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}

export interface SynthesisResult {
  answer: string;
  model: string;
  usage: SynthesisUsage;
}

export class SynthesisUnavailableError extends Error {
  constructor(message = 'ANTHROPIC_API_KEY is required for synthesized search responses') {
    super(message);
    this.name = 'SynthesisUnavailableError';
  }
}

function trimText(text: string, max = MAX_CHUNK_CHARS): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}…`;
}

function buildUserPrompt(
  query: string,
  hits: ChunkSearchHit[],
  citations: SearchCitation[],
): string {
  const lines: string[] = [];
  lines.push(`Question: ${query.trim()}`);
  lines.push('');
  lines.push('Sources:');
  hits.forEach((hit, index) => {
    const cite = citations[index]!;
    const header = `[${cite.n}] ${cite.source_identifier} · ${cite.path}:${cite.line_start}-${cite.line_end}`;
    lines.push(header);
    lines.push(trimText(hit.chunk.rawText));
    lines.push('');
  });
  lines.push('Answer the question using only the sources above. Cite with [N].');
  return lines.join('\n');
}

export interface SynthesizeOptions {
  model?: string;
  fetch?: typeof fetch;
  apiKey?: string;
}

export async function synthesizeAnswer(
  query: string,
  hits: ChunkSearchHit[],
  citations: SearchCitation[],
  options: SynthesizeOptions = {},
): Promise<SynthesisResult> {
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw new SynthesisUnavailableError();

  const model = options.model ?? DEFAULT_MODEL;
  const fetcher = options.fetch ?? fetch;

  const res = await fetcher(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: MAX_OUTPUT_TOKENS,
      temperature: 0,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: buildUserPrompt(query, hits, citations) }],
        },
      ],
    }),
  });

  if (!res.ok) {
    let body = '';
    try {
      body = await res.text();
    } catch {
      // ignore
    }
    throw new Error(`Anthropic synthesis error ${res.status}: ${body.slice(0, 500)}`);
  }

  const json = (await res.json()) as AnthropicResponse;
  const text = json.content?.find((block) => block.type === 'text')?.text?.trim();
  if (!text) throw new Error('Anthropic returned no text for synthesis');

  return {
    answer: text,
    model,
    usage: {
      input_tokens: json.usage?.input_tokens ?? 0,
      output_tokens: json.usage?.output_tokens ?? 0,
      cache_creation_input_tokens: json.usage?.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: json.usage?.cache_read_input_tokens ?? 0,
    },
  };
}

interface FetchOverride {
  fetch?: typeof fetch;
}

let testFetch: typeof fetch | null = null;

export function setSynthesisFetchForTests(fn: typeof fetch | null): void {
  testFetch = fn;
}

export function defaultSynthesisOptions(): FetchOverride {
  return testFetch ? { fetch: testFetch } : {};
}
