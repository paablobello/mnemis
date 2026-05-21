import { billingCustomers, eq } from '@mnemis/db';
import { getDashboardDb } from './db';
import { getStripe } from './stripe';

/**
 * Look up or create the Stripe Customer for a workspace. Idempotent.
 * Stripe customer metadata.workspace_id is the trust anchor used by the
 * webhook to attribute subscriptions back to the workspace.
 */
export async function ensureStripeCustomer(input: {
  workspaceId: string;
  workspaceName: string;
  email: string;
}): Promise<string> {
  const db = getDashboardDb();
  const [existing] = await db
    .select()
    .from(billingCustomers)
    .where(eq(billingCustomers.workspaceId, input.workspaceId))
    .limit(1);
  if (existing) return existing.stripeCustomerId;

  const customer = await getStripe().customers.create({
    email: input.email,
    name: input.workspaceName,
    metadata: { workspace_id: input.workspaceId },
  });
  await db.insert(billingCustomers).values({
    workspaceId: input.workspaceId,
    stripeCustomerId: customer.id,
    billingEmail: input.email,
  });
  return customer.id;
}
