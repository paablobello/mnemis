'use server';

import { billingCustomers, eq } from '@mnemis/db';
import {
  createDashboardResearchRun,
  createDashboardSource,
  createWorkspaceApiKey,
  revokeWorkspaceApiKey,
} from '@mnemis/saas';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { missingStripeBillingEnv } from '../../lib/config';
import { getDashboardDb } from '../../lib/db';
import { requireDashboardContext } from '../../lib/session';
import { appUrl, getStripe } from '../../lib/stripe';

const FLASH_COOKIE = 'mnemis_dashboard_flash';
const API_KEY_COOKIE = 'mnemis_new_api_key';

type SourceKind = 'docs_site' | 'web_page' | 'pdf_document';

function stringValue(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

async function setFlash(message: string): Promise<void> {
  (await cookies()).set(FLASH_COOKIE, message, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 45,
    path: '/dashboard',
  });
}

export async function createApiKeyAction(formData: FormData) {
  const context = await requireDashboardContext();
  const name = stringValue(formData, 'name') || 'MCP beta key';
  const { raw } = await createWorkspaceApiKey({
    db: getDashboardDb(),
    workspaceId: context.workspace.id,
    name,
    secret: process.env.INTERNAL_AUTH_SECRET,
  });
  (await cookies()).set(API_KEY_COOKIE, raw, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 120,
    path: '/dashboard',
  });
  revalidatePath('/dashboard');
  redirect('/dashboard');
}

export async function revokeApiKeyAction(formData: FormData) {
  const context = await requireDashboardContext();
  const id = stringValue(formData, 'id');
  if (id) await revokeWorkspaceApiKey(getDashboardDb(), context.workspace.id, id);
  await setFlash('API key revoked.');
  revalidatePath('/dashboard');
  redirect('/dashboard');
}

export async function createSourceAction(formData: FormData) {
  const context = await requireDashboardContext();
  const kind = stringValue(formData, 'kind') as SourceKind;
  const identifier = stringValue(formData, 'identifier');
  const displayName = stringValue(formData, 'displayName');

  if (!['docs_site', 'web_page', 'pdf_document'].includes(kind)) {
    await setFlash('Unsupported source type.');
    redirect('/dashboard');
  }

  try {
    await createDashboardSource({
      db: getDashboardDb(),
      workspaceId: context.workspace.id,
      kind,
      identifier,
      displayName,
    });
    await setFlash('Source queued for indexing.');
  } catch (err) {
    await setFlash(err instanceof Error ? err.message : 'Could not create source.');
  }

  revalidatePath('/dashboard');
  redirect('/dashboard');
}

export async function createResearchAction(formData: FormData) {
  const context = await requireDashboardContext();
  const query = stringValue(formData, 'query');
  const depth = stringValue(formData, 'depth');
  try {
    await createDashboardResearchRun({
      db: getDashboardDb(),
      workspaceId: context.workspace.id,
      query,
      depth: depth === 'quick' || depth === 'standard' || depth === 'deep' ? depth : 'standard',
    });
    await setFlash('Research run queued.');
  } catch (err) {
    await setFlash(err instanceof Error ? err.message : 'Could not create research run.');
  }
  revalidatePath('/dashboard');
  redirect('/dashboard');
}

export async function openBillingPortalAction() {
  const context = await requireDashboardContext();
  if (missingStripeBillingEnv().length > 0) {
    await setFlash('Stripe billing is not configured.');
    redirect('/dashboard');
  }

  const [customer] = await getDashboardDb()
    .select()
    .from(billingCustomers)
    .where(eq(billingCustomers.workspaceId, context.workspace.id))
    .limit(1);

  if (!customer) {
    await setFlash('Create a subscription before opening the billing portal.');
    redirect('/dashboard');
  }

  const session = await getStripe().billingPortal.sessions.create({
    customer: customer.stripeCustomerId,
    return_url: `${appUrl()}/dashboard`,
  });
  redirect(session.url);
}
