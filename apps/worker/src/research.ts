export type ResearchDepth = 'quick' | 'standard' | 'deep';
export type ResearchSourceKind = 'web_page' | 'pdf_document' | 'academic_paper';

export interface ResearchRunConfig {
  depth: ResearchDepth;
  maxSources: number;
  includeWeb: boolean;
  includePapers: boolean;
  includePdfs: boolean;
  index: boolean;
  urls: string[];
}

export interface ResearchCandidate {
  kind: ResearchSourceKind;
  url: string;
  title: string;
  snippet: string | null;
  provider: string;
  sourceType: 'web' | 'paper' | 'pdf';
  score: number;
  pdfUrl?: string;
  doi?: string;
  arxivId?: string;
  year?: number;
  authors?: string[];
  venue?: string;
  citationCount?: number;
  metadata?: Record<string, unknown>;
}

export interface ResearchDiscoveryResult {
  candidates: ResearchCandidate[];
  issues: string[];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const values = value.map(asString).filter((item): item is string => !!item);
  return values.length > 0 ? values : undefined;
}

function positiveInt(value: unknown, fallback: number, max: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? Math.min(value, max)
    : fallback;
}

function boolValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function depthValue(value: unknown): ResearchDepth {
  return value === 'quick' || value === 'standard' || value === 'deep' ? value : 'standard';
}

export function normalizeResearchRunConfig(value: unknown): ResearchRunConfig {
  const config = asRecord(value);
  const urls = Array.isArray(config.urls)
    ? config.urls
        .map(asString)
        .filter((url): url is string => !!url)
        .slice(0, 50)
    : [];
  return {
    depth: depthValue(config.depth),
    maxSources: positiveInt(config.maxSources, 12, 50),
    includeWeb: boolValue(config.includeWeb, true),
    includePapers: boolValue(config.includePapers, true),
    includePdfs: boolValue(config.includePdfs, true),
    index: boolValue(config.index, true),
    urls,
  };
}

function timeoutMs(): number {
  const configured = Number.parseInt(process.env.MNEMIS_RESEARCH_TIMEOUT_MS ?? '', 10);
  return Number.isFinite(configured) && configured > 0 ? configured : 20_000;
}

