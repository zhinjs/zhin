/**
 * github_oauth_users — SSOT for Runtime user-token binding (gh bind / Endpoint lookup).
 */
import { formatCompact, getLogger } from '@zhin.js/logger';
import type { DatabaseHost } from '@zhin.js/plugin-runtime';

const logger = getLogger('github');

export const GITHUB_OAUTH_USERS_TABLE = 'github_oauth_users';

export const GITHUB_OAUTH_USERS_SCHEMA = {
  id: { type: 'integer', primary: true },
  platform: { type: 'text', nullable: false },
  platform_uid: { type: 'text', nullable: false },
  github_login: { type: 'text', nullable: false },
  access_token: { type: 'text', nullable: false },
  created_at: { type: 'integer', nullable: false },
} as const;

export function defineGithubOauthUsersTable(
  host: { define(name: string, definition: Record<string, unknown>): void },
): void {
  host.define(GITHUB_OAUTH_USERS_TABLE, { ...GITHUB_OAUTH_USERS_SCHEMA });
}

/** Resolve a stored PAT/device-flow token; null when DB missing or no row. */
export async function lookupGithubOauthAccessToken(
  database: DatabaseHost | undefined,
  platform: string,
  platformUid: string,
): Promise<string | null> {
  if (!database?.started) return null;
  const model = database.models.get(GITHUB_OAUTH_USERS_TABLE);
  if (!model) return null;
  try {
    const rows = await model.select().where({ platform, platform_uid: platformUid });
    const token = rows[0]?.access_token;
    return typeof token === 'string' && token.trim() ? token : null;
  } catch (error) {
    logger.debug(formatCompact({
      op: 'oauth_lookup_fail',
      platform,
      error: error instanceof Error ? error.message : String(error),
    }));
    return null;
  }
}
