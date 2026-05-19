import {
  type Database,
  type GitHubAppInstallation,
  and,
  eq,
  githubAppInstallations,
  isNull,
} from '@mnemis/db';

export async function getActiveInstallation(
  db: Database,
  workspaceId: string,
  installationId: string,
): Promise<GitHubAppInstallation | null> {
  const [row] = await db
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
  return row ?? null;
}
