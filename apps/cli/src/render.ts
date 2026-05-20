import type {
  ChunkSearchResponse,
  GitHubInstallationDto,
  MemoryDto,
  MemoryListResponse,
  MemorySearchResponse,
  SourceDto,
  SourceListResponse,
  SourceStatusDto,
} from '@mnemis/sdk';

export function renderSearch(response: ChunkSearchResponse): string {
  if (response.mode === 'markdown' && response.markdown) {
    return response.markdown;
  }
  if (response.mode === 'synthesized' && response.answer) {
    return `${response.answer}\n\n— model: ${response.synthesis_model ?? 'unknown'} · retrieval: ${response.retrieval}`;
  }
  return JSON.stringify(response, null, 2);
}

export function renderSources(response: SourceListResponse): string {
  if (response.items.length === 0) return 'No sources registered.';
  const lines: string[] = [];
  lines.push(`Sources (${response.items.length} of ${response.total}):`);
  for (const s of response.items) {
    lines.push('');
    lines.push(`• ${s.display_name}  [${s.kind}]`);
    lines.push(`    id:           ${s.id}`);
    lines.push(`    identifier:   ${s.identifier}`);
    lines.push(`    status:       ${s.status}${s.status_message ? ` (${s.status_message})` : ''}`);
    lines.push(
      `    last indexed: ${s.last_indexed_at ?? 'never'}    strategy: ${s.index_strategy}${s.cron_schedule ? ` (${s.cron_schedule})` : ''}`,
    );
  }
  return lines.join('\n');
}

export function renderSourceStatus(status: SourceStatusDto): string {
  const s = status.source;
  const lines: string[] = [];
  lines.push(`${s.display_name}  [${s.kind}]`);
  lines.push(`  id:           ${s.id}`);
  lines.push(`  identifier:   ${s.identifier}`);
  lines.push(`  status:       ${s.status}${s.status_message ? ` (${s.status_message})` : ''}`);
  lines.push(`  last indexed: ${s.last_indexed_at ?? 'never'}`);
  lines.push(`  chunks:       ${status.chunk_count}`);
  if (status.latest_job) {
    lines.push(`  latest job:   ${status.latest_job.kind} (${status.latest_job.status})`);
  }
  return lines.join('\n');
}

export function renderMemoryList(response: MemoryListResponse, includeBody = false): string {
  if (response.items.length === 0) return 'No memories found.';
  const lines: string[] = [];
  lines.push(`Memories (${response.items.length} of ${response.total}):`);
  for (const m of response.items) {
    lines.push('');
    lines.push(`• ${m.title}  [${m.kind}]`);
    lines.push(`    id:        ${m.id}`);
    lines.push(`    created:   ${m.created_at}`);
    if (m.expires_at) lines.push(`    expires:   ${m.expires_at}`);
    if (m.tags && m.tags.length > 0) lines.push(`    tags:      ${m.tags.join(', ')}`);
    if (m.directory) lines.push(`    directory: ${m.directory}`);
    lines.push(`    summary:   ${m.summary}`);
    if (includeBody && m.body) {
      lines.push('');
      lines.push(indent(m.body, 4));
    }
  }
  return lines.join('\n');
}

export function renderMemorySearch(response: MemorySearchResponse, includeBody = false): string {
  if (response.items.length === 0) return 'No memories found.';
  const details = [
    `mode: ${response.mode}`,
    response.reranked ? `reranked: ${response.reranker_model ?? 'unknown'}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const lines: string[] = [];
  lines.push(
    `Memory search (${response.items.length} of ${response.count})${details ? ` (${details})` : ''}:`,
  );
  for (const hit of response.items) {
    const m = hit.memory;
    const ranks = [
      hit.ranks.bm25 ? `text #${hit.ranks.bm25}` : null,
      hit.ranks.vector ? `vector #${hit.ranks.vector}` : null,
    ]
      .filter(Boolean)
      .join(', ');
    lines.push('');
    lines.push(`• ${m.title}  [${m.kind}]`);
    lines.push(`    id:        ${m.id}`);
    lines.push(`    score:     ${formatScore(hit.score)}${ranks ? ` (${ranks})` : ''}`);
    lines.push(`    created:   ${m.created_at}`);
    if (m.expires_at) lines.push(`    expires:   ${m.expires_at}`);
    if (m.tags.length > 0) lines.push(`    tags:      ${m.tags.join(', ')}`);
    if (m.directory) lines.push(`    directory: ${m.directory}`);
    lines.push(`    summary:   ${m.summary}`);
    if (includeBody && m.body) {
      lines.push('');
      lines.push(indent(m.body, 4));
    }
  }
  return lines.join('\n');
}

export function renderMemory(memory: MemoryDto, includeBody = true): string {
  return renderMemoryList({ items: [memory], total: 1, has_more: false }, includeBody);
}

export function renderSource(source: SourceDto): string {
  return renderSources({ items: [source], total: 1, has_more: false });
}

export function renderGithubInstallations(items: GitHubInstallationDto[]): string {
  if (items.length === 0) return 'No GitHub installations registered.';
  const lines: string[] = [];
  lines.push(`GitHub installations (${items.length}):`);
  for (const installation of items) {
    lines.push('');
    lines.push(`• ${installation.account_login}`);
    lines.push(`    installation: ${installation.installation_id}`);
    lines.push(`    id:           ${installation.id}`);
    if (installation.account_type) lines.push(`    type:         ${installation.account_type}`);
    if (installation.repository_selection) {
      lines.push(`    repos:        ${installation.repository_selection}`);
    }
    if (installation.events.length > 0)
      lines.push(`    events:       ${installation.events.join(', ')}`);
    if (installation.suspended_at) lines.push(`    suspended:    ${installation.suspended_at}`);
  }
  return lines.join('\n');
}

function indent(text: string, spaces: number): string {
  const pad = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((line) => `${pad}${line}`)
    .join('\n');
}

function formatScore(score: number): string {
  return Number.isInteger(score) ? String(score) : score.toFixed(4);
}
