import { Settings } from 'lucide-react';
import { getCachedDashboardSnapshot } from '../../../lib/session';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const snapshot = await getCachedDashboardSnapshot();
  return (
    <div className="page">
      <div className="page-head">
        <div className="title">
          <h1>Workspace settings</h1>
          <p>General settings, members, and infrastructure for this workspace.</p>
        </div>
      </div>

      <article className="card">
        <header className="section-head">
          <div className="left">
            <Settings size={15} className="lead" />
            <h2>Workspace</h2>
          </div>
        </header>
        <div style={{ padding: 16, display: 'grid', gap: 12, fontSize: 13 }}>
          <div className="row between">
            <span className="muted">Name</span>
            <strong>{snapshot.workspace.name}</strong>
          </div>
          <div className="row between">
            <span className="muted">Role</span>
            <span className="badge outline">{snapshot.role}</span>
          </div>
          <div className="row between">
            <span className="muted">Workspace ID</span>
            <span className="mono subtle" style={{ fontSize: 12 }}>
              {snapshot.workspace.id}
            </span>
          </div>
        </div>
      </article>

      <article className="card" style={{ marginTop: 16 }}>
        <header className="section-head">
          <div className="left">
            <Settings size={15} className="lead" />
            <h2>Members & infrastructure</h2>
          </div>
        </header>
        <p className="empty">Member management and region controls are rolling out soon.</p>
      </article>
    </div>
  );
}
