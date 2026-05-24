import { Activity, ExternalLink, Layers, Zap } from 'lucide-react';
import { getCachedDashboardSnapshot } from '../../../lib/session';

export const dynamic = 'force-dynamic';

function formatNumber(value: number): string {
  return value.toLocaleString('en-US');
}

function Metric({
  label,
  value,
  delta,
  icon: Icon,
}: {
  label: string;
  value: string;
  delta?: string;
  icon: typeof Layers;
}) {
  return (
    <article className="metric">
      <div className="label">
        <Icon size={13} />
        {label}
      </div>
      <div className="value">{value}</div>
      {delta ? <div className="delta">{delta}</div> : null}
    </article>
  );
}

export default async function MemoryPage() {
  const snapshot = await getCachedDashboardSnapshot();
  return (
    <div className="page">
      <div className="page-head">
        <div className="title">
          <h1>Memory</h1>
          <p>
            Typed records your agents can read and write. Scoped per workspace, user, or agent —
            with TTLs and observability.
          </p>
        </div>
        <div className="row">
          <a
            className="btn btn-outline btn-sm"
            href="https://docs.mnemis.dev/memory"
            target="_blank"
            rel="noreferrer noopener"
          >
            <ExternalLink size={13} />
            Schema docs
          </a>
        </div>
      </div>

      <section className="metric-row" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
        <Metric
          label="Records"
          value={formatNumber(snapshot.counts.memories)}
          delta={`${formatNumber(snapshot.counts.chunks)} indexed chunks`}
          icon={Layers}
        />
        <Metric label="Read p50" value="—" delta="metrics coming soon" icon={Zap} />
        <Metric label="Write p50" value="—" delta="metrics coming soon" icon={Activity} />
      </section>

      <article className="card">
        <header className="section-head">
          <div className="left">
            <Layers size={15} className="lead" />
            <h2>Records explorer</h2>
          </div>
        </header>
        <p className="empty">
          The memory records explorer is rolling out behind a beta flag. Hook agents up via MCP and
          new records will surface here automatically.
        </p>
      </article>
    </div>
  );
}
