import { UNLIMITED_CREDITS_SENTINEL } from '@mnemis/saas';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { isClerkConfigured } from '../../lib/config';
import { getCachedDashboardSnapshot } from '../../lib/session';
import { ClerkClientProvider, DashboardAuthControls } from '../clerk-controls';
import { Sidebar, type SidebarSnapshot } from './_components/sidebar';
import { Topbar } from './_components/topbar';

export const dynamic = 'force-dynamic';

function daysUntil(date: Date | string | null | undefined): string {
  if (!date) return 'No reset scheduled';
  const target = new Date(date).getTime();
  const now = Date.now();
  const diff = Math.max(0, Math.ceil((target - now) / (1000 * 60 * 60 * 24)));
  if (diff === 0) return 'Resets today';
  if (diff === 1) return 'Resets in 1 day';
  return `Resets in ${diff} days`;
}

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  if (!isClerkConfigured()) redirect('/?setup=missing-clerk');

  const snapshot = await getCachedDashboardSnapshot();

  const sidebarSnap: SidebarSnapshot = {
    workspace: {
      name: snapshot.workspace.name,
      region: process.env.MNEMIS_REGION ?? 'beta',
    },
    plan: { name: snapshot.plan.name },
    counts: {
      sources: snapshot.counts.sources,
      research_runs: snapshot.counts.research_runs,
      memories: snapshot.counts.memories,
    },
    api_keys_active: snapshot.api_keys.filter((k) => !k.revokedAt).length,
    usage: {
      credits_used: snapshot.usage.credits_used,
      credits_limit: snapshot.usage.credits_limit,
      credits_unlimited:
        snapshot.usage.credits_unlimited ||
        snapshot.usage.credits_limit >= UNLIMITED_CREDITS_SENTINEL,
      resets_label: daysUntil(snapshot.usage.period_end),
    },
  };

  return (
    <ClerkClientProvider>
      <div className="app">
        <Sidebar snapshot={sidebarSnap} />
        <main className="workspace">
          <Topbar
            workspaceName={snapshot.workspace.name}
            authControls={<DashboardAuthControls />}
          />
          {children}
        </main>
      </div>
    </ClerkClientProvider>
  );
}
