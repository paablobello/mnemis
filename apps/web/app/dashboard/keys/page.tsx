import {
  ExternalLink,
  Key,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Terminal,
  Workflow,
} from 'lucide-react';
import { cookies } from 'next/headers';
import { getCachedDashboardSnapshot } from '../../../lib/session';
import { createApiKeyAction, revokeApiKeyAction } from '../actions';

export const dynamic = 'force-dynamic';

function date(value: Date | string | null | undefined): string {
  if (!value) return 'Never';
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
  }).format(new Date(value));
}

export default async function KeysPage() {
  const snapshot = await getCachedDashboardSnapshot();
  const cookieStore = await cookies();
  const newKey = cookieStore.get('mnemis_new_api_key')?.value ?? null;
  const flash = cookieStore.get('mnemis_dashboard_flash')?.value ?? null;
  const apiUrl =
    process.env.NEXT_PUBLIC_MNEMIS_API_URL ?? process.env.MNEMIS_API_URL ?? 'http://localhost:8787';
  const activeKeys = snapshot.api_keys.filter((k) => !k.revokedAt);

  return (
    <div className="page">
      <div className="page-head">
        <div className="title">
          <h1>MCP & API keys</h1>
          <p>
            Wire Cursor, Claude Code, Codex, or any MCP-aware agent to this workspace. One key per
            agent — revoke any time.
          </p>
        </div>
      </div>

      {flash ? <div className="notice">{flash}</div> : null}
      {newKey ? (
        <div className="secret-banner">
          <ShieldCheck size={18} />
          <div>
            <strong>New API key created. Store it now — it won&apos;t be shown again.</strong>
            <code>{newKey}</code>
          </div>
        </div>
      ) : null}

      <div className="two-col">
        <article className="card">
          <header className="section-head">
            <div className="left">
              <Terminal size={15} className="lead" />
              <h2>One-line MCP setup</h2>
            </div>
            <div className="right">
              <a
                className="btn btn-ghost btn-sm"
                href="https://docs.mnemis.dev/mcp"
                target="_blank"
                rel="noreferrer noopener"
              >
                <ExternalLink size={12} />
                Docs
              </a>
            </div>
          </header>
          <div style={{ padding: 16 }}>
            <p
              style={{
                fontSize: 13,
                color: 'var(--fg-muted)',
                margin: '0 0 12px',
                lineHeight: 1.55,
              }}
            >
              Add this to your agent&apos;s config. The CLI pins a workspace, exchanges the key for
              an MCP session, and streams sources, memory, and research tools.
            </p>
            <pre className="code">{`# macOS / Linux
MNEMIS_API_URL=${apiUrl}
MNEMIS_API_KEY=mn_live_...

npx @mnemis/mcp`}</pre>
            <div className="row" style={{ marginTop: 12, gap: 6, flexWrap: 'wrap' }}>
              <span className="badge">
                <Workflow size={11} />
                Cursor
              </span>
              <span className="badge">
                <Sparkles size={11} />
                Claude Code
              </span>
              <span className="badge">
                <Workflow size={11} />
                Codex
              </span>
              <span className="badge">
                <Workflow size={11} />
                Any MCP client
              </span>
            </div>
          </div>
        </article>

        <article className="card">
          <header className="section-head">
            <div className="left">
              <Key size={15} className="lead" />
              <h2>Create a new key</h2>
            </div>
          </header>
          <form action={createApiKeyAction} style={{ padding: 16, display: 'grid', gap: 10 }}>
            <label style={{ display: 'grid', gap: 5, fontSize: 12, color: 'var(--fg-muted)' }}>
              <span>Name</span>
              <input className="input" name="name" placeholder="Cursor — laptop" />
            </label>
            <button
              className="btn btn-accent btn-sm"
              type="submit"
              style={{ marginTop: 6, alignSelf: 'flex-start' }}
            >
              <Key size={13} />
              Create key
            </button>
          </form>
        </article>
      </div>

      <article className="card" style={{ marginTop: 16 }}>
        <header className="section-head">
          <div className="left">
            <Key size={15} className="lead" />
            <h2>Active keys</h2>
            <span className="badge">{activeKeys.length}</span>
          </div>
        </header>
        {snapshot.api_keys.length === 0 ? (
          <p className="empty">No keys yet — create one above.</p>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Name</th>
                <th>Key</th>
                <th>Status</th>
                <th>Last used</th>
                <th>Created</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {snapshot.api_keys.map((key) => (
                <tr key={key.id}>
                  <td>
                    <div className="cell-pri">{key.name}</div>
                  </td>
                  <td className="mono" style={{ color: 'var(--fg-muted)', fontSize: 12.5 }}>
                    {key.prefix}…
                  </td>
                  <td>
                    {key.revokedAt ? (
                      <span className="badge danger">revoked</span>
                    ) : (
                      <span className="badge success">
                        <span className="dot" />
                        active
                      </span>
                    )}
                  </td>
                  <td className="cell-sec">{date(key.lastUsedAt)}</td>
                  <td className="cell-sec">{date(key.createdAt)}</td>
                  <td className="actions">
                    {!key.revokedAt ? (
                      <form action={revokeApiKeyAction}>
                        <input type="hidden" name="id" value={key.id} />
                        <button className="btn btn-sm btn-danger" type="submit">
                          <RefreshCw size={12} />
                          Revoke
                        </button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </article>
    </div>
  );
}
