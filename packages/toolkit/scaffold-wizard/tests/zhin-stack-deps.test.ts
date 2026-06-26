import { describe, expect, it } from 'vitest';
import {
  ZHIN_STACK_VERSIONS,
  diagnoseZhinStackDependencies,
  getCreateBotBaseDependencies,
  getRequiredZhinDependenciesForConfig,
  packagesNeedingZhinStackFix,
} from '../src/zhin-stack-deps.js';
import generated from '../src/stack-versions.generated.json' with { type: 'json' };

describe('zhin-stack-deps', () => {
  it('loads versions from stack-versions.generated.json', () => {
    expect(ZHIN_STACK_VERSIONS['zhin.js']).toBe(generated.zhinStack['zhin.js']);
    expect(getCreateBotBaseDependencies()['zhin.js']).toBe(generated.zhinStack['zhin.js']);
  });

  it('requires plugins declared in zhin.config', () => {
    const required = getRequiredZhinDependenciesForConfig({
      plugins: ['@zhin.js/adapter-sandbox', '@zhin.js/host-router', '@zhin.js/mcp'],
      database: { dialect: 'sqlite', filename: './data/bot.db' },
    });
    expect(required['@zhin.js/adapter-sandbox']).toBe(generated.zhinStack['@zhin.js/adapter-sandbox']);
    expect(required['@zhin.js/mcp']).toBe(generated.zhinStack['@zhin.js/mcp']);
    expect(required['@zhin.js/database']).toBe(generated.zhinStack['@zhin.js/database']);
  });

  it('diagnoses zhin.js below workspace major when AI enabled', () => {
    const config = {
      ai: { enabled: true, agents: { zhin: { provider: 'openai' } }, providers: { openai: { sdk: 'openai' } } },
      plugins: ['@zhin.js/adapter-sandbox', '@zhin.js/host-router', '@zhin.js/host-api'],
    };
    const zhinMajor = Number(generated.zhinStack['zhin.js'].match(/\d+/)?.[0] ?? 4);
    const pkg = {
      dependencies: {
        'zhin.js': `^${zhinMajor - 1}.0.0`,
        '@zhin.js/adapter-sandbox': generated.zhinStack['@zhin.js/adapter-sandbox'],
        '@zhin.js/host-router': generated.zhinStack['@zhin.js/host-router'],
        '@zhin.js/host-api': generated.zhinStack['@zhin.js/host-api'],
      },
    };
    const diagnosis = diagnoseZhinStackDependencies('/tmp', config, pkg);
    expect(diagnosis.outdatedInPackageJson).toContain('zhin.js');
    expect(diagnosis.incompatibleInstalled.some((i) => i.package === 'zhin.js')).toBe(true);
    expect(packagesNeedingZhinStackFix(diagnosis)).toContain('zhin.js');
  });
});
