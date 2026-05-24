import {
  Activity,
  AlertTriangle,
  CircleDot,
  Database,
  FlaskConical,
  Key,
  Layers,
  Plus,
  RefreshCw,
  ShieldCheck,
  Terminal,
  X,
  Zap,
} from 'lucide-react';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { getCachedDashboardSnapshot } from '../../lib/session';

function formatNumber(value: number): string {
  return value.toLocaleString('en-US');
}

function formatPeriodEnd(value: Date | string | null | undefined): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(new Date(value));
}

function Metric({
  label,
  value,
  delta,
  deltaDir,
  icon: Icon,
}: {
  label: string;
  value: string;
  delta?: string;
  deltaDir?: 'up' | 'down' | '';
  icon: typeof Database;
}) {
  return (
    <article className="metric">
      <div className="label">
        <Icon size={13} />
        {label}
      </div>
      <div className="value">{value}</div>
      {delta ? <div className={`delta ${deltaDir ?? ''}`}>{delta}</div> : null}
    </article>
  );
}

export default async function OverviewPage() {
  const snapshot = await getCachedDashboardSnapshot();
  const cookieStore = await cookies();
  const newKey = cookieStore.get('mnemis_new_api_key')?.value ?? null;
  const flash = cookieStore.get('mnemis_dashboard_flash')?.value ?? null;

  const periodEnd = formatPeriodEnd(snapshot.usage.period_end);
  const userFirstName =
    snapshot.user.name?.split(' ')[0] ?? snapshot.user.email.split('@')[0] ?? 'there';

  return (
    <div className="page">
      <div className="page-head">
        <div className="title">
          <div className="row" style={{ marginBottom: 4, gap: 6 }}>
            <span className="eyebrow">Workspace</span>
            <span className="subtle" style={{ fontSize: 11 }}>
              ·
            </span>
            <span className="eyebrow">Live</span>
          </div>
          <h1>Welcome back, {userFirstName}</h1>
          <p>
            {snapshot.counts.chunks > 0
              ? `Your agents indexed ${formatNumber(snapshot.counts.chunks)} chunks across ${formatNumber(
                  snapshot.counts.sources,
                )} sources and ran ${formatNumber(snapshot.counts.research_runs)} research jobs.`
              : 'Add a source and queue a research run to get started.'}
          </p>
        </div>
        <div className="row">
          <Link className="btn btn-outline btn-sm" href="/dashboard">
            <RefreshCw size={13} />
            Refresh
          </Link>
          <Link className="btn btn-accent btn-sm" href="/dashboard/research">
            <Plus size={14} />
            New research
          </Link>
        </div>
      </div>

      {flash ? <div className="notice">{flash}</div> : null}
      {newKey ? (
        <div className="secret-banner">
          <ShieldCheck size={18} />
          <div>
            <strong>New API key created. Store it now.</strong>
            <code>{newKey}</code>
          </div>
        </div>
      ) : null}

      <section className="metric-row">
        <Metric
          label="Sources"
          value={formatNumber(snapshot.counts.sources)}
          delta={`${snapshot.counts.indexed_sources} indexed`}
          icon={Database}
        />
        <Metric
          label="Research runs"
          value={formatNumber(snapshot.counts.research_runs)}
          delta={`${snapshot.counts.queued_jobs} queued`}
          icon={FlaskConical}
        />
        <Metric
          label="Memories"
          value={formatNumber(snapshot.counts.memories)}
          delta={`${formatNumber(snapshot.counts.chunks)} chunks`}
          icon={Layers}
        />
        <Metric
          label="Credits used"
          value={formatNumber(snapshot.usage.credits_used)}
          delta={
            snapshot.usage.credits_unlimited
              ? 'unlimited'
              : `of ${formatNumber(snapshot.usage.credits_limit)} · resets ${periodEnd}`
          }
          icon={Zap}
        />
      </section>

      {snapshot.counts.failed_jobs > 0 ? (
        <div className="banner warn" style={{ marginBottom: 16 }}>
          <AlertTriangle size={15} />
          <div className="grow">
            <strong>{snapshot.counts.failed_jobs} failed jobs</strong>{' '}
            <span className="muted">need review. Retry from the Research page.</span>
          </div>
          <Link className="btn btn-soft btn-sm" href="/dashboard/research">
            <RefreshCw size={13} />
            Review
          </Link>
          <button className="btn btn-ghost btn-sm" type="button">
            <X size={13} />
          </button>
        </div>
      ) : null}

      <div className="two-col">
        <article className="card">
          <header className="section-head">
            <div className="left">
              <Activity size={15} className="lead" />
              <h2>Recent sources</h2>
            </div>
            <div className="right">
              <Link className="btn btn-ghost btn-sm" href="/dashboard/sources">
                View all
              </Link>
            </div>
          </header>
          {snapshot.recent_sources.length === 0 ? (
            <p className="empty">No sources yet — add one to start indexing.</p>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Kind</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.recent_sources.slice(0, 6).map((source) => {
                  const status = source.status;
                  const cls =
                    status === 'indexed'
                      ? 'success'
                      : status === 'failed'
                        ? 'danger'
                        : status === 'indexing'
                          ? 'accent'
                          : '';
                  return (
                    <tr key={source.id}>
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
                        <span className={`badge ${cls}`}>{status}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </article>

        <div className="stack">
          <article className="card">
            <header className="section-head">
              <div className="left">
                <Zap size={15} className="lead" />
                <h2>Quick actions</h2>
              </div>
            </header>
            <div className="qa-grid">
              <Link className="qa-item primary" href="/dashboard/research">
                <div className="ico">
                  <FlaskConical size={15} />
                </div>
                <div className="text">
                  <strong>Start research run</strong>
                  <span>Deep, cited search across your sources</span>
                </div>
              </Link>
              <Link className="qa-item" href="/dashboard/sources">
                <div className="ico">
                  <Database size={15} />
                </div>
                <div className="text">
                  <strong>Add a source</strong>
                  <span>Docs, papers, PDFs, web pages, repos</span>
                </div>
              </Link>
              <Link className="qa-item" href="/dashboard/keys">
                <div className="ico">
                  <Key size={15} />
                </div>
                <div className="text">
                  <strong>Create API key</strong>
                  <span>Connect Cursor, Claude, Codex via MCP</span>
                </div>
              </Link>
              <Link className="qa-item" href="/dashboard/keys">
                <div className="ico">
                  <Terminal size={15} />
                </div>
                <div className="text">
                  <strong>Open MCP setup</strong>
                  <span>One-line CLI to wire your agent</span>
                </div>
              </Link>
            </div>
          </article>

          <article className="card">
            <header className="section-head">
              <div className="left">
                <Activity size={15} className="lead" />
                <h2>System status</h2>
              </div>
              <div className="right">
                <span className="badge success">
                  <span className="dot" />
                  All systems normal
                </span>
              </div>
            </header>
            <div style={{ padding: '8px 16px 16px' }}>
              {[
                { name: 'API', value: 'operational' },
                { name: 'Vector store', value: 'operational' },
                {
                  name: 'Indexer workers',
                  value: `${snapshot.counts.queued_jobs} queued`,
                },
                { name: 'Webhooks', value: 'operational' },
              ].map((row) => (
                <div
                  key={row.name}
                  className="row between"
                  style={{ padding: '6px 0', fontSize: 13 }}
                >
                  <span className="row" style={{ gap: 8 }}>
                    <CircleDot size={11} style={{ color: 'var(--success)' }} />
                    <span>{row.name}</span>
                  </span>
                  <span className="muted mono" style={{ fontSize: 12 }}>
                    {row.value}
                  </span>
                </div>
              ))}
            </div>
          </article>
        </div>
      </div>
    </div>
  );
}
