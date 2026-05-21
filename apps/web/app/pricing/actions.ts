'use server';

import { eq, plans } from '@mnemis/db';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ensureStripeCustomer } from '../../lib/billing';
import { isStripeBillingConfigured } from '../../lib/config';
import { getDashboardDb } from '../../lib/db';
import { requireDashboardContext } from '../../lib/session';
import { appUrl, getStripe } from '../../lib/stripe';

const FLASH_COOKIE = 'mnemis_dashboard_flash';

async function setFlash(message: string): Promise<void> {
  (await cookies()).set(FLASH_COOKIE, message, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 45,
    path: '/dashboard',
  });
}

function stringValue(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

export async function subscribeToTierAction(formData: FormData) {
  const planId = stringValue(formData, 'planId');
  if (!planId) {
    await setFlash('Missing plan.');
    redirect('/pricing');
  }

  const context = await requireDashboardContext();

  if (!isStripeBillingConfigured()) {
    await setFlash('Stripe billing is not configured.');
    redirect('/pricing');
  }

  const [plan] = await getDashboardDb().select().from(plans).where(eq(plans.id, planId)).limit(1);

  if (!plan) {
    await setFlash('Unknown plan.');
    redirect('/pricing');
  }
  if (!plan.stripePriceId) {
    await setFlash(`${plan.name} has no paid tier yet.`);
    redirect('/pricing');
  }

  const customer = await ensureStripeCustomer({
    workspaceId: context.workspace.id,
    workspaceName: context.workspace.name,
    email: context.user.email,
  });
  const baseUrl = appUrl();
  const session = await getStripe().checkout.sessions.create({
    mode: 'subscription',
    customer,
    line_items: [{ price: plan.stripePriceId, quantity: 1 }],
    success_url: `${baseUrl}/dashboard?checkout=success&plan=${plan.id}`,
    cancel_url: `${baseUrl}/pricing?checkout=cancelled`,
    metadata: { workspace_id: context.workspace.id, plan_id: plan.id },
    subscription_data: {
      metadata: { workspace_id: context.workspace.id, plan_id: plan.id },
    },
  });
  if (!session.url) throw new Error('Stripe did not return a Checkout URL');
  redirect(session.url);
}
