import { describe, expect, it } from 'vitest';
import { MCP_SDK_VERSION, ensureDatabaseForAI, ensureDatabaseForAdapters, getAIDependencies, listAIDependencyNames, formatAIDependencyHint, diagnoseAIDependencies } from '../src/project-deps.js';
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
      '@zhin.js/agent': 'latest',
      zod: '^4.0.0',
      ai: '^6.0.0',
      '@modelcontextprotocol/sdk': MCP_SDK_VERSION,
      '@ai-sdk/openai': '^3.0.0',
    });
    expect(getAIDependencies({ enabled: true, defaultProvider: 'ollama' })).toMatchObject({
      '@ai-sdk/openai-compatible': '^1.0.0',
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
