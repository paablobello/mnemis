import { desc, eq, sources } from '@mnemis/db';
import {
  AlertTriangle,
  Book,
  CheckCircle,
  FileText,
  Filter,
  Globe,
  Loader,
  MoreHorizontal,
  Plus,
  RefreshCw,
  ScrollText,
  Search,
  Workflow,
} from 'lucide-react';
import { cookies } from 'next/headers';
import { getDashboardDb } from '../../../lib/db';
import { requireDashboardContext } from '../../../lib/session';
import { createSourceAction } from '../actions';

export const dynamic = 'force-dynamic';

const KIND_ICON: Record<string, typeof Book> = {
  docs_site: Book,
  web_page: Globe,
  pdf_document: FileText,
  academic_paper: ScrollText,
  github_repo: Workflow,
  research_collection: ScrollText,
};

function StatusBadge({ status }: { status: string }) {
  if (status === 'indexed')
    return (
      <span className="badge success">
        <CheckCircle size={11} />
        {status}
      </span>
    );
  if (status === 'indexing')
    return (
      <span className="badge accent">
        <Loader size={11} />
        {status}
      </span>
    );
  if (status === 'failed')
    return (
      <span className="badge danger">
        <AlertTriangle size={11} />
        {status}
      </span>
    );
  return (
    <span className="badge">
      <span className="dot" style={{ background: 'var(--fg-muted)' }} />
      {status}
    </span>
  );
}

function relative(value: Date | string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  const diff = Date.now() - date.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(date);
}

export default async function SourcesPage() {
  const context = await requireDashboardContext();
  const rows = await getDashboardDb()
    .select()
    .from(sources)
    .where(eq(sources.workspaceId, context.workspace.id))
    .orderBy(desc(sources.createdAt));
  const cookieStore = await cookies();
  const flash = cookieStore.get('mnemis_dashboard_flash')?.value ?? null;

  const counts = {
    all: rows.length,
    indexed: rows.filter((r) => r.status === 'indexed').length,
    indexing: rows.filter((r) => r.status === 'indexing').length,
    pending: rows.filter((r) => r.status === 'pending').length,
    failed: rows.filter((r) => r.status === 'failed').length,
  };

  return (
    <div className="page">
      <div className="page-head">
        <div className="title">
          <h1>Sources</h1>
          <p>
            The corpus your agents read from. Docs sites, papers, PDFs, web pages, and repos —
            indexed, chunked, and embedded.
          </p>
        </div>
      </div>

      {flash ? <div className="notice">{flash}</div> : null}

      <article className="card" style={{ marginBottom: 16 }}>
        <header className="section-head">
          <div className="left">
            <Plus size={15} className="lead" />
            <h2>Add a source</h2>
          </div>
        </header>
        <form
          action={createSourceAction}
          style={{
            display: 'grid',
            gap: 10,
            padding: 16,
            gridTemplateColumns: '140px minmax(200px, 1.4fr) minmax(160px, 0.8fr) auto',
          }}
        >
          <select
            className="input select"
            name="kind"
            defaultValue="docs_site"
            aria-label="Source type"
          >
            <option value="docs_site">Docs site</option>
            <option value="web_page">Web page</option>
            <option value="pdf_document">PDF</option>
          </select>
          <input
            className="input"
            name="identifier"
            type="url"
            placeholder="https://docs.example.com"
            required
          />
          <input className="input" name="displayName" placeholder="Display name" />
          <button className="btn btn-accent btn-sm" type="submit">
            <Plus size={14} />
            Queue
          </button>
        </form>
      </article>

      <article className="card">
        <header className="toolbar">
          <div className="search">
            <Search size={13} />
            <input className="input" placeholder="Search sources, URLs…" />
          </div>
          <button className="chip active" type="button">
            All{' '}
            <span className="mono" style={{ opacity: 0.6 }}>
              {counts.all}
            </span>
          </button>
          <button className="chip" type="button">
            Indexed{' '}
            <span className="mono" style={{ opacity: 0.6 }}>
              {counts.indexed}
            </span>
          </button>
          <button className="chip" type="button">
            Indexing{' '}
            <span className="mono" style={{ opacity: 0.6 }}>
              {counts.indexing}
            </span>
          </button>
          <button className="chip" type="button">
            Pending{' '}
            <span className="mono" style={{ opacity: 0.6 }}>
              {counts.pending}
            </span>
          </button>
          <button className="chip" type="button">
            Failed{' '}
            <span className="mono" style={{ opacity: 0.6 }}>
              {counts.failed}
            </span>
          </button>
          <div className="spacer" />
          <button className="btn btn-ghost btn-sm" type="button">
            <Filter size={13} />
            More filters
          </button>
        </header>

        {rows.length === 0 ? (
          <p className="empty">No sources yet. Add one above to start indexing.</p>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 36 }} />
                <th>Source</th>
                <th>Type</th>
                <th>Status</th>
                <th>Updated</th>
                <th style={{ width: 60 }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((source) => {
                const Icon = KIND_ICON[source.kind] ?? Globe;
                return (
                  <tr key={source.id}>
                    <td className="col-icon">
                      <div className="tbl-icon-cell">
                        <Icon size={13} />
                      </div>
                    </td>
                    <td>
                      <div className="cell-pri">{source.displayName}</div>
                      <div className="cell-sec mono">{source.identifier}</div>
                    </td>
                    <td>
                      <span className="badge outline" style={{ textTransform: 'capitalize' }}>
                        {source.kind.replace('_', ' ')}
                      </span>
                    </td>
                    <td>
                      <StatusBadge status={source.status} />
                    </td>
                    <td className="cell-sec">
                      {relative(source.lastIndexedAt ?? source.updatedAt)}
                    </td>
                    <td className="actions">
                      <button className="btn btn-icon btn-ghost" type="button">
                        <MoreHorizontal size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        <footer
          style={{
            padding: '10px 16px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderTop: '1px solid var(--border)',
            fontSize: 12,
            color: 'var(--fg-muted)',
          }}
        >
          <span>
            Showing <strong style={{ color: 'var(--fg)' }}>{rows.length}</strong> sources
          </span>
          <button className="btn btn-ghost btn-sm" type="button">
            <RefreshCw size={13} />
            Re-index all
          </button>
        </footer>
      </article>
    </div>
  );
}
