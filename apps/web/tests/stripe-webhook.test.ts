import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import {
  billingCustomers,
  createDatabase,
  eq,
  plans,
  subscriptions,
  users,
  workspaces,
} from '@mnemis/db';
import type Stripe from 'stripe';
import { linkStripeCheckoutSession, upsertStripeSubscription } from '../lib/stripe-webhook.ts';

const url = process.env.DATABASE_URL;

const db = url ? createDatabase({ url, max: 1, idleTimeout: 1 }) : null;
const slug = `webhook-${randomBytes(4).toString('hex')}`;

let userId = '';
let workspaceId = '';

function subscriptionEvent(input: {
  id: string;
  workspaceId: string;
  priceId: string;
  status?: Stripe.Subscription.Status;
  planId?: string;
}): Stripe.Subscription {
  return {
    id: input.id,
    status: input.status ?? 'active',
    metadata: {
      workspace_id: input.workspaceId,
      ...(input.planId ? { plan_id: input.planId } : {}),
    },
    cancel_at_period_end: false,
    trial_end: null,
    items: {
      data: [
        {
          price: { id: input.priceId },
          current_period_start: 1_779_292_800,
          current_period_end: 1_781_884_800,
        },
      ],
    },
  } as unknown as Stripe.Subscription;
}

describe('Stripe webhook persistence', { skip: !db }, () => {
  before(async () => {
    const [user] = await db!
      .insert(users)
      .values({ email: `${slug}@mnemis.test`, name: slug })
      .returning({ id: users.id });
    userId = user!.id;
    const [workspace] = await db!
      .insert(workspaces)
      .values({ slug, name: slug, ownerId: userId })
      .returning({ id: workspaces.id });
    workspaceId = workspace!.id;
  });

  after(async () => {
    await db!.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await db!.delete(users).where(eq(users.id, userId));
  });

  it('updates the workspace subscription row when Stripe creates a new subscription id', async () => {
    const [builder] = await db!.select().from(plans).where(eq(plans.id, 'builder')).limit(1);
    const [team] = await db!.select().from(plans).where(eq(plans.id, 'team')).limit(1);
    assert.ok(builder?.stripePriceId);
    assert.ok(team?.stripePriceId);

    await db!.insert(subscriptions).values({
      workspaceId,
      planId: 'builder',
      stripeSubscriptionId: `sub_old_${randomBytes(4).toString('hex')}`,
      stripePriceId: builder.stripePriceId,
      status: 'canceled',
    });

    await upsertStripeSubscription(
      subscriptionEvent({
        id: `sub_new_${randomBytes(4).toString('hex')}`,
        workspaceId,
        priceId: team.stripePriceId,
      }),
      db!,
    );

    const rows = await db!
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.workspaceId, workspaceId));
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.planId, 'team');
    assert.equal(rows[0]!.stripePriceId, team.stripePriceId);
    assert.equal(rows[0]!.status, 'active');
  });

  it('links checkout customer data idempotently by workspace', async () => {
    const first = {
      metadata: { workspace_id: workspaceId },
      customer: `cus_${randomBytes(4).toString('hex')}`,
      customer_email: `${slug}@mnemis.test`,
      customer_details: null,
    } as unknown as Stripe.Checkout.Session;
    const second = {
      metadata: { workspace_id: workspaceId },
      customer: `cus_${randomBytes(4).toString('hex')}`,
      customer_email: `updated-${slug}@mnemis.test`,
      customer_details: null,
    } as unknown as Stripe.Checkout.Session;

    await linkStripeCheckoutSession(first, db!);
    await linkStripeCheckoutSession(second, db!);

    const rows = await db!
      .select()
      .from(billingCustomers)
      .where(eq(billingCustomers.workspaceId, workspaceId));
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.stripeCustomerId, second.customer);
    assert.equal(rows[0]!.billingEmail, second.customer_email);
  });
});
