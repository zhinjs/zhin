import { describe, expect, it } from 'vitest';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import {
  ensureDatabaseForAI,
  ensureDatabaseForAdapters,
  getAIDependencies,
  listAIDependencyNames,
  formatAIDependencyHint,
  diagnoseAIDependencies,
  findInstalledAiStackIncompatibilities,
  findUnresolvedPackageInstalls,
  getRequiredAIDependenciesForConfig,
} from '../src/project-deps.js';
import { RECOMMENDED_AI_DEFAULTS } from '../src/ai.js';
import type { InitOptions } from '../src/types.js';

describe('project-deps', () => {
  it('lists AI stack package names for wizard hints', () => {
    expect(listAIDependencyNames('openai')).toEqual([
      '@zhin.js/agent',
      'zod',
      'ai',
      '@ai-sdk/openai',
    ]);
    expect(listAIDependencyNames('openai', { includeMcp: true })).toContain(
      '@modelcontextprotocol/sdk',
    );
    expect(formatAIDependencyHint('ollama')).toContain('@ai-sdk/openai-compatible');
  });

  it('diagnoses missing AI dependencies from config', () => {
    const config = {
      ai: {
        enabled: true,
      },
    };
    const pkg = { dependencies: { 'zhin.js': '^4.0.0' } };
    const diagnosis = diagnoseAIDependencies('/tmp', config, pkg);
    expect(diagnosis?.missingFromPackageJson).toContain('@zhin.js/agent');
    expect(diagnosis?.missingFromPackageJson).not.toContain('@ai-sdk/openai');
    expect(diagnosis?.missingFromPackageJson).not.toContain('@modelcontextprotocol/sdk');
  });

  it('resolves openai-compatible sdk from custom provider alias', () => {
    const config = {
      ai: {
        enabled: true,
      },
    };
    const required = getRequiredAIDependenciesForConfig(config, { services: { 'agnes-ai': { driver: 'openai-compatible' } } });
    expect(required['@ai-sdk/openai-compatible']).toBe('latest');
    expect(required.ai).toBe('latest');
  });

  it('flags ai@6 + openai-compatible@3 incompatibility', () => {
    const pkg = {
      dependencies: {
        ai: '^6.0.209',
        '@ai-sdk/openai-compatible': '^3.0.0',
      },
    };
    const issues = findInstalledAiStackIncompatibilities('/tmp/nonexistent', pkg);
    expect(issues.some((issue) => issue.package === 'ai')).toBe(true);
    expect(issues.some((issue) => issue.package === '@ai-sdk/openai-compatible')).toBe(true);
  });

  it('includes MCP when memoryMcp is enabled', () => {
    const config = {
      ai: {
        enabled: true,
        memoryMcp: true,
      },
    };
    const diagnosis = diagnoseAIDependencies('/tmp', config, { dependencies: {} });
    expect(diagnosis?.missingFromPackageJson).toContain('@modelcontextprotocol/sdk');
  });

  it('returns agent stack + provider sdk when AI is enabled (MCP only when requested)', () => {
    expect(getAIDependencies({ enabled: false })).toEqual({});
    expect(getAIDependencies({ enabled: true, agentProvider: 'openai' })).toEqual({
      '@zhin.js/agent': 'latest',
      zod: 'latest',
      ai: 'latest',
      '@ai-sdk/openai': 'latest',
    });
    expect(getAIDependencies({
      enabled: true,
      agentProvider: 'openai',
      memoryMcp: true,
    })).toMatchObject({
      '@modelcontextprotocol/sdk': 'latest',
    });
    expect(getAIDependencies({ enabled: true, agentProvider: 'ollama' })).toMatchObject({
      '@ai-sdk/openai-compatible': 'latest',
    });
  });

  it('auto-adds SQLite when AI enabled interactively without database', () => {
    const options: InitOptions = {
      yes: false,
      ai: {
        enabled: true,
        agentProvider: 'openai',
        sessions: RECOMMENDED_AI_DEFAULTS.sessions,
      },
    };

    ensureDatabaseForAI(options);

    expect(options.database).toEqual({
      dialect: 'sqlite',
      filename: './data/bot.db',
      mode: 'wal',
    });
  });

  it('does not auto-add database in -y Stable mode', () => {
    const options: InitOptions = {
      yes: true,
      ai: { enabled: true, agentProvider: 'ollama' },
    };

    ensureDatabaseForAI(options);

    expect(options.database).toBeUndefined();
  });

  it('auto-adds SQLite when GitHub adapter requires database', () => {
    const options: InitOptions = {
      yes: false,
      adapters: { packages: [], plugins: [], instances: [], envVars: {}, requiresDatabase: true },
    };

    ensureDatabaseForAdapters(options);

    expect(options.database?.dialect).toBe('sqlite');
  });

  it('findUnresolvedPackageInstalls falls back to node_modules when exports hide ./package.json', async () => {
    // zhin.js 的 exports map 未暴露 ./package.json，req.resolve 必炸
    // （ERR_PACKAGE_PATH_NOT_EXPORTED），不能据此误报“已声明但未安装”。
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zhin-project-deps-'));
    try {
      await fs.writeJson(path.join(dir, 'package.json'), { name: 'fixture', version: '0.0.0' });
      const pkgDir = path.join(dir, 'node_modules', 'zhin.js');
      await fs.ensureDir(path.join(pkgDir, 'lib'));
      await fs.writeJson(path.join(pkgDir, 'package.json'), {
        name: 'zhin.js',
        version: '5.0.0',
        exports: { '.': './lib/index.js' },
      });
      await fs.writeFile(path.join(pkgDir, 'lib', 'index.js'), 'export {};\n');

      expect(findUnresolvedPackageInstalls(dir, ['zhin.js'])).toEqual([]);
      expect(findUnresolvedPackageInstalls(dir, ['@zhin.js/agent'])).toEqual(['@zhin.js/agent']);
    } finally {
      await fs.remove(dir);
    }
  });
});


