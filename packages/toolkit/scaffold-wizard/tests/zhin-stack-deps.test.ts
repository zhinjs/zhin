import { describe, expect, it } from 'vitest';
import {
  diagnoseZhinStackDependencies,
  CREATE_BOT_PACKAGE_MANAGER,
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
      allowBuilds: { esbuild: true },
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
});
