import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import {
  diagnoseZhinStackDependencies,
  CREATE_BOT_PACKAGE_MANAGER,
  GATEWAY_NATIVE_BUILD_DEPENDENCIES,
  getCreateBotBaseDependencies,
  getCreateBotPnpmWorkspaceConfig,
  getRequiredZhinDependenciesForConfig,
  packagesNeedingZhinStackFix,
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
