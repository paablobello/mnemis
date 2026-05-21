import { type GitHubAppInstallation, githubAppInstallations } from '@mnemis/db';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { SignJWT, importPKCS8 } from 'jose';
import { getDb } from '../db.ts';
import { ApiError } from '../errors.ts';
import type { RegisterGitHubInstallationInput } from '../validators/github.ts';

const GITHUB_API_BASE = 'https://api.github.com';
const JWT_TTL_SECONDS = 540;
const JWT_BACKDATE_SECONDS = 60;

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

export interface VerifiedGitHubInstallation {
  accountLogin: string;
  accountType: string | null;
  repositorySelection: string | null;
  permissions: Record<string, unknown>;
  events: string[];
  installedAt: Date | null;
  suspendedAt: Date | null;
}

export type VerifyGitHubInstallation = (
  installationId: string,
) => Promise<VerifiedGitHubInstallation>;

export interface RegisterGitHubInstallationOptions {
  verifyInstallation?: VerifyGitHubInstallation;
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

function parseOptionalDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function errorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.replace(/\s+/g, ' ').trim().slice(0, 240) || 'unknown error';
}

async function signGitHubAppJwt(input: {
  appId: string;
  privateKey: string;
  nowMs?: number;
}): Promise<string> {
  const key = await importPKCS8(input.privateKey, 'RS256');
  const nowMs = input.nowMs ?? Date.now();
  const iat = Math.floor(nowMs / 1000) - JWT_BACKDATE_SECONDS;
  const exp = iat + JWT_TTL_SECONDS;
  return new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .setIssuer(input.appId)
    .sign(key);
}

async function fetchVerifiedGitHubInstallation(
  installationId: string,
  input: { appId: string; privateKey: string; fetcher?: typeof fetch; baseUrl?: string },
): Promise<VerifiedGitHubInstallation> {
  let jwt: string;
  try {
    jwt = await signGitHubAppJwt({ appId: input.appId, privateKey: input.privateKey });
  } catch (err) {
    throw ApiError.failedDependency(
      'github_app_verification_failed',
      `GitHub App JWT signing failed: ${errorMessage(err)}`,
    );
  }

  const fetcher = input.fetcher ?? fetch;
  const baseUrl = input.baseUrl ?? GITHUB_API_BASE;
  const response = await fetcher(
    `${baseUrl}/app/installations/${encodeURIComponent(installationId)}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'mnemis-api',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
  );

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    if (response.status === 404) {
      throw ApiError.badRequest(
        'github_installation_not_found',
        'GitHub App installation was not found for this app',
      );
    }
    throw ApiError.failedDependency(
      'github_app_verification_failed',
      `GitHub App installation verification failed (${response.status}): ${body.slice(0, 240)}`,
    );
  }

  const data = asRecord(await response.json());
  const account = asRecord(data.account);
  const accountLogin = typeof account.login === 'string' ? account.login : null;
  if (!accountLogin) {
    throw ApiError.failedDependency(
      'github_app_verification_failed',
      'GitHub App installation response did not include an account login',
    );
  }

  return {
    accountLogin,
    accountType: typeof account.type === 'string' ? account.type : null,
    repositorySelection:
      typeof data.repository_selection === 'string' ? data.repository_selection : null,
    permissions: asRecord(data.permissions),
    events: Array.isArray(data.events)
      ? data.events.filter((event): event is string => typeof event === 'string')
      : [],
    installedAt: parseOptionalDate(typeof data.created_at === 'string' ? data.created_at : null),
    suspendedAt: parseOptionalDate(
      typeof data.suspended_at === 'string' ? data.suspended_at : null,
    ),
  };
}

function configuredVerifier(): VerifyGitHubInstallation | null {
  const appId = process.env.GITHUB_APP_ID?.trim();
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, '\n').trim();
  if (appId && privateKey) {
    return (installationId) =>
      fetchVerifiedGitHubInstallation(installationId, { appId, privateKey });
  }
  if (process.env.MNEMIS_MODE === 'cloud') {
    throw ApiError.failedDependency(
      'github_app_not_configured',
      'GitHub App credentials are required to register installations in cloud mode',
    );
  }
  return null;
}

async function verifyInstallation(
  installationId: string,
  options: RegisterGitHubInstallationOptions,
): Promise<VerifiedGitHubInstallation | null> {
  const verifier = options.verifyInstallation ?? configuredVerifier();
  if (!verifier) return null;
  return verifier(installationId);
}

function normalizedInput(
  input: RegisterGitHubInstallationInput,
  verified: VerifiedGitHubInstallation | null,
) {
  if (verified) {
    if (input.accountLogin.toLowerCase() !== verified.accountLogin.toLowerCase()) {
      throw ApiError.badRequest(
        'github_installation_account_mismatch',
        'GitHub installation account does not match the verified installation',
      );
    }
    if (input.accountType && verified.accountType && input.accountType !== verified.accountType) {
      throw ApiError.badRequest(
        'github_installation_account_mismatch',
        'GitHub installation account type does not match the verified installation',
      );
    }
    if (
      input.repositorySelection &&
      verified.repositorySelection &&
      input.repositorySelection !== verified.repositorySelection
    ) {
      throw ApiError.badRequest(
        'github_installation_repository_selection_mismatch',
        'GitHub installation repository selection does not match the verified installation',
      );
    }
  }

  return {
    accountLogin: (verified?.accountLogin ?? input.accountLogin).toLowerCase(),
    accountType: verified?.accountType ?? input.accountType ?? null,
    repositorySelection: verified?.repositorySelection ?? input.repositorySelection ?? null,
    permissions: verified?.permissions ?? input.permissions ?? {},
    events: verified?.events ?? input.events ?? [],
    installedAt: verified?.installedAt ?? parseOptionalDate(input.installedAt),
    suspendedAt: verified?.suspendedAt ?? null,
  };
}

export async function registerGitHubInstallation(
  workspaceId: string,
  input: RegisterGitHubInstallationInput,
  options: RegisterGitHubInstallationOptions = {},
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

  const verified = await verifyInstallation(input.installationId, options);
  const normalized = normalizedInput(input, verified);

  if (existing) {
    const [updated] = await db
      .update(githubAppInstallations)
      .set({
        accountLogin: normalized.accountLogin,
        accountType: normalized.accountType,
        repositorySelection: normalized.repositorySelection,
        permissions: normalized.permissions,
        events: normalized.events,
        installedAt: normalized.installedAt,
        suspendedAt: normalized.suspendedAt,
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
      accountLogin: normalized.accountLogin,
      accountType: normalized.accountType,
      repositorySelection: normalized.repositorySelection,
      permissions: normalized.permissions,
      events: normalized.events,
      installedAt: normalized.installedAt,
      suspendedAt: normalized.suspendedAt,
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
