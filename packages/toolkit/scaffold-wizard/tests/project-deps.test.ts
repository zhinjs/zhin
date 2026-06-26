import { describe, expect, it } from 'vitest';
import {
  AI_STACK_VERSIONS,
  ensureDatabaseForAI,
  ensureDatabaseForAdapters,
  getAIDependencies,
  listAIDependencyNames,
  formatAIDependencyHint,
  diagnoseAIDependencies,
  findInstalledAiStackIncompatibilities,
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
      '@modelcontextprotocol/sdk',
      '@ai-sdk/openai',
    ]);
    expect(formatAIDependencyHint('ollama')).toContain('@ai-sdk/openai-compatible');
  });

  it('diagnoses missing AI dependencies from config', () => {
    const config = {
      ai: {
        enabled: true,
        agents: { zhin: { provider: 'openai', model: 'gpt-4o' } },
        providers: { openai: { sdk: 'openai' } },
      },
    };
    const pkg = { dependencies: { 'zhin.js': '^4.0.0' } };
    const diagnosis = diagnoseAIDependencies('/tmp', config, pkg);
    expect(diagnosis?.missingFromPackageJson).toContain('@zhin.js/agent');
    expect(diagnosis?.missingFromPackageJson).toContain('@ai-sdk/openai');
    expect(diagnosis?.missingFromPackageJson).not.toContain('@modelcontextprotocol/sdk');
  });

  it('resolves openai-compatible sdk from custom provider alias', () => {
    const config = {
      ai: {
        enabled: true,
        agents: { zhin: { provider: 'agnes-ai' } },
        providers: { 'agnes-ai': { sdk: 'openai-compatible' } },
      },
    };
    const required = getRequiredAIDependenciesForConfig(config);
    expect(required['@ai-sdk/openai-compatible']).toBe(AI_STACK_VERSIONS['@ai-sdk/openai-compatible']);
    expect(required.ai).toBe(AI_STACK_VERSIONS.ai);
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
        agents: { zhin: { provider: 'ollama' } },
        providers: { ollama: { sdk: 'ollama' } },
      },
    };
    const diagnosis = diagnoseAIDependencies('/tmp', config, { dependencies: {} });
    expect(diagnosis?.missingFromPackageJson).toContain('@modelcontextprotocol/sdk');
  });

  it('returns agent stack + MCP SDK + provider sdk when AI is enabled', () => {
    expect(getAIDependencies({ enabled: false })).toEqual({});
    expect(getAIDependencies({ enabled: true, defaultProvider: 'openai' })).toEqual({
      '@zhin.js/agent': AI_STACK_VERSIONS['@zhin.js/agent'],
      zod: AI_STACK_VERSIONS.zod,
      ai: AI_STACK_VERSIONS.ai,
      '@modelcontextprotocol/sdk': AI_STACK_VERSIONS['@modelcontextprotocol/sdk'],
      '@ai-sdk/openai': AI_STACK_VERSIONS['@ai-sdk/openai'],
    });
    expect(getAIDependencies({ enabled: true, defaultProvider: 'ollama' })).toMatchObject({
      '@ai-sdk/openai-compatible': AI_STACK_VERSIONS['@ai-sdk/openai-compatible'],
    });
  });

  it('auto-adds SQLite when AI enabled interactively without database', () => {
    const options: InitOptions = {
      yes: false,
      ai: {
        enabled: true,
        defaultProvider: 'openai',
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
      ai: { enabled: true, defaultProvider: 'ollama' },
    };

    ensureDatabaseForAI(options);

    expect(options.database).toBeUndefined();
  });

  it('auto-adds SQLite when GitHub adapter requires database', () => {
    const options: InitOptions = {
      yes: false,
      adapters: { packages: [], plugins: [], endpoints: [], envVars: {}, requiresDatabase: true },
    };

    ensureDatabaseForAdapters(options);

    expect(options.database?.dialect).toBe('sqlite');
  });
});
