import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isClerkConfigured,
  isStripeBillingConfigured,
  isStripeWebhookConfigured,
  missingClerkEnv,
  missingStripeBillingEnv,
  missingStripeWebhookEnv,
  requireClerkConfig,
} from '../lib/config.ts';
import { getStripe } from '../lib/stripe.ts';

describe('web configuration helpers', () => {
  it('detects missing Clerk configuration without reading secrets', () => {
    const env = {
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: '',
      CLERK_SECRET_KEY: ' ',
    };

    assert.equal(isClerkConfigured(env), false);
    assert.deepEqual(missingClerkEnv(env), [
      'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
      'CLERK_SECRET_KEY',
    ]);
    assert.throws(() => requireClerkConfig(env), /Clerk is not configured/);
  });

  it('accepts complete Clerk configuration', () => {
    const env = {
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_123',
      CLERK_SECRET_KEY: 'sk_test_123',
    };

    assert.equal(isClerkConfigured(env), true);
    assert.deepEqual(missingClerkEnv(env), []);
    assert.doesNotThrow(() => requireClerkConfig(env));
  });

  it('separates Stripe billing config from webhook-only config', () => {
    const webhookOnly = {
      STRIPE_SECRET_KEY: 'sk_test_123',
      STRIPE_WEBHOOK_SECRET: 'whsec_123',
      STRIPE_PRICE_ID_PRO: '',
    };

    assert.equal(isStripeWebhookConfigured(webhookOnly), true);
    assert.deepEqual(missingStripeWebhookEnv(webhookOnly), []);
    assert.equal(isStripeBillingConfigured(webhookOnly), false);
    assert.deepEqual(missingStripeBillingEnv(webhookOnly), ['STRIPE_PRICE_ID_PRO']);
  });

  it('fails closed before constructing a Stripe client when the secret key is absent', () => {
    const previous = process.env.STRIPE_SECRET_KEY;
    process.env.STRIPE_SECRET_KEY = '';

    try {
      assert.throws(() => getStripe(), /STRIPE_SECRET_KEY is not configured/);
    } finally {
      process.env.STRIPE_SECRET_KEY = previous ?? '';
    }
  });
});
