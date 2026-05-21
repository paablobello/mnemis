import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { extractText, getDocumentProxy, getMeta } from 'unpdf';
import { chunkFiles } from './chunker.ts';
import { crawlWebPage } from './docs.ts';
import type { BuildIndexResult, IndexSourceConfig, LoadedFile } from './types.ts';

const USER_AGENT = 'MnemisResearchIndexer/0.1 (+https://github.com/paablobello/mnemis)';
const DEFAULT_MAX_PDF_BYTES = 25 * 1024 * 1024;
const DEFAULT_FETCH_TIMEOUT_MS = 30_000;
const DEFAULT_PDF_EXTRACTOR_TIMEOUT_MS = 180_000;
const DEFAULT_PDF_NATIVE_MIN_CHARS = 1_500;
const MAX_REDIRECTS = 5;

interface FetchedBinary {
  bytes: Uint8Array;
  contentType: string;
  lastModified: Date | null;
  finalUrl: string;
}

interface PdfSidecarPage {
  page?: number;
  text?: string;
  markdown?: string;
}

interface PdfSidecarResponse {
  title?: string;
  pages?: PdfSidecarPage[];
  markdown?: string;
  text?: string;
  metadata?: Record<string, unknown>;
}

function timeoutMs(envKey: string, fallback: number): number {
  const configured = Number.parseInt(process.env[envKey] ?? '', 10);
  return Number.isFinite(configured) && configured > 0 ? configured : fallback;
}

function positiveInt(envKey: string, fallback: number): number {
  const configured = Number.parseInt(process.env[envKey] ?? '', 10);
  return Number.isFinite(configured) && configured > 0 ? configured : fallback;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function normalizeUrl(input: string): URL {
  const url = new URL(input);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('web indexing only supports http and https URLs');
  }
  url.hash = '';
  return url;
}

function looksLikePdfUrl(input: string): boolean {
  try {
    const url = normalizeUrl(input);
    return /\.pdf(?:$|[?#])/i.test(input) || url.pathname.startsWith('/pdf/');
  } catch {
    return /\.pdf(?:$|[?#])/i.test(input);
  }
}

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return false;
  const [a, b] = parts as [number, number, number, number];
  return (
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a === 0
  );
}

function isPrivateIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isPrivateIpv4(ip);
  if (version === 6) {
    const lower = ip.toLowerCase();
    return (
      lower === '::1' ||
      lower.startsWith('fc') ||
      lower.startsWith('fd') ||
      lower.startsWith('fe80')
    );
  }
  return false;
}

async function assertFetchAllowed(url: URL): Promise<void> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('web indexing only supports http and https URLs');
  }
  if (process.env.MNEMIS_MODE !== 'cloud') return;

  const hostname = url.hostname.toLowerCase().replace(/^\[(.*)\]$/, '$1');
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === 'metadata.google.internal'
  ) {
    throw new Error(`web indexing blocked private host: ${url.hostname}`);
  }
  if (isPrivateIp(hostname)) {
    throw new Error(`web indexing blocked private address: ${url.hostname}`);
  }

  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (addresses.some((address) => isPrivateIp(address.address))) {
    throw new Error(`web indexing blocked private address: ${url.hostname}`);
  }
}

async function fetchWithTimeout(
  url: URL | string,
  init: RequestInit = {},
  timeoutDurationMs = timeoutMs('MNEMIS_FETCH_TIMEOUT_MS', DEFAULT_FETCH_TIMEOUT_MS),
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error('fetch_timeout')), timeoutDurationMs);
  try {
    return await fetch(url, { ...init, signal: init.signal ?? controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function maxPdfBytes(config: IndexSourceConfig): number {
  return config.maxPdfBytes ?? DEFAULT_MAX_PDF_BYTES;
}

async function fetchBinary(identifier: string, config: IndexSourceConfig): Promise<FetchedBinary> {
  let url = normalizeUrl(identifier);
  const maxBytes = maxPdfBytes(config);

  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
    await assertFetchAllowed(url);
    const res = await fetchWithTimeout(url, {
      redirect: 'manual',
      headers: { 'user-agent': USER_AGENT, accept: 'application/pdf,*/*;q=0.8' },
    });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) throw new Error(`redirect without location from ${url.toString()}`);
      url = normalizeUrl(new URL(location, url).toString());
      continue;
    }

    if (!res.ok) throw new Error(`fetch failed for ${url.toString()}: HTTP ${res.status}`);
    const contentLength = Number(res.headers.get('content-length') ?? '0');
    if (contentLength > maxBytes) {
      throw new Error(`pdf_too_large: content-length ${contentLength} exceeds ${maxBytes}`);
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > maxBytes) {
      throw new Error(`pdf_too_large: body size ${bytes.byteLength} exceeds ${maxBytes}`);
    }

    const lastModified = res.headers.get('last-modified');
    return {
      bytes,
      contentType: res.headers.get('content-type') ?? '',
      lastModified: lastModified ? new Date(lastModified) : null,
      finalUrl: url.toString(),
    };
  }

  throw new Error(`too_many_redirects for ${identifier}`);
}

