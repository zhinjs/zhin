import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  diagnoseZhinStackDependencies,
  CREATE_BOT_PACKAGE_MANAGER,
  GATEWAY_NATIVE_BUILD_DEPENDENCIES,
  getCreateBotBaseDependencies,
  getCreateBotPnpmWorkspaceConfig,
  getRequiredZhinDependenciesForConfig,
  packagesNeedingZhinStackFix,
  formatZhinStackFixCommand,
  resolvesThroughZhin,
} from '../src/zhin-stack-deps.js';

describe('zhin-stack-deps', () => {
  it('uses latest for scaffolded user project dependencies', () => {
    const base = getCreateBotBaseDependencies();
    expect(base).toEqual({
      'zhin.js': 'latest',
      '@zhin.js/cli': 'latest',
      '@zhin.js/gateway': 'latest',
      '@zhin.js/skill': 'latest',
    });
    // Stable Features / runtime 由平台（CLI）与 zhin.js 传递依赖提供，不直列
    expect(base).not.toHaveProperty('@zhin.js/plugin-runtime');
    expect(base).not.toHaveProperty('@zhin.js/runtime');
    expect(base).not.toHaveProperty('@zhin.js/command');
    expect(base).not.toHaveProperty('@zhin.js/host-api');
    expect(base).not.toHaveProperty('@zhin.js/host-router');
    expect(CREATE_BOT_PACKAGE_MANAGER).toBe('pnpm@11.27.1');
    expect(getCreateBotPnpmWorkspaceConfig()).toEqual({
      packages: ['.', 'plugins/*', 'packages/*'],
      strictPeerDependencies: false,
      allowBuilds: { esbuild: true, 'node-pty': true, ssh2: true, 'cpu-features': true },
    });
  });

  it('derives host dependencies without treating instance keys as package names', () => {
    const required = getRequiredZhinDependenciesForConfig({
      plugins: { sandbox: {}, mcp: {} },
      database: { dialect: 'sqlite', filename: './data/bot.db' },
    });
    expect(required['@zhin.js/adapter-sandbox']).toBeUndefined();
    expect(required['@zhin.js/mcp']).toBeUndefined();
    expect(required['@zhin.js/database']).toBe('latest');
  });

  it('includes explicit @zhin.js/* package names declared in config.plugins', () => {
    const required = getRequiredZhinDependenciesForConfig({
      plugins: {
        sandbox: '@zhin.js/adapter-sandbox',
        telegram: { package: '@zhin.js/adapter-telegram' },
      },
    });
    expect(required['@zhin.js/adapter-sandbox']).toBe('latest');
    expect(required['@zhin.js/adapter-telegram']).toBe('latest');
  });

  it('pins generated database drivers to the verified major line', () => {
    const required = getRequiredZhinDependenciesForConfig({
      database: { dialect: 'pg', host: '127.0.0.1', port: 5432 },
    });
    expect(required.pg).toBe('^8.22.0');
  });

  it('diagnoses zhin.js versions before the 1.1 stable line when AI is enabled', () => {
    const config = {
      ai: { enabled: true, agents: { zhin: { provider: 'openai' } }, providers: { openai: { sdk: 'openai' } } },
      plugins: { sandbox: {}, mcp: {} },
    };
    const pkg = {
      dependencies: {
        'zhin.js': '^3.0.0',
        '@zhin.js/adapter-sandbox': 'latest',
        '@zhin.js/mcp': 'latest',
      },
    };
    const diagnosis = diagnoseZhinStackDependencies('/tmp', config, pkg);
    expect(diagnosis.outdatedInPackageJson).not.toContain('zhin.js');
    expect(diagnosis.incompatibleInstalled.some((i) => i.package === 'zhin.js')).toBe(true);
    expect(packagesNeedingZhinStackFix(diagnosis)).toContain('zhin.js');
  });

  it('accepts the reset 1.1 stable line when AI is enabled', () => {
    const diagnosis = diagnoseZhinStackDependencies(
      '/tmp',
      { ai: { enabled: true } },
      { dependencies: { 'zhin.js': '^1.1.0', '@zhin.js/agent': '^1.2.1' } },
    );

    expect(diagnosis.incompatibleInstalled).toEqual([]);
  });

  it('allows exactly the packages of the gateway dependency tree that run install scripts (#1250)', () => {
    // Read the real manifests instead of a hand-kept list: node-pty and ssh2 are gateway
    // optionalDependencies, cpu-features is an optional dependency of ssh2.
    const requireFromGateway = createRequire(new URL('../../../host/gateway/package.json', import.meta.url));
    const gateway = requireFromGateway('./package.json') as { optionalDependencies?: Record<string, string> };
    const withInstallScripts = (name: string, from: NodeJS.Require): string[] => {
      const manifest = from(`${name}/package.json`) as { scripts?: Record<string, string>; optionalDependencies?: Record<string, string> };
      const own = manifest.scripts?.install || manifest.scripts?.preinstall || manifest.scripts?.postinstall ? [name] : [];
      const nested = createRequire(from.resolve(`${name}/package.json`));
      return [...own, ...Object.keys(manifest.optionalDependencies ?? {})
        .filter(dependency => { try { nested.resolve(`${dependency}/package.json`); return true; } catch { return false; } })
        .flatMap(dependency => withInstallScripts(dependency, nested))];
    };
    const expected = Object.keys(gateway.optionalDependencies ?? {}).flatMap(name => withInstallScripts(name, requireFromGateway));
    expect(expected).toContain('node-pty');
    expect([...GATEWAY_NATIVE_BUILD_DEPENDENCIES].sort()).toEqual([...new Set(expected)].sort());
    expect(getCreateBotPnpmWorkspaceConfig().allowBuilds).toMatchObject(
      Object.fromEntries(GATEWAY_NATIVE_BUILD_DEPENDENCIES.map(name => [name, true])),
    );
  });
});