it('installs the explicit proposal protocol SDKs without treating it as startup configuration', () => {
  const plan = { services: {
    codex: { driver: 'codex-subscription' }, claude: { driver: 'claude-subscription' }, google: { driver: 'antigravity' },
    go: { driver: 'opencode-go', models: { arbitrary: { protocol: 'openai-chat' }, another: { protocol: 'anthropic-messages' } } },
    mini: { driver: 'minimax' },
  } };
  const required = getRequiredAIDependenciesForConfig({ ai: { enabled: true } }, plan);
  expect(required).toMatchObject({ '@ai-sdk/openai': 'latest', '@ai-sdk/anthropic': 'latest', '@ai-sdk/google': 'latest', '@ai-sdk/minimax': 'latest', '@ai-sdk/openai-compatible': 'latest' });
  expect(getRequiredAIDependenciesForConfig({ ai: { enabled: true } }, { services: { unknown: { driver: 'opencode-go', models: { 'claude-name-does-not-prove-protocol': {} } } } })).not.toHaveProperty('@ai-sdk/anthropic');
});

it('diagnoseAIDependencies reads ai.plan.yml in cwd when proposal is not explicitly passed', async () => {
  const { diagnoseAIDependencies } = await import('../src/project-deps.js');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zhin-ai-plan-diag-'));
  try {
    await fs.writeJson(path.join(dir, 'package.json'), {
      name: 'fixture',
      version: '0.0.0',
      dependencies: { '@zhin.js/agent': 'latest', ai: '^7.0.35', zod: 'latest' },
    });
    await fs.writeFile(
      path.join(dir, 'ai.plan.yml'),
      'version: 1\nservices:\n  deepseek:\n    driver: deepseek\naccounts:\n  deepseek:\n    service: deepseek\nprofiles:\n  deepseek:deepseek-chat:\n    account: deepseek\n    model: deepseek-chat\npurposes:\n  chat:\n    profile: deepseek:deepseek-chat\n',
      'utf8',
    );
    const diag = diagnoseAIDependencies(dir, { ai: { enabled: true } });
    expect(diag).not.toBeNull();
    expect(diag?.required).toHaveProperty('@ai-sdk/deepseek');
    expect(diag?.missingFromPackageJson).toContain('@ai-sdk/deepseek');
  } finally {
    await fs.remove(dir);
  }
});
