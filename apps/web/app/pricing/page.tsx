import { Show, SignInButton } from '@clerk/nextjs';
import { auth } from '@clerk/nextjs/server';
import { asc, plans } from '@mnemis/db';
import { getPlanForWorkspace } from '@mnemis/saas';
import { ArrowRight, Check, Mail, Radar } from 'lucide-react';
import Link from 'next/link';
import { isClerkConfigured } from '../../lib/config';
import { getDashboardDb } from '../../lib/db';
import { requireDashboardContext } from '../../lib/session';
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

  return (
    <main className="public-shell">
      <header className="public-hero">
        <Link href="/" className="brand-mark" style={{ textDecoration: 'none' }}>
          <Radar size={20} />
          <span>Mnemis</span>
        </Link>
        <h1>Plans for every stage.</h1>
        <p>
          Hosted agent memory, indexed sources, cited research, and MCP keys. Start free, upgrade
          when you need more credits or more sources.
        </p>
      </header>

      <section className="pricing-grid" aria-label="Plans">
        {tiers.map((tier) => {
          const isCurrent = currentPlanId === tier.id;
          return (
            <article key={tier.id} className={`plan-card${isCurrent ? ' current' : ''}`}>
              <header className="plan-card-head">
                <span className="eyebrow">{tier.name}</span>
                <strong className="plan-price">
                  {tier.priceLabel}
                  {tier.hasStripePrice ? <small>/mo</small> : null}
                </strong>
                {tier.description ? <p>{tier.description}</p> : null}
              </header>
              <ul className="plan-features">
                <li>
                  <Check size={16} />
                  {fmt(tier.monthlyCredits, 'credits/mo')}
                </li>
                <li>
                  <Check size={16} />
                  {fmt(tier.maxSources, 'sources')}
                </li>
                <li>
                  <Check size={16} />
                  {fmt(tier.maxResearchRunsPerMonth, 'research runs/mo')}
                </li>
              </ul>
              <footer className="plan-card-foot">
                {isCurrent ? (
                  <span className="pill good">Current plan</span>
                ) : tier.hasStripePrice ? (
                  isClerkConfigured() ? (
                    <Show when="signed-in">
                      <form action={subscribeToTierAction}>
                        <input type="hidden" name="planId" value={tier.id} />
                        <button className="primary-action" type="submit">
                          Subscribe
                          <ArrowRight size={16} />
                        </button>
                      </form>
                    </Show>
                  ) : null
                ) : (
                  <span className="pill neutral">No payment required</span>
                )}
                {tier.hasStripePrice && isClerkConfigured() ? (
                  <Show when="signed-out">
                    <SignInButton mode="modal">
                      <button className="primary-action" type="button">
                        Sign in to subscribe
                        <ArrowRight size={16} />
                      </button>
                    </SignInButton>
                  </Show>
                ) : null}
              </footer>
            </article>
          );
        })}

        <article className="plan-card enterprise">
          <header className="plan-card-head">
            <span className="eyebrow">Enterprise</span>
            <strong className="plan-price">Custom</strong>
            <p>SOC 2, SLA, dedicated support, and custom infrastructure for regulated teams.</p>
          </header>
          <ul className="plan-features">
            <li>
              <Check size={16} />
              Unlimited everything
            </li>
            <li>
              <Check size={16} />
              SOC 2 + SLA
            </li>
            <li>
              <Check size={16} />
              Dedicated onboarding
            </li>
          </ul>
          <footer className="plan-card-foot">
            <a
              className="secondary-action"
              href="mailto:hello@mnemis.dev?subject=Enterprise%20plan"
            >
              <Mail size={16} />
              Contact us
            </a>
          </footer>
        </article>
      </section>
    </main>
  );
}