describe('database dependency provided by zhin.js (#1250)', () => {
  const roots: string[] = [];
  afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

  /** pnpm layout: node_modules/zhin.js → .pnpm/zhin.js@x/node_modules/zhin.js, deps as siblings. */
  function project(withDatabase: boolean): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-stack-db-'));
    roots.push(root);
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'bot', dependencies: { 'zhin.js': '^1.2.0' } }));
    fs.writeFileSync(path.join(root, 'pnpm-workspace.yaml'), "packages:\n  - '.'\n");
    const store = path.join(root, 'node_modules', '.pnpm', 'zhin.js@1.2.0', 'node_modules');
    fs.mkdirSync(path.join(store, 'zhin.js'), { recursive: true });
    fs.writeFileSync(path.join(store, 'zhin.js', 'package.json'), JSON.stringify({ name: 'zhin.js', version: '1.2.0', exports: { '.': './index.js' } }));
    if (withDatabase) {
      fs.mkdirSync(path.join(store, '@zhin.js', 'database'), { recursive: true });
      fs.writeFileSync(path.join(store, '@zhin.js', 'database', 'package.json'), JSON.stringify({ name: '@zhin.js/database', version: '1.2.0', exports: { '.': './index.js' } }));
    }
    fs.symlinkSync(path.join(store, 'zhin.js'), path.join(root, 'node_modules', 'zhin.js'), 'dir');
    return root;
  }

  const config = { database: { dialect: 'sqlite', filename: './data/bot.db' } };

  it('does not report @zhin.js/database as missing when it resolves through zhin.js', () => {
    const root = project(true);
    expect(resolvesThroughZhin(root, '@zhin.js/database')).toBe(true);
    const diagnosis = diagnoseZhinStackDependencies(root, config);
    expect(diagnosis.missingFromPackageJson).not.toContain('@zhin.js/database');
    expect(diagnosis.providedByZhin).toEqual(['@zhin.js/database']);
    expect(diagnosis.notInstalled).not.toContain('@zhin.js/database');
  });

  it('still reports it when zhin.js does not bring it, with a fix command that works in a workspace root', () => {
    const root = project(false);
    const diagnosis = diagnoseZhinStackDependencies(root, config);
    expect(diagnosis.missingFromPackageJson).toContain('@zhin.js/database');
    expect(formatZhinStackFixCommand(packagesNeedingZhinStackFix(diagnosis), diagnosis.required, root)).toMatch(/^pnpm add -w @zhin\.js\/database@/);
    expect(formatZhinStackFixCommand(['@zhin.js/database'], diagnosis.required)).toMatch(/^pnpm add @zhin\.js\/database@/);
  });
});
