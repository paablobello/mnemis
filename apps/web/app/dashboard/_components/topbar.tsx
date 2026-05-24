'use client';

import { Bell, ChevronRight, Command, Sparkles } from 'lucide-react';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

const TITLES: Record<string, string> = {
  '/dashboard': 'Overview',
  '/dashboard/sources': 'Sources',
  '/dashboard/research': 'Research',
  '/dashboard/memory': 'Memory',
  '/dashboard/keys': 'MCP & Keys',
  '/dashboard/billing': 'Billing & usage',
  '/dashboard/settings': 'Workspace settings',
};

export function Topbar({
  workspaceName,
  authControls,
}: {
  workspaceName: string;
  authControls?: ReactNode;
}) {
  const pathname = usePathname();
  const title = TITLES[pathname] ?? 'Dashboard';
  return (
    <header className="topbar">
      <div className="crumbs">
        <span>Mnemis</span>
        <ChevronRight size={13} className="sep" />
        <span>{workspaceName}</span>
        <ChevronRight size={13} className="sep" />
        <strong>{title}</strong>
      </div>
      <div className="topbar-actions">
        <button className="btn btn-ghost btn-sm" type="button" title="Changelog">
          <Sparkles size={14} /> What&apos;s new
        </button>
        <button className="btn btn-outline btn-sm" type="button">
          <Command size={13} />
          <span className="kbd" style={{ marginLeft: 2 }}>
            K
          </span>
        </button>
        <button className="btn btn-icon btn-ghost" type="button" title="Notifications">
          <Bell size={15} />
        </button>
        {authControls}
      </div>
    </header>
  );
}
