import { DATABASE_DIALECT_DEFINITIONS, ADAPTERS, AI_STACK_VERSIONS } from '@zhin.js/scaffold-wizard';
import type { ConsolePrincipal } from '@zhin.js/host-http';
import {
  authorizeInstall, createInstallAllowlist, isSafeVersionSpec, OnboardingError, parseInstallRequest,
} from '../../src/onboarding/index.js';
import { noPermissionUser, testUser } from '../utils/console-users.js';

const allowlist = createInstallAllowlist({ market: [{ name: '@zhin.js/plugin-rss' }, { name: 'git+https://evil' }] });
const bootstrap: ConsolePrincipal = { kind: 'bootstrap', open: false };
const openBootstrap: ConsolePrincipal = { kind: 'bootstrap', open: true };
const owner = testUser('owner');
const viewer = testUser('viewer');

function denied(run: () => unknown, code: string) {
  try { run(); } catch (error) {
    expect(error).toBeInstanceOf(OnboardingError);
    expect((error as OnboardingError).code).toBe(code);
    return;
  }
  throw new Error('expected a rejection');
}

describe('install allowlist (ADR 0053 §3)', () => {
  it('is built from the database, adapter, AI and market catalogs', () => {
    for (const definition of DATABASE_DIALECT_DEFINITIONS) {
      if (definition.driver) expect(allowlist.get(definition.driver.package)).toMatchObject({ kind: 'database-driver', defaultVersion: definition.driver.version });
    }
    for (const adapter of ADAPTERS) expect(allowlist.get(adapter.package)?.kind).toBe('adapter');
    expect(allowlist.get('@icqqjs/icqq')?.kind).toBe('adapter');
    for (const name of Object.keys(AI_STACK_VERSIONS)) expect(allowlist.get(name)?.kind).toBe('ai');
    expect(allowlist.get('@zhin.js/plugin-rss')?.kind).toBe('market');
    expect(allowlist.get('git+https://evil')).toBeUndefined();
    expect(allowlist.get('left-pad')).toBeUndefined();
  });

  it('accepts only names with safe semver ranges or dist-tags', () => {
    expect(parseInstallRequest('mysql2')).toEqual({ name: 'mysql2' });
    expect(parseInstallRequest('mysql2@^3.23.2')).toEqual({ name: 'mysql2', version: '^3.23.2' });
    expect(parseInstallRequest('@zhin.js/agent@next')).toEqual({ name: '@zhin.js/agent', version: 'next' });
    for (const version of ['1.2.3', '~1.2', '>=1.0.0', '1.x', '2.0.0-beta.1', 'latest', '*']) expect(isSafeVersionSpec(version)).toBe(true);
    for (const spec of [
      'foo@file:../x', 'mysql2@file:../x', 'git+https://github.com/a/b.git', 'github:a/b', '../evil', './evil', '/abs/evil',
      'mysql2@latest && rm -rf /', 'mysql2@latest;rm', 'mysql2@$(id)', 'mysql2@`id`', 'pg@npm:evil@1.0.0',
      'pg@https://evil.example/pg.tgz', 'pg@link:../pg', 'pg@workspace:*', 'pg@ 1.0.0', 'pg@>=1 <2', 'pg@1.0.0||2.0.0',
      'https://evil.example/x.tgz', '@scope/../x', 'PG', '', ' pg', 'pg@', 'pg@-1',
    ]) {
      denied(() => parseInstallRequest(spec), 'invalid_input');
      denied(() => authorizeInstall([spec], owner, allowlist), 'invalid_input');
    }
    denied(() => parseInstallRequest(42), 'invalid_input');
  });

  it('authorization matrix: bootstrap installs drivers only, before an owner exists', () => {
    expect(authorizeInstall(['mysql2'], bootstrap, allowlist)).toEqual([
      { name: 'mysql2', kind: 'database-driver', version: '^3.23.2', spec: 'mysql2@^3.23.2' },
    ]);
    expect(authorizeInstall(['pg@8.22.0', 'mongodb'], openBootstrap, allowlist).map(item => item.spec)).toEqual(['pg@8.22.0', 'mongodb@^7.5.0']);
    denied(() => authorizeInstall(['@zhin.js/adapter-sandbox'], bootstrap, allowlist), 'forbidden');
    denied(() => authorizeInstall(['@zhin.js/agent'], openBootstrap, allowlist), 'forbidden');
    denied(() => authorizeInstall(['@zhin.js/plugin-rss'], bootstrap, allowlist), 'forbidden');
    denied(() => authorizeInstall(['mysql2', '@zhin.js/agent'], bootstrap, allowlist), 'forbidden');
    denied(() => authorizeInstall(['mysql2'], bootstrap, allowlist, { ownerExists: true }), 'forbidden');
  });

  it('authorization matrix: users need plugin.manage; off-list is always refused', () => {
    expect(authorizeInstall(['mysql2', '@zhin.js/adapter-sandbox', '@zhin.js/agent', '@zhin.js/plugin-rss@1.0.0'], owner, allowlist)
      .map(item => [item.name, item.kind])).toEqual([
      ['mysql2', 'database-driver'], ['@zhin.js/adapter-sandbox', 'adapter'], ['@zhin.js/agent', 'ai'], ['@zhin.js/plugin-rss', 'market'],
    ]);
    expect(authorizeInstall(['@zhin.js/agent'], testUser('admin'), allowlist)).toHaveLength(1);
    for (const principal of [viewer, noPermissionUser(), testUser('owner', { kind: 'adapter', key: 'qq' })]) {
      denied(() => authorizeInstall(['mysql2'], principal, allowlist), 'forbidden');
      denied(() => authorizeInstall(['@zhin.js/adapter-sandbox'], principal, allowlist), 'forbidden');
    }
    denied(() => authorizeInstall(['mysql2'], undefined, allowlist), 'forbidden');
    for (const principal of [owner, bootstrap, 'local' as const]) denied(() => authorizeInstall(['left-pad'], principal, allowlist), 'forbidden');
    expect(authorizeInstall(['@zhin.js/agent'], 'local', allowlist)).toHaveLength(1);
    denied(() => authorizeInstall([], owner, allowlist), 'invalid_input');
    denied(() => authorizeInstall(['pg', 'pg@8.0.0'], owner, allowlist), 'invalid_input');
  });
});
