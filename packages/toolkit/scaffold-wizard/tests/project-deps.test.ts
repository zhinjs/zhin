import { describe, expect, it } from 'vitest';
import { MCP_SDK_VERSION, ensureDatabaseForAI, ensureDatabaseForAdapters, getAIDependencies } from '../src/project-deps.js';
import { RECOMMENDED_AI_DEFAULTS } from '../src/ai.js';
import type { InitOptions } from '../src/types.js';

describe('project-deps', () => {
  it('returns MCP SDK when AI is enabled', () => {
    expect(getAIDependencies({ enabled: false })).toEqual({});
    expect(getAIDependencies({ enabled: true })).toEqual({
      '@modelcontextprotocol/sdk': MCP_SDK_VERSION,
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
      adapters: { packages: [], plugins: [], bots: [], envVars: {}, requiresDatabase: true },
    };

    ensureDatabaseForAdapters(options);

    expect(options.database?.dialect).toBe('sqlite');
  });
});
