import { billingCustomers, type createDatabase, eq, plans, subscriptions } from '@mnemis/db';
import type Stripe from 'stripe';
import { getDashboardDb } from './db.ts';

type Database = ReturnType<typeof createDatabase>;

function dateFromUnix(value: number | null | undefined): Date | null {
  return typeof value === 'number' ? new Date(value * 1000) : null;
}

function subscriptionWorkspaceId(subscription: Stripe.Subscription): string | null {
  return typeof subscription.metadata.workspace_id === 'string'
    ? subscription.metadata.workspace_id
    : null;
}

async function planIdForSubscription(
  db: Database,
  priceId: string,
  subscription: Stripe.Subscription,
): Promise<string | null> {
  const [pricePlan] = await db
    .select({ id: plans.id })
    .from(plans)
    .where(eq(plans.stripePriceId, priceId))
    .limit(1);
  if (pricePlan?.id) return pricePlan.id;

  const metadataPlanId =
    typeof subscription.metadata.plan_id === 'string' ? subscription.metadata.plan_id : null;
  if (!metadataPlanId) return null;

  const [metadataPlan] = await db
    .select({ id: plans.id })
    .from(plans)
    .where(eq(plans.id, metadataPlanId))
    .limit(1);
  return metadataPlan?.id ?? null;
}

export async function upsertStripeSubscription(
  subscription: Stripe.Subscription,
  db = getDashboardDb(),
): Promise<void> {
  const workspaceId = subscriptionWorkspaceId(subscription);
  const item = subscription.items.data[0];
  const priceId = item?.price.id;
  if (!workspaceId || !priceId) return;

  const values = {
    workspaceId,
    planId: await planIdForSubscription(db, priceId, subscription),
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
    target: subscriptions.workspaceId,
    set: values,
  });
}

export async function linkStripeCheckoutSession(
  session: Stripe.Checkout.Session,
  db = getDashboardDb(),
): Promise<void> {
  const workspaceId =
    typeof session.metadata?.workspace_id === 'string' ? session.metadata.workspace_id : null;
  const customerId = typeof session.customer === 'string' ? session.customer : null;
  if (!workspaceId || !customerId) return;

  await db
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

export async function handleStripeEvent(event: Stripe.Event, db = getDashboardDb()): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed':
      await linkStripeCheckoutSession(event.data.object as Stripe.Checkout.Session, db);
      break;
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      await upsertStripeSubscription(event.data.object as Stripe.Subscription, db);
      break;
    default:
      break;
  }
}
