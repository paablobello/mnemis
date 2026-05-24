'use client';

import {
  BookOpen,
  ChevronsUpDown,
  CreditCard,
  Database,
  ExternalLink,
  FlaskConical,
  Home,
  Key,
  Layers,
  Search,
  Settings,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface SidebarSnapshot {
  workspace: { name: string; region: string };
  plan: { name: string };
  counts: {
    sources: number;
    research_runs: number;
    memories: number;
  };
  api_keys_active: number;
  usage: {
    credits_used: number;
    credits_limit: number;
    credits_unlimited: boolean;
    resets_label: string;
  };
}

function initials(name: string): string {
  return name
    .split(/[-_\s]+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function Sidebar({ snapshot }: { snapshot: SidebarSnapshot }) {
  const pathname = usePathname();
  const workspace = [
    { href: '/dashboard', label: 'Overview', icon: Home, exact: true },
    {
      href: '/dashboard/sources',
      label: 'Sources',
      icon: Database,
      count: snapshot.counts.sources,
    },
    {
      href: '/dashboard/research',
      label: 'Research',
      icon: FlaskConical,
      count: snapshot.counts.research_runs,
    },
    { href: '/dashboard/memory', label: 'Memory', icon: Layers, count: snapshot.counts.memories },
    { href: '/dashboard/keys', label: 'MCP & Keys', icon: Key, count: snapshot.api_keys_active },
  ];
  const account = [
    { href: '/dashboard/billing', label: 'Billing & usage', icon: CreditCard },
    { href: '/dashboard/settings', label: 'Workspace settings', icon: Settings },
    { href: 'https://docs.mnemis.dev', label: 'Documentation', icon: BookOpen, external: true },
  ];

  const limit = snapshot.usage.credits_unlimited ? null : snapshot.usage.credits_limit;
  const pct = limit ? Math.min(100, Math.round((snapshot.usage.credits_used / limit) * 100)) : 0;

  function isActive(href: string, exact: boolean): boolean {
    if (exact) return pathname === href;
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <button className="ws-switcher" type="button">
          <div className="ws-avatar">{initials(snapshot.workspace.name)}</div>
          <div className="ws-meta">
            <strong>{snapshot.workspace.name}</strong>
            <span>
              {snapshot.plan.name} · {snapshot.workspace.region}
            </span>
          </div>
          <ChevronsUpDown size={14} style={{ color: 'var(--fg-subtle)' }} />
        </button>
      </div>

      <div className="sidebar-search">
        <Search size={13} className="lead" />
        <input className="input" placeholder="Search or jump to…" />
        <span className="kbd">⌘K</span>
      </div>

      <div className="sidebar-section">
        <div className="label">Workspace</div>
        {workspace.map((it) => (
          <Link
            key={it.href}
            href={it.href}
            className={`nav-item${isActive(it.href, Boolean(it.exact)) ? ' active' : ''}`}
          >
            <it.icon size={15} />
            <span>{it.label}</span>
            {typeof it.count === 'number' ? (
              <span className="count">{it.count.toLocaleString('en-US')}</span>
            ) : null}
          </Link>
        ))}
      </div>

      <div className="sidebar-section">
        <div className="label">Account</div>
        {account.map((it) =>
          it.external ? (
            <a
              key={it.href}
              href={it.href}
              className="nav-item"
              target="_blank"
              rel="noreferrer noopener"
            >
              <it.icon size={15} />
              <span>{it.label}</span>
              <ExternalLink size={12} style={{ marginLeft: 'auto', color: 'var(--fg-subtle)' }} />
            </a>
          ) : (
            <Link
              key={it.href}
              href={it.href}
              className={`nav-item${isActive(it.href, false) ? ' active' : ''}`}
            >
              <it.icon size={15} />
              <span>{it.label}</span>
            </Link>
          ),
        )}
      </div>

      <div className="sidebar-foot">
        <div className="usage-mini">
          <header>
            <strong>Credits</strong>
            <span>
              {snapshot.usage.credits_used.toLocaleString('en-US')}
              {limit ? ` / ${limit.toLocaleString('en-US')}` : ' / ∞'}
            </span>
          </header>
          <div className="bar">
            <span style={{ width: `${pct}%` }} />
          </div>
          <footer>
            <span>{snapshot.usage.resets_label}</span>
            <Link href="/pricing">Upgrade</Link>
          </footer>
        </div>
      </div>
    </aside>
  );
}