function toPathBase(identifier: string): string {
  const url = normalizeUrl(identifier);
  const pathname = decodeURIComponent(url.pathname.replace(/^\/+/, '') || 'document.pdf');
  const clean = pathname.replace(/\/+$/, '') || 'document.pdf';
  return clean.replace(/\.pdf$/i, '') || 'document';
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function cleanTitle(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed || fallback;
}

function safePdfInfo(info: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(info)) {
    if (value === null || value === undefined) continue;
    if (value instanceof Date) safe[key] = value.toISOString();
    else if (['string', 'number', 'boolean'].includes(typeof value)) safe[key] = value;
  }
  return safe;
}

function pageFile(input: {
  pathBase: string;
  page: number;
  totalPages: number;
  title: string;
  text: string;
  sourceUrl: string;
  modifiedAt: Date;
  metadata: Record<string, unknown>;
}): LoadedFile | null {
  const body = input.text.trim();
  if (!body) return null;
  const content = [`# ${input.title}`, '', `## Page ${input.page}`, '', body].join('\n');
  return {
    path: `${input.pathBase}/page-${input.page}.md`,
    absolutePath: `${input.sourceUrl}#page=${input.page}`,
    content,
    language: 'markdown',
    byteLength: new TextEncoder().encode(content).byteLength,
    modifiedAt: input.modifiedAt,
    page: input.page,
    metadata: {
      ...input.metadata,
      page: input.page,
      total_pages: input.totalPages,
      permalink: `${input.sourceUrl}#page=${input.page}`,
      source_url: input.sourceUrl,
    },
  };
}

async function extractWithSidecar(
  fetched: FetchedBinary,
  config: IndexSourceConfig,
): Promise<LoadedFile[]> {
  const endpoint = process.env.MNEMIS_PDF_EXTRACTOR_URL?.trim();
  if (!endpoint) throw new Error('pdf_sidecar_not_configured: set MNEMIS_PDF_EXTRACTOR_URL');

  const res = await fetchWithTimeout(
    endpoint,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        url: fetched.finalUrl,
        content_type: fetched.contentType,
        content_sha256: sha256(fetched.bytes),
        content_base64: Buffer.from(fetched.bytes).toString('base64'),
      }),
    },
    timeoutMs('MNEMIS_PDF_EXTRACTOR_TIMEOUT_MS', DEFAULT_PDF_EXTRACTOR_TIMEOUT_MS),
  );
  const text = await res.text();
  if (!res.ok) throw new Error(`pdf sidecar failed: HTTP ${res.status} ${text.slice(0, 500)}`);

  const parsed = (text ? JSON.parse(text) : {}) as PdfSidecarResponse;
  const pathBase = toPathBase(fetched.finalUrl);
  const title = cleanTitle(parsed.title ?? parsed.metadata?.title, pathBase);
  const modifiedAt = fetched.lastModified ?? new Date();
  const metadata = {
    content_type: fetched.contentType || 'application/pdf',
    content_sha256: sha256(fetched.bytes),
    pdf_extractor: 'sidecar',
    ...(parsed.metadata ?? {}),
  };

  if (Array.isArray(parsed.pages) && parsed.pages.length > 0) {
    const totalPages = parsed.pages.length;
    return parsed.pages
      .map((page, index) =>
        pageFile({
          pathBase,
          page: page.page ?? index + 1,
          totalPages,
          title,
          text: page.markdown ?? page.text ?? '',
          sourceUrl: fetched.finalUrl,
          modifiedAt,
          metadata,
        }),
      )
      .filter((file): file is LoadedFile => !!file);
  }

  const body = (parsed.markdown ?? parsed.text ?? '').trim();
  if (!body) throw new Error('pdf sidecar returned no text');
  const content = body.startsWith('# ') ? body : `# ${title}\n\n${body}`;
  return [
    {
      path: `${pathBase}.md`,
      absolutePath: fetched.finalUrl,
      content,
      language: 'markdown',
      byteLength: new TextEncoder().encode(content).byteLength,
      modifiedAt,
      metadata: {
        ...metadata,
        permalink: fetched.finalUrl,
        source_url: fetched.finalUrl,
      },
    },
  ];
}

function extractedChars(files: LoadedFile[]): number {
  return files.reduce((total, file) => total + file.content.replace(/\s+/g, ' ').trim().length, 0);
}

function markAutoDecision(
  files: LoadedFile[],
  decision: string,
  metadata: Record<string, unknown> = {},
): LoadedFile[] {
  return files.map((file) => ({
    ...file,
    metadata: {
      ...file.metadata,
      pdf_auto_decision: decision,
      ...metadata,
    },
  }));
}

