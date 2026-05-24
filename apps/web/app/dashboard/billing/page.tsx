import { Activity, ArrowUp, Check, CreditCard, ExternalLink } from 'lucide-react';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { getCachedDashboardSnapshot } from '../../../lib/session';
import { openBillingPortalAction } from '../actions';

export const dynamic = 'force-dynamic';

function formatNumber(value: number | null): string {
  if (value === null) return 'Unlimited';
  return value.toLocaleString('en-US');
}

function formatPeriod(value: Date | string | null | undefined): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(
    new Date(value),
  );
}

interface QuotaRow {
  label: string;
  used: number;
  max: number | null;
  suffix?: string;
}

function UsageRow({ row }: { row: QuotaRow }) {
  const unlimited = row.max === null;
  const pct = unlimited
    ? 0
    : Math.min(100, Math.round((row.used / Math.max(1, row.max ?? 1)) * 100));
  const tone = pct > 85 ? 'danger' : pct > 65 ? 'warn' : '';
  return (
    <div className={`usage-row ${tone}`}>
      <header>
        <strong>{row.label}</strong>
        <span>
          {row.used.toLocaleString('en-US')} /{' '}
          {unlimited ? '∞' : (row.max ?? 0).toLocaleString('en-US')}
        </span>
      </header>
      {unlimited ? null : (
        <div className="bar">
          <span style={{ width: `${pct}%` }} />
        </div>
      )}
      <footer>{row.suffix ?? (unlimited ? 'Unlimited' : `${pct}% used`)}</footer>
    </div>
  );
}

export default async function BillingPage() {
  const snapshot = await getCachedDashboardSnapshot();
  const cookieStore = await cookies();
  const flash = cookieStore.get('mnemis_dashboard_flash')?.value ?? null;

  const periodLabel = `${formatPeriod(snapshot.usage.period_start)} — ${formatPeriod(snapshot.usage.period_end)}`;

  const quotas: QuotaRow[] = [
    {
      label: 'Credits',
      used: snapshot.usage.credits_used,
      max: snapshot.usage.credits_unlimited ? null : snapshot.usage.credits_limit,
      suffix: `Resets ${formatPeriod(snapshot.usage.period_end)}`,
    },
    {
      label: 'Sources',
      used: snapshot.quotas.sources.used,
      max: snapshot.quotas.sources.max,
    },
    {
      label: 'Research runs',
      used: snapshot.quotas.research_runs.used,
      max: snapshot.quotas.research_runs.max,
      suffix: 'this month',
    },
  ];

  return (
    <div className="page">
      <div className="page-head">
        <div className="title">
          <h1>Billing & usage</h1>
          <p>
            Credits, plan, and usage for the <strong>{snapshot.workspace.name}</strong> workspace.
          </p>
        </div>
        <div className="row">
          <form action={openBillingPortalAction}>
            <button className="btn btn-outline btn-sm" type="submit">
              <ExternalLink size={13} />
              Stripe portal
            </button>
          </form>
          <Link className="btn btn-accent btn-sm" href="/pricing">
            <ArrowUp size={13} />
            Upgrade plan
          </Link>
        </div>
      </div>

      {flash ? <div className="notice">{flash}</div> : null}

      <div className="two-col">
        <article className="card">
          <header className="section-head">
            <div className="left">
              <Activity size={15} className="lead" />
              <h2>Usage this period</h2>
            </div>
            <div className="right">
              <span className="mono subtle" style={{ fontSize: 11.5 }}>
                {periodLabel}
              </span>
            </div>
          </header>
          <div>
            {quotas.map((row) => (
              <UsageRow key={row.label} row={row} />
            ))}
          </div>
        </article>

        <article className="card">
          <header className="section-head">
            <div className="left">
              <CreditCard size={15} className="lead" />
              <h2>Current plan</h2>
            </div>
            <div className="right">
              <span className="badge success">
                <span className="dot" />
                {snapshot.subscription?.status ?? 'free'}
              </span>
            </div>
          </header>
          <div style={{ padding: 16, display: 'grid', gap: 12 }}>
            <div>
              <div className="eyebrow">{snapshot.plan.name} plan</div>
              {snapshot.plan.description ? (
                <p className="muted" style={{ fontSize: 13, margin: '8px 0 0' }}>
                  {snapshot.plan.description}
                </p>
              ) : null}
              {snapshot.subscription?.currentPeriodEnd ? (
                <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>
                  Next invoice{' '}
                  <strong style={{ color: 'var(--fg-2)' }}>
                    {formatPeriod(snapshot.subscription.currentPeriodEnd)}
                  </strong>
                </div>
              ) : null}
            </div>
            <hr className="divider" />
            <ul className="plan-features">
              <li>
                <Check size={14} />
                {snapshot.usage.credits_unlimited
                  ? 'Unlimited credits / mo'
                  : `${formatNumber(snapshot.plan.monthlyCredits)} credits / mo`}
              </li>
              <li>
                <Check size={14} />
                {snapshot.plan.maxSources === null
                  ? 'Unlimited sources'
                  : `${formatNumber(snapshot.plan.maxSources)} sources`}
              </li>
              <li>
                <Check size={14} />
                {snapshot.plan.maxResearchRunsPerMonth === null
                  ? 'Unlimited research runs / mo'
                  : `${formatNumber(snapshot.plan.maxResearchRunsPerMonth)} research runs / mo`}
              </li>
              <li>
                <Check size={14} />
                Unlimited MCP keys
              </li>
            </ul>
            <div className="row" style={{ gap: 6, marginTop: 4 }}>
              <Link className="btn btn-soft btn-sm" href="/pricing" style={{ flex: 1 }}>
                Compare plans
              </Link>
            </div>
          </div>
        </article>
      </div>
    </div>
  );
}
