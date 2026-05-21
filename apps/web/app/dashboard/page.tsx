import { OrganizationSwitcher, UserButton } from '@clerk/nextjs';
import { getDashboardSnapshot } from '@mnemis/saas';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  BookOpen,
  CreditCard,
  Database,
  FileSearch,
  KeyRound,
  Plus,
  RefreshCw,
  Search,
  ServerCog,
  ShieldCheck,
  Terminal,
} from 'lucide-react';
import { cookies } from 'next/headers';
import { getDashboardDb } from '../../lib/db';
import { requireDashboardContext } from '../../lib/session';
import {
  createApiKeyAction,
  createResearchAction,
  createSourceAction,
  openBillingPortalAction,
  revokeApiKeyAction,
  startCheckoutAction,
} from './actions';

export const dynamic = 'force-dynamic';

function date(value: Date | string | null | undefined): string {
  if (!value) return 'Never';
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function pct(used: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.round((used / total) * 100));
}

function statusClass(status: string): string {
  if (status === 'indexed' || status === 'active') return 'pill good';
  if (status === 'failed' || status === 'past_due' || status === 'canceled') return 'pill bad';
  return 'pill neutral';
}

export default async function DashboardPage() {
  const context = await requireDashboardContext();
  const snapshot = await getDashboardSnapshot(getDashboardDb(), context);
  const cookieStore = await cookies();
  const newKey = cookieStore.get('mnemis_new_api_key')?.value ?? null;
  const flash = cookieStore.get('mnemis_dashboard_flash')?.value ?? null;
  const apiUrl =
    process.env.NEXT_PUBLIC_MNEMIS_API_URL ?? process.env.MNEMIS_API_URL ?? 'http://localhost:8787';
  const usagePercent = pct(snapshot.usage.credits_used, snapshot.usage.credits_limit);
  const proPrice = process.env.STRIPE_PRICE_ID_PRO;

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <ServerCog size={20} />
          <span>Mnemis</span>
        </div>
        <nav aria-label="Dashboard sections">
          <a href="#overview">
            <Activity size={17} />
            Overview
          </a>
          <a href="#sources">
            <Database size={17} />
            Sources
          </a>
          <a href="#research">
            <FileSearch size={17} />
            Research
          </a>
          <a href="#agent">
            <Terminal size={17} />
            Agent setup
          </a>
          <a href="#billing">
            <CreditCard size={17} />
            Billing
          </a>
        </nav>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Beta workspace</p>
            <h1>{snapshot.workspace.name}</h1>
          </div>
          <div className="topbar-actions">
            <OrganizationSwitcher hidePersonal />
            <UserButton />
          </div>
        </header>

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

        <section id="overview" className="metric-grid">
          <article className="metric">
            <span>Sources</span>
            <strong>{snapshot.counts.sources}</strong>
            <small>{snapshot.counts.indexed_sources} indexed</small>
          </article>
          <article className="metric">
            <span>Research runs</span>
            <strong>{snapshot.counts.research_runs}</strong>
            <small>{snapshot.counts.queued_jobs} jobs queued</small>
          </article>
          <article className="metric">
            <span>Memories</span>
            <strong>{snapshot.counts.memories}</strong>
            <small>{snapshot.counts.chunks} indexed chunks</small>
          </article>
          <article className="metric">
            <span>Credits</span>
            <strong>{snapshot.usage.credits_remaining}</strong>
            <small>{snapshot.usage.credits_used} used this month</small>
          </article>
        </section>

        <section className="two-column">
          <article id="sources" className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Knowledge</p>
                <h2>Sources</h2>
              </div>
              <Database size={19} />
            </div>
            <form className="inline-form" action={createSourceAction}>
              <select name="kind" aria-label="Source type" defaultValue="docs_site">
                <option value="docs_site">Docs site</option>
                <option value="web_page">Web page</option>
                <option value="pdf_document">PDF</option>
              </select>
              <input name="identifier" type="url" placeholder="https://docs.example.com" required />
              <input name="displayName" placeholder="Display name" />
              <button type="submit" title="Queue source">
                <Plus size={17} />
                Queue
              </button>
            </form>
            <div className="table-list">
              {snapshot.recent_sources.length === 0 ? (
                <p className="empty">No sources yet.</p>
              ) : (
                snapshot.recent_sources.map((source) => (
                  <div className="row" key={source.id}>
                    <div>
                      <strong>{source.displayName}</strong>
                      <span>{source.identifier}</span>
                    </div>
                    <span className={statusClass(source.status)}>{source.status}</span>
                  </div>
                ))
              )}
            </div>
          </article>

          <article id="research" className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Discovery</p>
                <h2>Research run</h2>
              </div>
              <Search size={19} />
            </div>
            <form className="stack-form" action={createResearchAction}>
              <textarea
                name="query"
                placeholder="Find state-of-the-art approaches for agent memory and cited research over PDFs"
                required
              />
              <div className="form-row">
                <select name="depth" defaultValue="standard" aria-label="Research depth">
                  <option value="quick">Quick</option>
                  <option value="standard">Standard</option>
                  <option value="deep">Deep</option>
                </select>
                <button type="submit">
                  <FileSearch size={17} />
                  Start research
                </button>
              </div>
            </form>
            {snapshot.counts.failed_jobs > 0 ? (
              <div className="risk-line">
                <AlertTriangle size={17} />
                {snapshot.counts.failed_jobs} failed jobs need review.
              </div>
            ) : (
              <div className="ok-line">
                <ShieldCheck size={17} />
                No failed jobs in this workspace.
              </div>
            )}
          </article>
        </section>

        <section className="two-column">
          <article id="agent" className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Agent access</p>
                <h2>MCP and API keys</h2>
              </div>
              <KeyRound size={19} />
            </div>
            <form className="inline-form compact" action={createApiKeyAction}>
              <input name="name" placeholder="Cursor / Claude / Codex key" />
              <button type="submit">
                <KeyRound size={17} />
                Create key
              </button>
            </form>
            <pre className="command">{`MNEMIS_API_URL=${apiUrl}
MNEMIS_API_KEY=mn_...
npx @mnemis/mcp`}</pre>
            <div className="table-list">
              {snapshot.api_keys.map((key) => (
                <div className="row" key={key.id}>
                  <div>
                    <strong>{key.name}</strong>
                    <span>
                      {key.prefix}... · last used {date(key.lastUsedAt)} · created{' '}
                      {date(key.createdAt)}
                    </span>
                  </div>
                  {key.revokedAt ? (
                    <span className="pill bad">revoked</span>
                  ) : (
                    <form action={revokeApiKeyAction}>
                      <input name="id" type="hidden" value={key.id} />
                      <button className="icon-button" type="submit" title="Revoke key">
                        <RefreshCw size={16} />
                      </button>
                    </form>
                  )}
                </div>
              ))}
            </div>
          </article>

          <article id="billing" className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Commercial control</p>
                <h2>Billing and usage</h2>
              </div>
              <CreditCard size={19} />
            </div>
            <div className="usage-bar" aria-label="Credit usage">
              <span style={{ width: `${usagePercent}%` }} />
            </div>
            <p className="usage-copy">
              {snapshot.usage.credits_used} of {snapshot.usage.credits_limit} credits used. Period
              resets {date(snapshot.usage.period_end)}.
            </p>
            <div className="billing-state">
              <BookOpen size={17} />
              <span>
                Subscription: <strong>{snapshot.subscription?.status ?? 'not configured'}</strong>
              </span>
            </div>
            <div className="billing-actions">
              <form action={startCheckoutAction}>
                <input name="priceId" type="hidden" value={proPrice ?? ''} />
                <button type="submit">
                  <ArrowUpRight size={17} />
                  Upgrade
                </button>
              </form>
              <form action={openBillingPortalAction}>
                <button className="secondary-action" type="submit">
                  Portal
                </button>
              </form>
            </div>
          </article>
        </section>
      </section>
    </main>
  );
}
