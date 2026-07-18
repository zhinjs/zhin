import { describe, expect, it } from 'vitest';
import type { DatabaseHost, DatabaseHostModel } from '@zhin.js/plugin-runtime';
import {
  GITHUB_OAUTH_USERS_TABLE,
  defineGithubOauthUsersTable,
  lookupGithubOauthAccessToken,
} from '../src/oauth-users.js';

function createMemoryOauthHost(rows: Array<Record<string, unknown>> = []): DatabaseHost {
  let started = false;
  const modelMap = new Map<string, DatabaseHostModel>();

  const model: DatabaseHostModel = {
    async insert(row) {
      rows.push({ ...row });
      return row;
    },
    select() {
      const result = Promise.resolve(rows.slice());
      return {
        where(query: Record<string, unknown>) {
          return Promise.resolve(
            rows.filter((row) =>
              Object.entries(query).every(([key, value]) => row[key] === value),
            ),
          );
        },
        then: result.then.bind(result),
      };
    },
    delete() {
      return {
        async where() {
          return undefined;
        },
      };
    },
    update() {
      return {
        async where() {
          return undefined;
        },
      };
    },
  };

  return {
    dialect: 'memory',
    get started() {
      return started;
    },
    define(name) {
      modelMap.set(name, model);
    },
    tables() {
      return [...modelMap.keys()];
    },
    models: {
      get(name: string) {
        return modelMap.get(name);
      },
    },
    async start() {
      started = true;
    },
    async stop() {
      started = false;
    },
  };
}

describe('github oauth-users', () => {
  it('defines github_oauth_users schema once', () => {
    const host = createMemoryOauthHost();
    defineGithubOauthUsersTable(host);
    expect(host.models.get(GITHUB_OAUTH_USERS_TABLE)).toBeDefined();
  });

  it('resolves stored access token after start', async () => {
    const host = createMemoryOauthHost([{
      platform: 'sandbox',
      platform_uid: 'u1',
      github_login: 'octocat',
      access_token: 'gho_test',
    }]);
    defineGithubOauthUsersTable(host);
    await host.start();

    await expect(lookupGithubOauthAccessToken(host, 'sandbox', 'u1')).resolves.toBe('gho_test');
    await expect(lookupGithubOauthAccessToken(host, 'sandbox', 'missing')).resolves.toBeNull();
    await expect(lookupGithubOauthAccessToken(undefined, 'sandbox', 'u1')).resolves.toBeNull();
  });

  it('returns null when database has not started', async () => {
    const host = createMemoryOauthHost([{
      platform: 'sandbox',
      platform_uid: 'u1',
      access_token: 'gho_test',
    }]);
    defineGithubOauthUsersTable(host);
    await expect(lookupGithubOauthAccessToken(host, 'sandbox', 'u1')).resolves.toBeNull();
  });
});
