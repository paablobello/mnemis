import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { chunkFiles } from './chunker.ts';
import type { BuildIndexResult, IndexSourceConfig, LoadedFile } from './types.ts';

const DEFAULT_MAX_PAGES = 100;
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const USER_AGENT = 'MnemisIndexer/0.1 (+https://github.com/paablobello/mnemis)';
const FIRECRAWL_DEFAULT_URL = 'https://api.firecrawl.dev/v2';
const FIRECRAWL_POLL_INTERVAL_MS = 500;
const FIRECRAWL_TIMEOUT_MS = 60_000;
const FETCH_TIMEOUT_MS = 15_000;

interface RobotsRules {
  disallow: string[];
  allow: string[];
}

interface FirecrawlCrawlResponse {
  success?: boolean;
  id?: string;
  url?: string;
  error?: string;
}

interface FirecrawlStatusResponse {
  status?: 'scraping' | 'completed' | 'failed' | string;
  data?: FirecrawlDocument[];
  next?: string | null;
  error?: string;
}

interface FirecrawlDocument {
  markdown?: string;
  metadata?: {
    title?: string;
    sourceURL?: string;
    url?: string;
    statusCode?: number;
    error?: string;
  };
}

function normalizeUrl(input: string): URL {
  const url = new URL(input);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('docs crawler only supports http and https URLs');
  }
  url.hash = '';
  if (url.pathname === '') url.pathname = '/';
  return url;
}

function timeoutMs(envKey: string, fallback: number): number {
  const configured = Number.parseInt(process.env[envKey] ?? '', 10);
  return Number.isFinite(configured) && configured > 0 ? configured : fallback;
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

function isCloudMode(): boolean {
  return process.env.MNEMIS_MODE === 'cloud';
}

async function assertFetchAllowed(url: URL): Promise<void> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('docs crawler only supports http and https URLs');
  }
  if (!isCloudMode()) return;

  const hostname = url.hostname.toLowerCase().replace(/^\[(.*)\]$/, '$1');
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === 'metadata.google.internal'
  ) {
    throw new Error(`docs crawler blocked private host: ${url.hostname}`);
  }
  if (isPrivateIp(hostname)) {
    throw new Error(`docs crawler blocked private address: ${url.hostname}`);
  }

  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (addresses.some((address) => isPrivateIp(address.address))) {
    throw new Error(`docs crawler blocked private address: ${url.hostname}`);
  }
}

async function fetchWithTimeout(url: URL | string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error('fetch_timeout')),
    timeoutMs('MNEMIS_FETCH_TIMEOUT_MS', FETCH_TIMEOUT_MS),
  );
  try {
    return await fetch(url, { ...init, signal: init.signal ?? controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function toPathKey(url: URL): string {
  const path = decodeURIComponent(url.pathname.replace(/^\/+/, '') || 'index');
  const withoutTrailing = path.replace(/\/+$/, '') || 'index';
  return `${withoutTrailing}.md`.replace(/\.html?\.md$/i, '.md');
}

function normalizePattern(pattern: string): string {
  return pattern.replace(/^\/+/, '').replace(/\/+$/, '');
}

function matchesPrefix(path: string, pattern: string): boolean {
  const p = normalizePattern(pattern);
  const normalizedPath = path.replace(/^\/+/, '').replace(/\.md$/i, '');
  return normalizedPath === p || normalizedPath.startsWith(`${p}/`);
}

function shouldIncludePath(path: string, config: IndexSourceConfig): boolean {
  const includes = config.includePaths ?? [];
  if (includes.length > 0 && !includes.some((pattern) => matchesPrefix(path, pattern))) {
    return false;
  }
  return !(config.excludePaths ?? []).some((pattern) => matchesPrefix(path, pattern));
}

function sameOrigin(base: URL, next: URL): boolean {
  return base.protocol === next.protocol && base.host === next.host;
}

function stripNoise(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, '')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, '');
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    );
}

