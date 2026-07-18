import { describe, expect, it } from 'vitest';
import {
  diagnoseZhinStackDependencies,
  getCreateBotBaseDependencies,
  getCreateBotPnpmConfig,
  getRequiredZhinDependenciesForConfig,
  packagesNeedingZhinStackFix,
} from '../src/zhin-stack-deps.js';

describe('zhin-stack-deps', () => {
  it('uses latest for scaffolded user project dependencies', () => {
    const base = getCreateBotBaseDependencies();
    expect(base['zhin.js']).toBe('latest');
    expect(base['@zhin.js/plugin-runtime']).toBe('latest');
    expect(base['@zhin.js/runtime']).toBe('latest');
    expect(base['@zhin.js/adapter']).toBe('latest');
    expect(base['@zhin.js/command']).toBe('latest');
    expect(base['@zhin.js/component']).toBe('latest');
    expect(base['@zhin.js/satori']).toBe('latest');
    // Plugin Runtime 骨架不再预装 legacy host 插件
    expect(base).not.toHaveProperty('@zhin.js/host-api');
    expect(base).not.toHaveProperty('@zhin.js/host-router');
    expect(getCreateBotPnpmConfig(true)).not.toHaveProperty('peerDependencyRules');
  });

  it('requires plugins declared in zhin.config', () => {
    const required = getRequiredZhinDependenciesForConfig({
      plugins: ['@zhin.js/adapter-sandbox', '@zhin.js/host-router', '@zhin.js/mcp'],
      database: { dialect: 'sqlite', filename: './data/bot.db' },
    });
    expect(required['@zhin.js/adapter-sandbox']).toBe('latest');
    expect(required['@zhin.js/mcp']).toBe('latest');
    expect(required['@zhin.js/database']).toBe('latest');
  });

  it('diagnoses zhin.js below workspace major when AI enabled', () => {
    const config = {
      ai: { enabled: true, agents: { zhin: { provider: 'openai' } }, providers: { openai: { sdk: 'openai' } } },
      plugins: ['@zhin.js/adapter-sandbox', '@zhin.js/host-router', '@zhin.js/host-api'],
    };
    const pkg = {
      dependencies: {
        'zhin.js': '^3.0.0',
        '@zhin.js/adapter-sandbox': 'latest',
        '@zhin.js/host-router': 'latest',
        '@zhin.js/host-api': 'latest',
      },
    };
    const diagnosis = diagnoseZhinStackDependencies('/tmp', config, pkg);
    expect(diagnosis.outdatedInPackageJson).not.toContain('zhin.js');
    expect(diagnosis.incompatibleInstalled.some((i) => i.package === 'zhin.js')).toBe(true);
    expect(packagesNeedingZhinStackFix(diagnosis)).toContain('zhin.js');
  });
});
