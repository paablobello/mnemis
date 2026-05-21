import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { isStripeWebhookConfigured } from '../../../../lib/config';
import { getStripe } from '../../../../lib/stripe';
import { handleStripeEvent } from '../../../../lib/stripe-webhook';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!isStripeWebhookConfigured() || !secret) {
    return NextResponse.json({ error: 'stripe_webhook_not_configured' }, { status: 503 });
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

  await handleStripeEvent(event);

  return NextResponse.json({ received: true });
}
