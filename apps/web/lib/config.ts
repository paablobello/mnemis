type Env = NodeJS.ProcessEnv | Record<string, string | undefined>;

const CLERK_REQUIRED = ['NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'CLERK_SECRET_KEY'] as const;
const STRIPE_BILLING_REQUIRED = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'] as const;
const STRIPE_WEBHOOK_REQUIRED = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'] as const;

function missing(keys: readonly string[], env: Env): string[] {
  return keys.filter((key) => !env[key]?.trim());
}

export function missingClerkEnv(env: Env = process.env): string[] {
  return missing(CLERK_REQUIRED, env);
}

export function isClerkConfigured(env: Env = process.env): boolean {
  return missingClerkEnv(env).length === 0;
}

export function requireClerkConfig(env: Env = process.env): void {
  const missingKeys = missingClerkEnv(env);
  if (missingKeys.length > 0) {
    throw new Error(`Clerk is not configured. Missing: ${missingKeys.join(', ')}`);
  }
}

export function missingStripeBillingEnv(env: Env = process.env): string[] {
  return missing(STRIPE_BILLING_REQUIRED, env);
}

export function isStripeBillingConfigured(env: Env = process.env): boolean {
  return missingStripeBillingEnv(env).length === 0;
}

export function missingStripeWebhookEnv(env: Env = process.env): string[] {
  return missing(STRIPE_WEBHOOK_REQUIRED, env);
}

export function isStripeWebhookConfigured(env: Env = process.env): boolean {
  return missingStripeWebhookEnv(env).length === 0;
}
