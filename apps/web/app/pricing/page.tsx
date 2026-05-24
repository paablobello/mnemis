import { Show, SignInButton } from '@clerk/nextjs';
import { auth } from '@clerk/nextjs/server';
import { asc, plans } from '@mnemis/db';
import { getPlanForWorkspace } from '@mnemis/saas';
import { ArrowRight, Check, Mail, Radar } from 'lucide-react';
import Link from 'next/link';
import { isClerkConfigured } from '../../lib/config';
import { getDashboardDb } from '../../lib/db';
import { requireDashboardContext } from '../../lib/session';
import { ClerkClientProvider } from '../clerk-controls';
import { subscribeToTierAction } from './actions';

export const dynamic = 'force-dynamic';

interface DisplayPlan {
  id: string;
  name: string;
  priceLabel: string;
  description: string | null;
  monthlyCredits: number | null;
  maxSources: number | null;
  maxResearchRunsPerMonth: number | null;
  hasStripePrice: boolean;
}

function priceLabel(monthlyCredits: number, stripePriceId: string | null): string {
  if (!stripePriceId) return '$0';
  if (monthlyCredits >= 999_999_999) return '$99';
  return monthlyCredits >= 75_000 ? '$50' : '$15';
}

function fmt(value: number | null, unit: string): string {
  if (value === null) return 'Unlimited';
  return `${value.toLocaleString('en-US')} ${unit}`;
}

async function loadCurrentPlanId(): Promise<string | null> {
  if (!isClerkConfigured()) return null;
  try {
    const { userId } = await auth();
    if (!userId) return null;
    const context = await requireDashboardContext();
    const plan = await getPlanForWorkspace(getDashboardDb(), context.workspace.id);
    return plan.id;
  } catch {
    return null;
  }
}

export default async function PricingPage() {
  const clerkConfigured = isClerkConfigured();
  const [planRows, currentPlanId] = await Promise.all([
    getDashboardDb().select().from(plans).orderBy(asc(plans.monthlyCredits)),
    loadCurrentPlanId(),
  ]);

  const tiers: DisplayPlan[] = planRows
    .filter((p) => p.active)
    .map((p) => ({
      id: p.id,
      name: p.name,
      priceLabel: priceLabel(p.monthlyCredits, p.stripePriceId),
      description: p.description,
      monthlyCredits: p.monthlyCredits >= 999_999_999 ? null : p.monthlyCredits,
      maxSources: p.maxSources,
      maxResearchRunsPerMonth: p.maxResearchRunsPerMonth,
      hasStripePrice: Boolean(p.stripePriceId),
    }));

  const page = (
    <main className="public-shell">
      <header className="public-hero">
        <Link href="/" className="brand-mark">
          <Radar size={20} />
          <span>Mnemis</span>
        </Link>
        <h1>Plans for every stage.</h1>
        <p>
          Hosted agent memory, indexed sources, cited research, and MCP keys. Start free, upgrade
          when you need more credits or more sources.
        </p>
      </header>

      <section className="plan-grid" aria-label="Plans">
        {tiers.map((tier) => {
          const isCurrent = currentPlanId === tier.id;
          return (
            <article key={tier.id} className={`plan-card${isCurrent ? ' current' : ''}`}>
              <div>
                <span className="eyebrow">{tier.name}</span>
                <div className="price" style={{ marginTop: 6 }}>
                  {tier.priceLabel}
                  {tier.hasStripePrice ? <small>/mo</small> : null}
                </div>
                {tier.description ? (
                  <p className="muted" style={{ fontSize: 13, margin: '8px 0 0', lineHeight: 1.5 }}>
                    {tier.description}
                  </p>
                ) : null}
              </div>
              <ul className="plan-features">
                <li>
                  <Check size={14} />
                  {fmt(tier.monthlyCredits, 'credits/mo')}
                </li>
                <li>
                  <Check size={14} />
                  {fmt(tier.maxSources, 'sources')}
                </li>
                <li>
                  <Check size={14} />
                  {fmt(tier.maxResearchRunsPerMonth, 'research runs/mo')}
                </li>
              </ul>
              <div style={{ marginTop: 'auto', display: 'grid', gap: 8 }}>
                {isCurrent ? (
                  <span
                    className="badge success"
                    style={{ justifyContent: 'center', padding: '6px 10px' }}
                  >
                    Current plan
                  </span>
                ) : tier.hasStripePrice ? (
                  clerkConfigured ? (
                    <Show when="signed-in">
                      <form action={subscribeToTierAction}>
                        <input type="hidden" name="planId" value={tier.id} />
                        <button
                          className="btn btn-accent"
                          type="submit"
                          style={{ width: '100%', justifyContent: 'center' }}
                        >
                          Subscribe
                          <ArrowRight size={14} />
                        </button>
                      </form>
                    </Show>
                  ) : null
                ) : (
                  <span
                    className="badge accent"
                    style={{ justifyContent: 'center', padding: '6px 10px' }}
                  >
                    No payment required
                  </span>
                )}
                {tier.hasStripePrice && clerkConfigured ? (
                  <Show when="signed-out">
                    <SignInButton mode="modal">
                      <button
                        className="btn btn-outline"
                        type="button"
                        style={{ width: '100%', justifyContent: 'center' }}
                      >
                        Sign in to subscribe
                        <ArrowRight size={14} />
                      </button>
                    </SignInButton>
                  </Show>
                ) : null}
              </div>
            </article>
          );
        })}

        <article className="plan-card">
          <div>
            <span className="eyebrow">Enterprise</span>
            <div className="price" style={{ marginTop: 6 }}>
              Custom
            </div>
            <p className="muted" style={{ fontSize: 13, margin: '8px 0 0', lineHeight: 1.5 }}>
              SOC 2, SLA, dedicated support, and custom infrastructure for regulated teams.
            </p>
          </div>
          <ul className="plan-features">
            <li>
              <Check size={14} />
              Unlimited everything
            </li>
            <li>
              <Check size={14} />
              SOC 2 + SLA
            </li>
            <li>
              <Check size={14} />
              Dedicated onboarding
            </li>
          </ul>
          <div style={{ marginTop: 'auto' }}>
            <a
              className="btn btn-outline"
              href="mailto:hello@mnemis.dev?subject=Enterprise%20plan"
              style={{ width: '100%', justifyContent: 'center' }}
            >
              <Mail size={14} />
              Contact us
            </a>
          </div>
        </article>
      </section>
    </main>
  );

  return clerkConfigured ? <ClerkClientProvider>{page}</ClerkClientProvider> : page;
}