function htmlToMarkdown(html: string, title: string): string {
  let body = stripNoise(html);
  const main = /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(body)?.[1];
  const article = /<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(body)?.[1];
  body = article ?? main ?? body;

  body = body
    .replace(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n')
    .replace(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n')
    .replace(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n')
    .replace(/<h4\b[^>]*>([\s\S]*?)<\/h4>/gi, '\n#### $1\n')
    .replace(/<h5\b[^>]*>([\s\S]*?)<\/h5>/gi, '\n##### $1\n')
    .replace(/<h6\b[^>]*>([\s\S]*?)<\/h6>/gi, '\n###### $1\n')
    .replace(/<pre\b[^>]*><code\b[^>]*>([\s\S]*?)<\/code><\/pre>/gi, '\n```\n$1\n```\n')
    .replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, '\n```\n$1\n```\n')
    .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, '`$1`')
    .replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')
    .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, '\n- $1')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/div>|<\/section>|<\/article>|<\/main>/gi, '\n')
    .replace(/<[^>]+>/g, '');

  const cleaned = decodeEntities(body)
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, '').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (cleaned.startsWith('# ')) return cleaned;
  return [`# ${title || 'Untitled'}`, cleaned].filter(Boolean).join('\n\n');
}

function extractTitle(html: string, url: URL): string {
  const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1];
  const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  return decodeEntities((h1 ?? title ?? url.pathname).replace(/<[^>]+>/g, '').trim());
}

function extractLinks(html: string, baseUrl: URL): URL[] {
  const links: URL[] = [];
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)) {
    const href = match[1];
    if (!href || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('#')) {
      continue;
    }
    try {
      const url = normalizeUrl(new URL(href, baseUrl).toString());
      if (/\.(png|jpe?g|gif|webp|svg|pdf|zip|tar|gz|mp4|mov|avi)$/i.test(url.pathname)) continue;
      links.push(url);
    } catch {
      // Ignore malformed links in source HTML.
    }
  }
  return links;
}

function extractSitemapLocs(xml: string, baseUrl: URL): URL[] {
  const urls: URL[] = [];
  for (const match of xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)) {
    try {
      urls.push(normalizeUrl(new URL(decodeEntities(match[1]!), baseUrl).toString()));
    } catch {
      // Ignore malformed sitemap locs.
    }
  }
  return urls;
}

function parseRobots(text: string): { rules: RobotsRules; sitemaps: string[] } {
  const rules: RobotsRules = { allow: [], disallow: [] };
  const sitemaps: string[] = [];
  let applies = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, '').trim();
    if (!line) continue;
    const [rawKey, ...rest] = line.split(':');
    const key = rawKey?.trim().toLowerCase();
    const value = rest.join(':').trim();
    if (!key) continue;

    if (key === 'user-agent') {
      applies = value === '*' || /mnemis/i.test(value);
      continue;
    }
    if (key === 'sitemap' && value) {
      sitemaps.push(value);
      continue;
    }
    if (!applies) continue;
    if (key === 'allow' && value) rules.allow.push(value);
    if (key === 'disallow' && value) rules.disallow.push(value);
  }

  return { rules, sitemaps };
}

function robotsAllows(url: URL, rules: RobotsRules): boolean {
  const path = `${url.pathname}${url.search}`;
  const allow = rules.allow
    .filter((rule) => path.startsWith(rule))
    .sort((a, b) => b.length - a.length)[0];
  const disallow = rules.disallow
    .filter((rule) => rule !== '' && path.startsWith(rule))
    .sort((a, b) => b.length - a.length)[0];
  if (!disallow) return true;
  if (!allow) return false;
  return allow.length >= disallow.length;
}

async function fetchText(
  url: URL,
): Promise<{ text: string; contentType: string; lastModified: Date | null } | null> {
  await assertFetchAllowed(url);
  const res = await fetchWithTimeout(url, { headers: { 'user-agent': USER_AGENT } });
  if (!res.ok) return null;

  const contentType = res.headers.get('content-type') ?? '';
  const length = Number(res.headers.get('content-length') ?? '0');
  if (length > MAX_PAGE_BYTES) return null;

  const arrayBuffer = await res.arrayBuffer();
  if (arrayBuffer.byteLength > MAX_PAGE_BYTES) return null;

  const lastModified = res.headers.get('last-modified');
  return {
    text: new TextDecoder().decode(arrayBuffer),
    contentType,
    lastModified: lastModified ? new Date(lastModified) : null,
  };
}

