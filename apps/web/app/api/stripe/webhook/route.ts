import { billingCustomers, subscriptions } from '@mnemis/db';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { getDashboardDb } from '../../../../lib/db';
import { getStripe } from '../../../../lib/stripe';

export const runtime = 'nodejs';

function dateFromUnix(value: number | null | undefined): Date | null {
  return typeof value === 'number' ? new Date(value * 1000) : null;
}

function subscriptionWorkspaceId(subscription: Stripe.Subscription): string | null {
  return typeof subscription.metadata.workspace_id === 'string'
    ? subscription.metadata.workspace_id
    : null;
}

async function upsertSubscription(subscription: Stripe.Subscription): Promise<void> {
  const workspaceId = subscriptionWorkspaceId(subscription);
  const item = subscription.items.data[0];
  const priceId = item?.price.id;
  if (!workspaceId || !priceId) return;

  const db = getDashboardDb();
  const values = {
    workspaceId,
    planId: null,
    stripeSubscriptionId: subscription.id,
    stripePriceId: priceId,
    status: subscription.status,
    currentPeriodStart: dateFromUnix(item?.current_period_start),
    currentPeriodEnd: dateFromUnix(item?.current_period_end),
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    trialEnd: dateFromUnix(subscription.trial_end),
    updatedAt: new Date(),
  };

  await db.insert(subscriptions).values(values).onConflictDoUpdate({
    target: subscriptions.stripeSubscriptionId,
    set: values,
  });
}

async function linkCheckoutSession(session: Stripe.Checkout.Session): Promise<void> {
  const workspaceId =
    typeof session.metadata?.workspace_id === 'string' ? session.metadata.workspace_id : null;
  const customerId = typeof session.customer === 'string' ? session.customer : null;
  if (!workspaceId || !customerId) return;

  await getDashboardDb()
    .insert(billingCustomers)
    .values({
      workspaceId,
      stripeCustomerId: customerId,
      billingEmail: session.customer_details?.email ?? session.customer_email ?? null,
    })
    .onConflictDoUpdate({
      target: billingCustomers.workspaceId,
      set: {
        stripeCustomerId: customerId,
        billingEmail: session.customer_details?.email ?? session.customer_email ?? null,
        updatedAt: new Date(),
      },
    });
}

export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'stripe_webhook_secret_missing' }, { status: 500 });
  }

  const body = await req.text();
  const signature = (await headers()).get('stripe-signature');
  if (!signature) return NextResponse.json({ error: 'missing_signature' }, { status: 400 });

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(body, signature, secret);
  } catch {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 400 });
  }

  switch (event.type) {
    case 'checkout.session.completed':
      await linkCheckoutSession(event.data.object as Stripe.Checkout.Session);
      break;
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      await upsertSubscription(event.data.object as Stripe.Subscription);
      break;
    default:
      break;
  }

  return NextResponse.json({ received: true });
}
