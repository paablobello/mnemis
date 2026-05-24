import { desc, eq, researchRuns } from '@mnemis/db';
import { AlertTriangle, CheckCircle, ChevronRight, FlaskConical, Loader, Plus } from 'lucide-react';
import { cookies } from 'next/headers';
import { getDashboardDb } from '../../../lib/db';
import { requireDashboardContext } from '../../../lib/session';
import { createResearchAction } from '../actions';

export const dynamic = 'force-dynamic';

function statusBadge(status: string) {
  if (status === 'completed')
    return (
      <span className="badge success">
        <CheckCircle size={11} />
        {status}
      </span>
    );
  if (status === 'processing')
    return (
      <span className="badge accent">
        <Loader size={11} />
        running
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

function depthBadge(depth: string) {
  const cls = depth === 'deep' ? 'accent' : depth === 'standard' ? '' : 'outline';
  return (
    <span className={`badge ${cls}`} style={{ textTransform: 'capitalize' }}>
      {depth}
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

function duration(
  start: Date | string | null | undefined,
  end: Date | string | null | undefined,
): string {
  if (!start) return '—';
  if (!end) return 'running';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 0) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

export default async function ResearchPage() {
  const context = await requireDashboardContext();
  const rows = await getDashboardDb()
    .select()
    .from(researchRuns)
    .where(eq(researchRuns.workspaceId, context.workspace.id))
    .orderBy(desc(researchRuns.createdAt))
    .limit(50);
  const cookieStore = await cookies();
  const flash = cookieStore.get('mnemis_dashboard_flash')?.value ?? null;

  const counts = {
    all: rows.length,
    running: rows.filter((r) => r.status === 'processing' || r.status === 'queued').length,
    completed: rows.filter((r) => r.status === 'completed').length,
    failed: rows.filter((r) => r.status === 'failed').length,
  };

  return (
    <div className="page">
      <div className="page-head">
        <div className="title">
          <h1>Research</h1>
          <p>
            Agents run cited, multi-hop research across your sources. Every claim ties back to a
            chunk you can audit.
          </p>
        </div>
      </div>

      {flash ? <div className="notice">{flash}</div> : null}

      <article className="card">
        <header className="section-head">
          <div className="left">
            <div className="tabs">
              <button type="button" className="active">
                All <span className="count">{counts.all}</span>
              </button>
              <button type="button">
                Running <span className="count">{counts.running}</span>
              </button>
              <button type="button">
                Completed <span className="count">{counts.completed}</span>
              </button>
              <button type="button">
                Failed <span className="count">{counts.failed}</span>
              </button>
            </div>
          </div>
        </header>

        {rows.length === 0 ? (
          <p className="empty">No research runs yet. Start one below.</p>
        ) : (
          <div style={{ padding: 14, display: 'grid', gap: 10 }}>
            {rows.map((run) => {
              const running = run.status === 'processing' || run.status === 'queued';
              const failed = run.status === 'failed';
              return (
                <div
                  key={run.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'auto 1fr auto',
                    gap: 14,
                    alignItems: 'center',
                    padding: '14px 16px',
                    background: 'var(--card)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--r-md)',
                  }}
                >
                  <div
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 8,
                      background: running
                        ? 'var(--accent-soft)'
                        : failed
                          ? 'var(--danger-soft)'
                          : 'var(--muted)',
                      color: running
                        ? 'var(--accent)'
                        : failed
                          ? 'var(--danger)'
                          : 'var(--fg-muted)',
                      display: 'grid',
                      placeItems: 'center',
                    }}
                  >
                    {running ? (
                      <Loader size={15} />
                    ) : failed ? (
                      <AlertTriangle size={15} />
                    ) : (
                      <FlaskConical size={15} />
                    )}
                  </div>

                  <div style={{ minWidth: 0 }}>
                    <div className="row" style={{ marginBottom: 4, gap: 6 }}>
                      {statusBadge(run.status)}
                      {depthBadge(run.depth)}
                      <span className="mono subtle" style={{ fontSize: 11 }}>
                        run_{run.id.slice(0, 8)}
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: 13.5,
                        fontWeight: 500,
                        color: 'var(--fg)',
                        lineHeight: 1.45,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {run.query}
                    </div>
                    <div className="mono subtle" style={{ fontSize: 11.5, marginTop: 4 }}>
                      <span>started {relative(run.createdAt)}</span>
                      {' · '}
                      <span>duration {duration(run.createdAt, run.completedAt)}</span>
                    </div>
                  </div>

                  <div className="row" style={{ gap: 4 }}>
                    <ChevronRight size={15} style={{ color: 'var(--fg-subtle)' }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </article>

      <article className="card" style={{ marginTop: 16 }}>
        <header className="section-head">
          <div className="left">
            <Plus size={15} className="lead" />
            <h2>Start a new research run</h2>
          </div>
        </header>
        <form action={createResearchAction} style={{ padding: 16, display: 'grid', gap: 10 }}>
          <textarea
            className="input"
            name="query"
            placeholder="What should the agent research? Be specific — e.g. 'Compare cited approaches for typed agent memory across the last 18 months, focusing on TTL semantics'"
            required
          />
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <label className="row" style={{ gap: 6, fontSize: 12.5, color: 'var(--fg-muted)' }}>
              <span>Depth</span>
              <select
                className="input select"
                name="depth"
                defaultValue="standard"
                style={{ width: 160, height: 30 }}
              >
                <option value="quick">Quick</option>
                <option value="standard">Standard</option>
                <option value="deep">Deep</option>
              </select>
            </label>
            <div className="spacer grow" />
            <button className="btn btn-accent btn-sm" type="submit">
              <FlaskConical size={13} />
              Run research
            </button>
          </div>
        </form>
      </article>
    </div>
  );
}