async function loadRobots(
  baseUrl: URL,
  respectRobots: boolean,
): Promise<{
  rules: RobotsRules;
  sitemaps: URL[];
}> {
  if (!respectRobots) return { rules: { allow: [], disallow: [] }, sitemaps: [] };
  const robotsUrl = new URL('/robots.txt', baseUrl);
  const fetched = await fetchText(robotsUrl);
  if (!fetched) return { rules: { allow: [], disallow: [] }, sitemaps: [] };

  const parsed = parseRobots(fetched.text);
  const sitemaps = parsed.sitemaps.flatMap((loc) => {
    try {
      return [normalizeUrl(new URL(loc, baseUrl).toString())];
    } catch {
      return [];
    }
  });

  return { rules: parsed.rules, sitemaps };
}

async function seedFromSitemap(baseUrl: URL, robotsSitemaps: URL[]): Promise<URL[]> {
  const candidates =
    robotsSitemaps.length > 0 ? robotsSitemaps : [new URL('/sitemap.xml', baseUrl)];
  const urls: URL[] = [];
  for (const sitemapUrl of candidates) {
    const fetched = await fetchText(sitemapUrl);
    if (!fetched) continue;
    if (!/xml|text/i.test(fetched.contentType) && !fetched.text.includes('<urlset')) continue;
    urls.push(...extractSitemapLocs(fetched.text, baseUrl));
  }
  return urls;
}

export async function crawlDocsSiteNative(
  identifier: string,
  config: IndexSourceConfig = {},
): Promise<LoadedFile[]> {
  const startUrl = normalizeUrl(identifier);
  const maxPages = config.maxPages ?? DEFAULT_MAX_PAGES;
  const respectRobots = config.respectRobots ?? true;
  const { rules, sitemaps } = await loadRobots(startUrl, respectRobots);
  if (!robotsAllows(startUrl, rules)) {
    throw new Error(`robots.txt disallows crawling ${startUrl.pathname}`);
  }

  const queue: URL[] = [startUrl, ...(await seedFromSitemap(startUrl, sitemaps))];
  const seen = new Set<string>();
  const files: LoadedFile[] = [];

  while (queue.length > 0 && files.length < maxPages) {
    const url = queue.shift()!;
    const key = url.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    if (!sameOrigin(startUrl, url)) continue;
    if (!robotsAllows(url, rules)) continue;

    const path = toPathKey(url);
    if (!shouldIncludePath(path, config)) continue;

    const fetched = await fetchText(url);
    if (!fetched) continue;
    if (!/html/i.test(fetched.contentType) && !/<html|<main|<article|<h1/i.test(fetched.text)) {
      continue;
    }

    const title = extractTitle(fetched.text, url);
    const content = htmlToMarkdown(fetched.text, title);
    if (content.trim().length === 0) continue;

    files.push({
      path,
      absolutePath: url.toString(),
      content,
      language: 'markdown',
      byteLength: new TextEncoder().encode(content).byteLength,
      modifiedAt: fetched.lastModified ?? new Date(),
    });

    for (const link of extractLinks(fetched.text, url)) {
      if (!sameOrigin(startUrl, link)) continue;
      if (!seen.has(link.toString())) queue.push(link);
    }
  }

  return files;
}

function firecrawlApiUrl(): string {
  return (process.env.FIRECRAWL_API_URL?.trim() || FIRECRAWL_DEFAULT_URL).replace(/\/+$/, '');
}

function firecrawlKey(): string | null {
  return process.env.FIRECRAWL_API_KEY?.trim() || null;
}

function firecrawlPathPattern(path: string): string {
  return normalizePattern(path)
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\\\*/g, '.*');
}

async function firecrawlJson<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetchWithTimeout(url, init);
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!res.ok) {
    throw new Error(`Firecrawl API ${res.status}: ${text.slice(0, 500)}`);
  }
  return (json ?? {}) as T;
}