async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error('research_provider_timeout')),
    timeoutMs(),
  );
  try {
    return await fetch(url, { ...init, signal: init.signal ?? controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetchWithTimeout(url, {
    ...init,
    headers: {
      accept: 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

async function fetchText(url: string, init: RequestInit = {}): Promise<string> {
  const res = await fetchWithTimeout(url, {
    ...init,
    headers: {
      accept: 'application/xml,text/xml,text/plain,*/*',
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  return text;
}

function normalizeUrl(input: string): string | null {
  try {
    const url = new URL(input);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

function isPdfUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return /\.pdf(?:$|[?#])/i.test(url) || parsed.pathname.startsWith('/pdf/');
  } catch {
    return /\.pdf(?:$|[?#])/i.test(url);
  }
}

function candidateKind(
  url: string,
  sourceType: ResearchCandidate['sourceType'],
): ResearchSourceKind {
  if (sourceType === 'paper') return 'academic_paper';
  if (sourceType === 'pdf' || isPdfUrl(url)) return 'pdf_document';
  return 'web_page';
}

function seedCandidates(config: ResearchRunConfig): ResearchCandidate[] {
  return config.urls.flatMap((rawUrl, index) => {
    const url = normalizeUrl(rawUrl);
    if (!url) return [];
    const sourceType = isPdfUrl(url) ? 'pdf' : 'web';
    return [
      {
        kind: candidateKind(url, sourceType),
        url,
        title: new URL(url).hostname,
        snippet: null,
        provider: 'seed_url',
        sourceType,
        score: 2_000 - index,
      },
    ];
  });
}

function tavilyKey(): string | null {
  return process.env.TAVILY_API_KEY?.trim() || process.env.MNEMIS_TAVILY_API_KEY?.trim() || null;
}

async function discoverWithTavily(query: string, limit: number): Promise<ResearchCandidate[]> {
  const apiKey = tavilyKey();
  if (!apiKey) throw new Error('tavily_not_configured');
  const json = await fetchJson<Record<string, unknown>>('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: limit,
      search_depth: limit > 8 ? 'advanced' : 'basic',
      include_answer: false,
      include_raw_content: false,
    }),
  });
  const results = Array.isArray(json.results) ? json.results : [];
  return results.flatMap((item, index) => {
    const row = asRecord(item);
    const url = normalizeUrl(asString(row.url) ?? '');
    if (!url) return [];
    const score = asNumber(row.score) ?? 0;
    return [
      {
        kind: candidateKind(url, isPdfUrl(url) ? 'pdf' : 'web'),
        url,
        title: asString(row.title) ?? url,
        snippet: asString(row.content),
        provider: 'tavily',
        sourceType: isPdfUrl(url) ? 'pdf' : 'web',
        score: 1_000 + score * 100 - index,
      },
    ];
  });
}

function exaKey(): string | null {
  return process.env.EXA_API_KEY?.trim() || process.env.MNEMIS_EXA_API_KEY?.trim() || null;
}

async function discoverWithExa(query: string, limit: number): Promise<ResearchCandidate[]> {
  const apiKey = exaKey();
  if (!apiKey) throw new Error('exa_not_configured');
  const json = await fetchJson<Record<string, unknown>>('https://api.exa.ai/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({ query, numResults: limit, type: 'auto' }),
  });
  const results = Array.isArray(json.results) ? json.results : [];
  return results.flatMap((item, index) => {
    const row = asRecord(item);
    const url = normalizeUrl(asString(row.url) ?? '');
    if (!url) return [];
    return [
      {
        kind: candidateKind(url, isPdfUrl(url) ? 'pdf' : 'web'),
        url,
        title: asString(row.title) ?? url,
        snippet: asString(row.text) ?? asString(row.highlight),
        provider: 'exa',
        sourceType: isPdfUrl(url) ? 'pdf' : 'web',
        score: 950 - index,
      },
    ];
  });
}

function braveKey(): string | null {
  return (
    process.env.BRAVE_SEARCH_API_KEY?.trim() ||
    process.env.MNEMIS_BRAVE_SEARCH_API_KEY?.trim() ||
    null
  );
}

async function discoverWithBrave(query: string, limit: number): Promise<ResearchCandidate[]> {
  const apiKey = braveKey();
  if (!apiKey) throw new Error('brave_not_configured');
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', String(Math.min(limit, 20)));
  const json = await fetchJson<Record<string, unknown>>(url.toString(), {
    headers: { 'x-subscription-token': apiKey },
  });
  const web = asRecord(json.web);
  const results = Array.isArray(web.results) ? web.results : [];
  return results.flatMap((item, index) => {
    const row = asRecord(item);
    const normalized = normalizeUrl(asString(row.url) ?? '');
    if (!normalized) return [];
    return [
      {
        kind: candidateKind(normalized, isPdfUrl(normalized) ? 'pdf' : 'web'),
        url: normalized,
        title: asString(row.title) ?? normalized,
        snippet: asString(row.description),
        provider: 'brave',
        sourceType: isPdfUrl(normalized) ? 'pdf' : 'web',
        score: 900 - index,
      },
    ];
  });
}

function semanticScholarKey(): string | null {
  return process.env.SEMANTIC_SCHOLAR_API_KEY?.trim() || null;
}

function openAccessPdfUrl(value: unknown): string | null {
  const record = asRecord(value);
  return normalizeUrl(asString(record.url) ?? '');
}

async function discoverWithSemanticScholar(
  query: string,
  limit: number,
): Promise<ResearchCandidate[]> {
  const url = new URL('https://api.semanticscholar.org/graph/v1/paper/search');
  url.searchParams.set('query', query);
  url.searchParams.set('limit', String(Math.min(limit, 20)));
  url.searchParams.set(
    'fields',
    'title,url,abstract,year,authors,venue,citationCount,openAccessPdf,externalIds',
  );
  const key = semanticScholarKey();
  const json = await fetchJson<Record<string, unknown>>(url.toString(), {
    headers: key ? { 'x-api-key': key } : undefined,
  });
  const data = Array.isArray(json.data) ? json.data : [];
  return data.flatMap((item, index) => {
    const row = asRecord(item);
    const externalIds = asRecord(row.externalIds);
    const paperUrl = normalizeUrl(asString(row.url) ?? '') ?? null;
    const pdfUrl = openAccessPdfUrl(row.openAccessPdf) ?? undefined;
    const targetUrl = pdfUrl ?? paperUrl;
    if (!targetUrl) return [];
    return [
      {
        kind: 'academic_paper',
        url: paperUrl ?? targetUrl,
        pdfUrl,
        title: asString(row.title) ?? targetUrl,
        snippet: asString(row.abstract),
        provider: 'semantic_scholar',
        sourceType: 'paper',
        score: 1_250 + (asNumber(row.citationCount) ?? 0) / 50 - index,
        doi: asString(externalIds.DOI) ?? undefined,
        arxivId: asString(externalIds.ArXiv) ?? undefined,
        year: asNumber(row.year),
        authors: Array.isArray(row.authors)
          ? row.authors
              .map((author) => asString(asRecord(author).name))
              .filter((author): author is string => !!author)
          : undefined,
        venue: asString(row.venue) ?? undefined,
        citationCount: asNumber(row.citationCount),
      },
    ];
  });
}

async function discoverWithOpenAlex(query: string, limit: number): Promise<ResearchCandidate[]> {
  const url = new URL('https://api.openalex.org/works');
  url.searchParams.set('search', query);
  url.searchParams.set('per-page', String(Math.min(limit, 25)));
  const email = process.env.OPENALEX_EMAIL?.trim();
  if (email) url.searchParams.set('mailto', email);
  const json = await fetchJson<Record<string, unknown>>(url.toString());
  const results = Array.isArray(json.results) ? json.results : [];
  return results.flatMap((item, index) => {
    const row = asRecord(item);
    const primaryLocation = asRecord(row.primary_location);
    const pdfUrl =
      normalizeUrl(asString(primaryLocation.pdf_url) ?? '') ??
      normalizeUrl(asString(asRecord(row.best_oa_location).pdf_url) ?? '') ??
      undefined;
    const landingUrl =
      normalizeUrl(asString(primaryLocation.landing_page_url) ?? '') ??
      normalizeUrl(asString(row.doi) ?? '') ??
      normalizeUrl(asString(row.id) ?? '');
    const targetUrl = pdfUrl ?? landingUrl;
    if (!targetUrl) return [];
    const authorships = Array.isArray(row.authorships) ? row.authorships : [];
    return [
      {
        kind: 'academic_paper',
        url: landingUrl ?? targetUrl,
        pdfUrl,
        title: asString(row.title) ?? targetUrl,
        snippet: asString(row.abstract),
        provider: 'openalex',
        sourceType: 'paper',
        score: 1_150 + (asNumber(row.cited_by_count) ?? 0) / 50 - index,
        doi: asString(row.doi)?.replace(/^https:\/\/doi\.org\//i, ''),
        year: asNumber(row.publication_year),
        authors: authorships
          .map((author) => asString(asRecord(asRecord(author).author).display_name))
          .filter((author): author is string => !!author),
        venue: asString(asRecord(asRecord(row.primary_location).source).display_name) ?? undefined,
        citationCount: asNumber(row.cited_by_count),
      },
    ];
  });
}

async function discoverWithCrossref(query: string, limit: number): Promise<ResearchCandidate[]> {
  const url = new URL('https://api.crossref.org/works');
  url.searchParams.set('query', query);
  url.searchParams.set('rows', String(Math.min(limit, 20)));
  const json = await fetchJson<Record<string, unknown>>(url.toString());
  const message = asRecord(json.message);
  const items = Array.isArray(message.items) ? message.items : [];
  return items.flatMap((item, index) => {
    const row = asRecord(item);
    const doi = asString(row.DOI);
    const linkUrl = normalizeUrl(asString(row.URL) ?? (doi ? `https://doi.org/${doi}` : ''));
    if (!linkUrl) return [];
    const dateParts = asRecord(row.issued)['date-parts'];
    const firstDate = Array.isArray(dateParts) && Array.isArray(dateParts[0]) ? dateParts[0] : [];
    return [
      {
        kind: 'academic_paper',
        url: linkUrl,
        title: asStringArray(row.title)?.[0] ?? linkUrl,
        snippet: asString(row.abstract),
        provider: 'crossref',
        sourceType: 'paper',
        score: 1_050 + (asNumber(row['is-referenced-by-count']) ?? 0) / 50 - index,
        doi: doi ?? undefined,
        year: typeof firstDate[0] === 'number' ? firstDate[0] : undefined,
        authors: Array.isArray(row.author)
          ? row.author
              .map((author) => {
                const record = asRecord(author);
                return [asString(record.given), asString(record.family)].filter(Boolean).join(' ');
              })
              .filter(Boolean)
          : undefined,
        venue: asStringArray(row['container-title'])?.[0],
        citationCount: asNumber(row['is-referenced-by-count']),
      },
    ];
  });
}

function decodeXml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function xmlTag(entry: string, tag: string): string | null {
  const match = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(entry);
  return match?.[1]
    ? decodeXml(
        match[1]
          .replace(/<[^>]+>/g, '')
          .replace(/\s+/g, ' ')
          .trim(),
      )
    : null;
}

async function discoverWithArxiv(query: string, limit: number): Promise<ResearchCandidate[]> {
  const url = new URL('https://export.arxiv.org/api/query');
  url.searchParams.set('search_query', `all:${query}`);
  url.searchParams.set('start', '0');
  url.searchParams.set('max_results', String(Math.min(limit, 20)));
  const xml = await fetchText(url.toString());
  const entries = [...xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)].map(
    (match) => match[1]!,
  );
  return entries.flatMap((entry, index) => {
    const id = xmlTag(entry, 'id');
    const title = xmlTag(entry, 'title');
    if (!id) return [];
    const arxivId = id.split('/abs/')[1] ?? id.split('/').pop() ?? undefined;
    const pdfUrl = normalizeUrl(id.replace('/abs/', '/pdf/')) ?? undefined;
    const published = xmlTag(entry, 'published');
    return [
      {
        kind: 'academic_paper',
        url: normalizeUrl(id) ?? id,
        pdfUrl,
        title: title ?? id,
        snippet: xmlTag(entry, 'summary'),
        provider: 'arxiv',
        sourceType: 'paper',
        score: 1_100 - index,
        arxivId,
        year: published ? Number.parseInt(published.slice(0, 4), 10) : undefined,
        authors: [
          ...entry.matchAll(
            /<author\b[^>]*>[\s\S]*?<name\b[^>]*>([\s\S]*?)<\/name>[\s\S]*?<\/author>/gi,
          ),
        ]
          .map((match) => decodeXml(match[1]!.replace(/<[^>]+>/g, '').trim()))
          .filter(Boolean),
      },
    ];
  });
}

function dedupeKey(candidate: ResearchCandidate): string {
  if (candidate.doi) return `doi:${candidate.doi.toLowerCase()}`;
  if (candidate.arxivId) return `arxiv:${candidate.arxivId.toLowerCase()}`;
  return `url:${normalizeUrl(candidate.pdfUrl ?? candidate.url) ?? candidate.url}`;
}

function mergeCandidate(a: ResearchCandidate, b: ResearchCandidate): ResearchCandidate {
  return {
    ...a,
    ...Object.fromEntries(
      Object.entries(b).filter(
        ([, value]) => value !== undefined && value !== null && value !== '',
      ),
    ),
    provider: a.provider === b.provider ? a.provider : `${a.provider},${b.provider}`,
    score: Math.max(a.score, b.score),
  };
}

function rankCandidates(
  candidates: ResearchCandidate[],
  config: ResearchRunConfig,
): ResearchCandidate[] {
  const byKey = new Map<string, ResearchCandidate>();
  for (const candidate of candidates) {
    if (!config.includePdfs && (candidate.kind === 'pdf_document' || candidate.pdfUrl)) continue;
    const key = dedupeKey(candidate);
    const previous = byKey.get(key);
    byKey.set(key, previous ? mergeCandidate(previous, candidate) : candidate);
  }
  return [...byKey.values()].sort((a, b) => b.score - a.score).slice(0, config.maxSources);
}

async function collectProvider(
  issues: string[],
  label: string,
  fn: () => Promise<ResearchCandidate[]>,
): Promise<ResearchCandidate[]> {
  try {
    return await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    issues.push(`${label}: ${message.slice(0, 300)}`);
    return [];
  }
}

function providerLimit(config: ResearchRunConfig): number {
  if (config.depth === 'quick') return Math.min(config.maxSources, 8);
  if (config.depth === 'deep') return Math.min(Math.max(config.maxSources, 20), 40);
  return Math.min(Math.max(config.maxSources, 12), 25);
}

export async function discoverResearchCandidates(input: {
  query: string;
  config: ResearchRunConfig;
}): Promise<ResearchDiscoveryResult> {
  const issues: string[] = [];
  const limit = providerLimit(input.config);
  const candidates: ResearchCandidate[] = [...seedCandidates(input.config)];

  if (input.config.includeWeb) {
    const webResults = await Promise.all([
      collectProvider(issues, 'tavily', () => discoverWithTavily(input.query, limit)),
      collectProvider(issues, 'exa', () => discoverWithExa(input.query, limit)),
      collectProvider(issues, 'brave', () => discoverWithBrave(input.query, limit)),
    ]);
    candidates.push(...webResults.flat());
  }

  if (input.config.includePapers) {
    const paperProviders = [
      collectProvider(issues, 'semantic_scholar', () =>
        discoverWithSemanticScholar(input.query, limit),
      ),
      collectProvider(issues, 'openalex', () => discoverWithOpenAlex(input.query, limit)),
      collectProvider(issues, 'arxiv', () => discoverWithArxiv(input.query, limit)),
    ];
    if (input.config.depth !== 'quick') {
      paperProviders.push(
        collectProvider(issues, 'crossref', () => discoverWithCrossref(input.query, limit)),
      );
    }
    const paperResults = await Promise.all(paperProviders);
    candidates.push(...paperResults.flat());
  }

  return { candidates: rankCandidates(candidates, input.config), issues };
}
