import { auth, currentUser } from '@clerk/nextjs/server';
import { ensureSaasWorkspace } from '@mnemis/saas';
import { getDashboardDb } from './db';

export async function requireDashboardContext() {
  const authState = await auth();
  const clerkUser = await currentUser();
  if (!clerkUser) throw new Error('Clerk user is required');

  const email =
    clerkUser.primaryEmailAddress?.emailAddress ?? clerkUser.emailAddresses[0]?.emailAddress;
  if (!email) throw new Error('Clerk user must have an email address');

  return ensureSaasWorkspace(getDashboardDb(), {
    provider: 'clerk',
    externalId: clerkUser.id,
    email,
    name: clerkUser.fullName ?? clerkUser.username ?? email.split('@')[0],
    workspaceExternalId: authState.orgId ?? null,
    workspaceName: authState.orgSlug ?? null,
  });
}