async function waitForFirecrawlCrawl(
  id: string,
  apiUrl: string,
  apiKey: string,
): Promise<FirecrawlDocument[]> {
  const deadline = Date.now() + FIRECRAWL_TIMEOUT_MS;
  let nextUrl: string | null = `${apiUrl}/crawl/${encodeURIComponent(id)}`;
  const documents: FirecrawlDocument[] = [];

  while (nextUrl) {
    const crawlStatus: FirecrawlStatusResponse = await firecrawlJson<FirecrawlStatusResponse>(
      nextUrl,
      {
        method: 'GET',
        headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' },
      },
    );

    if (Array.isArray(crawlStatus.data)) documents.push(...crawlStatus.data);
    if (crawlStatus.status === 'completed') {
      nextUrl = crawlStatus.next ?? null;
      continue;
    }
    if (crawlStatus.status === 'failed') {
      throw new Error(`Firecrawl crawl failed${crawlStatus.error ? `: ${crawlStatus.error}` : ''}`);
    }
    if (Date.now() >= deadline) {
      throw new Error(`Firecrawl crawl timed out after ${FIRECRAWL_TIMEOUT_MS}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, FIRECRAWL_POLL_INTERVAL_MS));
  }

  return documents;
}

export async function crawlDocsSiteWithFirecrawl(
  identifier: string,
  config: IndexSourceConfig = {},
): Promise<LoadedFile[]> {
  const apiKey = firecrawlKey();
  if (!apiKey) {
    throw new Error('firecrawl_not_configured: set FIRECRAWL_API_KEY or use docsCrawler=native');
  }

  const apiUrl = firecrawlApiUrl();
  const maxPages = config.maxPages ?? DEFAULT_MAX_PAGES;
  const started = await firecrawlJson<FirecrawlCrawlResponse>(`${apiUrl}/crawl`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      url: identifier,
      includePaths: config.includePaths?.map(firecrawlPathPattern),
      excludePaths: config.excludePaths?.map(firecrawlPathPattern),
      limit: maxPages,
      sitemap: 'include',
      ignoreRobotsTxt: config.respectRobots === false,
      scrapeOptions: {
        formats: ['markdown'],
        onlyMainContent: true,
        removeBase64Images: true,
        blockAds: true,
      },
    }),
  });

  if (!started.success || !started.id) {
    throw new Error(`Firecrawl crawl did not start${started.error ? `: ${started.error}` : ''}`);
  }

  const docs = await waitForFirecrawlCrawl(started.id, apiUrl, apiKey);
  const seen = new Set<string>();
  const files: LoadedFile[] = [];

  for (const doc of docs) {
    const markdown = doc.markdown?.trim();
    const sourceUrl = doc.metadata?.sourceURL ?? doc.metadata?.url ?? started.url ?? identifier;
    if (!markdown || seen.has(sourceUrl)) continue;

    const url = normalizeUrl(sourceUrl);
    const path = toPathKey(url);
    if (!shouldIncludePath(path, config)) continue;

    seen.add(sourceUrl);
    files.push({
      path,
      absolutePath: url.toString(),
      content: markdown.startsWith('# ')
        ? markdown
        : `# ${doc.metadata?.title ?? path}\n\n${markdown}`,
      language: 'markdown',
      byteLength: new TextEncoder().encode(markdown).byteLength,
      modifiedAt: new Date(),
    });
  }

  return files;
}

export async function crawlDocsSite(
  identifier: string,
  config: IndexSourceConfig = {},
): Promise<LoadedFile[]> {
  const crawler = config.docsCrawler ?? 'auto';
  if (crawler === 'native') return crawlDocsSiteNative(identifier, config);
  if (crawler === 'firecrawl') return crawlDocsSiteWithFirecrawl(identifier, config);
  if (!firecrawlKey()) return crawlDocsSiteNative(identifier, config);

  try {
    return await crawlDocsSiteWithFirecrawl(identifier, config);
  } catch {
    return crawlDocsSiteNative(identifier, config);
  }
}

export async function buildDocsSiteIndex(
  identifier: string,
  config: IndexSourceConfig = {},
): Promise<BuildIndexResult> {
  const files = await crawlDocsSite(identifier, config);
  if (files.length === 0) {
    throw new Error(`docs crawler found no indexable pages for ${identifier}`);
  }
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
