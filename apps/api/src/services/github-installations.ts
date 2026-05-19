import { type GitHubAppInstallation, githubAppInstallations } from '@mnemis/db';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { getDb } from '../db.ts';
import { ApiError } from '../errors.ts';
import type { RegisterGitHubInstallationInput } from '../validators/github.ts';

export interface GitHubInstallationDto {
  id: string;
  workspace_id: string;
  installation_id: string;
  account_login: string;
  account_type: string | null;
  repository_selection: string | null;
  permissions: unknown;
  events: string[];
  installed_at: string | null;
  suspended_at: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export function githubInstallationToDto(
  installation: GitHubAppInstallation,
): GitHubInstallationDto {
  return {
    id: installation.id,
    workspace_id: installation.workspaceId,
    installation_id: installation.installationId,
    account_login: installation.accountLogin,
    account_type: installation.accountType,
    repository_selection: installation.repositorySelection,
    permissions: installation.permissions,
    events: installation.events,
    installed_at: installation.installedAt?.toISOString() ?? null,
    suspended_at: installation.suspendedAt?.toISOString() ?? null,
    deleted_at: installation.deletedAt?.toISOString() ?? null,
    created_at: installation.createdAt.toISOString(),
    updated_at: installation.updatedAt.toISOString(),
  };
}

function parseOptionalDate(value: string | undefined): Date | null {
  return value ? new Date(value) : null;
}

export async function registerGitHubInstallation(
  workspaceId: string,
  input: RegisterGitHubInstallationInput,
): Promise<GitHubAppInstallation> {
  const db = getDb();
  const [existing] = await db
    .select()
    .from(githubAppInstallations)
    .where(eq(githubAppInstallations.installationId, input.installationId))
    .limit(1);

  if (existing && existing.workspaceId !== workspaceId) {
    throw ApiError.conflict(
      'github_installation_claimed',
      'This GitHub App installation is already linked to another workspace',
    );
  }

  if (existing) {
    const [updated] = await db
      .update(githubAppInstallations)
      .set({
        accountLogin: input.accountLogin.toLowerCase(),
        accountType: input.accountType ?? null,
        repositorySelection: input.repositorySelection ?? null,
        permissions: input.permissions ?? {},
        events: input.events ?? [],
        installedAt: parseOptionalDate(input.installedAt),
        deletedAt: null,
      })
      .where(
        and(
          eq(githubAppInstallations.workspaceId, workspaceId),
          eq(githubAppInstallations.installationId, input.installationId),
        ),
      )
      .returning();
    if (!updated) throw ApiError.internal('GitHub installation update returned no row');
    return updated;
  }

  const [created] = await db
    .insert(githubAppInstallations)
    .values({
      workspaceId,
      installationId: input.installationId,
      accountLogin: input.accountLogin.toLowerCase(),
      accountType: input.accountType ?? null,
      repositorySelection: input.repositorySelection ?? null,
      permissions: input.permissions ?? {},
      events: input.events ?? [],
      installedAt: parseOptionalDate(input.installedAt),
    })
    .returning();

  if (!created) throw ApiError.internal('GitHub installation insert returned no row');
  return created;
}

export async function listGitHubInstallations(
  workspaceId: string,
): Promise<GitHubAppInstallation[]> {
  const db = getDb();
  return db
    .select()
    .from(githubAppInstallations)
    .where(
      and(
        eq(githubAppInstallations.workspaceId, workspaceId),
        isNull(githubAppInstallations.deletedAt),
      ),
    )
    .orderBy(desc(githubAppInstallations.createdAt));
}

export async function getActiveGitHubInstallation(
  workspaceId: string,
  installationId: string,
): Promise<GitHubAppInstallation | null> {
  const db = getDb();
  const [installation] = await db
    .select()
    .from(githubAppInstallations)
    .where(
      and(
        eq(githubAppInstallations.workspaceId, workspaceId),
        eq(githubAppInstallations.installationId, installationId),
        isNull(githubAppInstallations.deletedAt),
      ),
    )
    .limit(1);
  return installation ?? null;
}