async function extractWithUnpdf(
  fetched: FetchedBinary,
  config: IndexSourceConfig,
): Promise<LoadedFile[]> {
  const pdf = await getDocumentProxy(fetched.bytes);
  const meta = await getMeta(pdf, { parseDates: true }).catch(() => ({
    info: {} as Record<string, unknown>,
    metadata: {},
  }));
  const extracted = await extractText(pdf);
  const pages = Array.isArray(extracted.text) ? extracted.text : [extracted.text];
  const pathBase = toPathBase(fetched.finalUrl);
  const info = safePdfInfo(meta.info as Record<string, unknown>);
  const title = cleanTitle(config.title ?? info.Title, pathBase);
  const modifiedAt = fetched.lastModified ?? new Date();
  const metadata = {
    content_type: fetched.contentType || 'application/pdf',
    content_sha256: sha256(fetched.bytes),
    pdf_extractor: 'unpdf',
    pdf_info: info,
  };

  return pages
    .map((text, index) =>
      pageFile({
        pathBase,
        page: index + 1,
        totalPages: extracted.totalPages,
        title,
        text,
        sourceUrl: fetched.finalUrl,
        modifiedAt,
        metadata,
      }),
    )
    .filter((file): file is LoadedFile => !!file);
}

async function extractWithAutoPdf(
  fetched: FetchedBinary,
  config: IndexSourceConfig,
): Promise<LoadedFile[]> {
  const minNativeChars = positiveInt('MNEMIS_PDF_NATIVE_MIN_CHARS', DEFAULT_PDF_NATIVE_MIN_CHARS);

  let nativeFiles: LoadedFile[];
  let nativeChars: number;
  let nativeMetadata: Record<string, unknown>;

  try {
    nativeFiles = await extractWithUnpdf(fetched, config);
    nativeChars = extractedChars(nativeFiles);
    nativeMetadata = {
      pdf_native_chars: nativeChars,
      pdf_native_min_chars: minNativeChars,
    };
  } catch (nativeErr) {
    if (!process.env.MNEMIS_PDF_EXTRACTOR_URL?.trim()) throw nativeErr;

    try {
      return markAutoDecision(
        await extractWithSidecar(fetched, config),
        'sidecar_after_native_error',
        {
          pdf_native_error: errorMessage(nativeErr).slice(0, 500),
        },
      );
    } catch (sidecarErr) {
      throw new Error(
        `pdf auto extraction failed: native=${errorMessage(nativeErr)}; sidecar=${errorMessage(
          sidecarErr,
        )}`,
      );
    }
  }

  if (nativeChars >= minNativeChars) {
    return markAutoDecision(nativeFiles, 'native_text_sufficient', nativeMetadata);
  }

  if (!process.env.MNEMIS_PDF_EXTRACTOR_URL?.trim()) {
    return markAutoDecision(nativeFiles, 'native_text_sparse_no_sidecar', nativeMetadata);
  }

  try {
    return markAutoDecision(
      await extractWithSidecar(fetched, config),
      'sidecar_after_sparse_native',
      nativeMetadata,
    );
  } catch (sidecarErr) {
    if (nativeFiles.length > 0) {
      return markAutoDecision(nativeFiles, 'sidecar_failed_native_sparse', {
        ...nativeMetadata,
        pdf_sidecar_error: errorMessage(sidecarErr).slice(0, 500),
      });
    }
    throw sidecarErr;
  }
}

export async function buildPdfDocumentIndex(
  identifier: string,
  config: IndexSourceConfig = {},
): Promise<BuildIndexResult> {
  const fetched = await fetchBinary(identifier, config);
  const extractor = config.pdfExtractor ?? 'auto';
  const files =
    extractor === 'sidecar'
      ? await extractWithSidecar(fetched, config)
      : extractor === 'auto'
        ? await extractWithAutoPdf(fetched, config)
        : await extractWithUnpdf(fetched, config);

  if (files.length === 0) throw new Error(`pdf extractor found no text for ${identifier}`);
  const chunks = chunkFiles(files, {
    chunkMaxChars: config.chunkMaxChars,
    chunkOverlapLines: config.chunkOverlapLines,
  });
  const lastChangeAt =
    files.length === 0
      ? null
      : files.reduce(
          (latest, file) => (file.modifiedAt > latest ? file.modifiedAt : latest),
          files[0]!.modifiedAt,
        );

  return { files, chunks, lastChangeAt };
}

export async function buildWebPageIndex(
  identifier: string,
  config: IndexSourceConfig = {},
): Promise<BuildIndexResult> {
  if (looksLikePdfUrl(identifier)) return buildPdfDocumentIndex(identifier, config);
  const files = await crawlWebPage(identifier, config);
  if (files.length === 0) throw new Error(`web page extractor found no content for ${identifier}`);
  const chunks = chunkFiles(files, {
    chunkMaxChars: config.chunkMaxChars,
    chunkOverlapLines: config.chunkOverlapLines,
  });
  const lastChangeAt =
    files.length === 0
      ? null
      : files.reduce(
          (latest, file) => (file.modifiedAt > latest ? file.modifiedAt : latest),
          files[0]!.modifiedAt,
        );
  return { files, chunks, lastChangeAt };
}
