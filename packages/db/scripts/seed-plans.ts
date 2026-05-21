/**
 * Seed the `plans` table with Mnemis tiers.
 *
 * Reads STRIPE_PRICE_BUILDER, STRIPE_PRICE_TEAM, STRIPE_PRICE_BUSINESS from env.
 * Free has no Stripe price. Enterprise is contact-us only and not seeded.
 *
 * Usage:
 *   bun run packages/db/scripts/seed-plans.ts
 *
 * Idempotent: upserts on `plans.id`. Re-run after changing prices in Stripe.
 */
import { createDatabase, plans } from '../src/index.ts';

interface PlanSeed {
  id: string;
  name: string;
  description: string;
  stripePriceId: string | null;
  monthlyCredits: number;
  includedSeats: number;
  maxSources: number | null;
  maxResearchRunsPerMonth: number | null;
  features: Record<string, unknown>;
}

// Must equal UNLIMITED_CREDITS_SENTINEL in packages/saas/src/index.ts. Duplicated
// here to avoid db → saas dependency. Saas helpers treat plan.monthlyCredits >=
// this value as "no cap".
const UNLIMITED_CREDITS_SENTINEL = 999_999_999;

function priceFromEnv(key: string): string | null {
  const value = process.env[key]?.trim();
  return value && value.length > 0 ? value : null;
}

const seeds: PlanSeed[] = [
  {
    id: 'free',
    name: 'Free',
    description: 'Get started. 1,000 credits/month, up to 3 indexed sources.',
    stripePriceId: null,
    monthlyCredits: 1_000,
    includedSeats: 1,
    maxSources: 3,
    maxResearchRunsPerMonth: 5,
    features: { unlimited: false },
  },
  {
    id: 'builder',
    name: 'Builder',
    description: 'Solo dev or small projects. 15,000 credits/month, 50 sources.',
    stripePriceId: priceFromEnv('STRIPE_PRICE_BUILDER'),
    monthlyCredits: 15_000,
    includedSeats: 1,
    maxSources: 50,
    maxResearchRunsPerMonth: 30,
    features: { unlimited: false },
  },
  {
    id: 'team',
    name: 'Team',
    description: 'For small teams sharing a workspace. 75,000 credits/month, 500 sources.',
    stripePriceId: priceFromEnv('STRIPE_PRICE_TEAM'),
    monthlyCredits: 75_000,
    includedSeats: 1,
    maxSources: 500,
    maxResearchRunsPerMonth: 200,
    features: { unlimited: false },
  },
  {
    id: 'business',
    name: 'Business',
    description: 'Unlimited credits, sources and research runs. Dedicated support.',
    stripePriceId: priceFromEnv('STRIPE_PRICE_BUSINESS'),
    monthlyCredits: UNLIMITED_CREDITS_SENTINEL,
    includedSeats: 1,
    maxSources: null,
    maxResearchRunsPerMonth: null,
    features: { unlimited: true, dedicated_support: true },
  },
];

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const db = createDatabase({ url });

try {
  for (const seed of seeds) {
    await db
      .insert(plans)
      .values({
        id: seed.id,
        name: seed.name,
        description: seed.description,
        stripePriceId: seed.stripePriceId,
        monthlyCredits: seed.monthlyCredits,
        includedSeats: seed.includedSeats,
        maxSources: seed.maxSources,
        maxResearchRunsPerMonth: seed.maxResearchRunsPerMonth,
        features: seed.features,
        active: true,
      })
      .onConflictDoUpdate({
        target: plans.id,
        set: {
          name: seed.name,
          description: seed.description,
          stripePriceId: seed.stripePriceId,
          monthlyCredits: seed.monthlyCredits,
          includedSeats: seed.includedSeats,
          maxSources: seed.maxSources,
          maxResearchRunsPerMonth: seed.maxResearchRunsPerMonth,
          features: seed.features,
          active: true,
          updatedAt: new Date(),
        },
      });

    const priceLabel = seed.stripePriceId ?? '(no Stripe price)';
    console.log(`  ${seed.id.padEnd(10)} ${seed.name.padEnd(10)} ${priceLabel}`);
  }
  console.log('');
  console.log(`  Seeded ${seeds.length} plans.`);
} catch (err) {
  console.error('seed-plans failed:', err);
  process.exit(1);
} finally {
  process.exit(0);
}
