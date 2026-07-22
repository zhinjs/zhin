import { describe, expect, it } from 'vitest';
import {
  applyWizardOptionsToConfig,
  buildRuntimeConfigDocument,
  finalizeWizardOptions,
  serializeRuntimeConfig,
} from '../src/apply.js';
import type { InitOptions } from '../src/types.js';

describe('apply wizard to config', () => {
  it('merges database, adapters, and ai into new runtime config format', () => {
    const config: Record<string, unknown> = { plugins: ['example'], endpoints: [] };
    const options: InitOptions = {
      database: { dialect: 'sqlite', filename: './data/bot.db', mode: 'wal' },
      adapters: {
        packages: ['@zhin.js/adapter-telegram'],
        plugins: ['@zhin.js/adapter-sandbox', '@zhin.js/adapter-telegram'],
        instances: [{
          package: '@zhin.js/adapter-telegram',
          instanceKey: 'telegram',
          config: { polling: true, endpoints: [{ name: 'tg', token: '${TELEGRAM_TOKEN}' }] },
        }],
        envVars: { TELEGRAM_TOKEN: 'x' },
      },
      ai: { enabled: true, agentProvider: 'ollama', providers: { ollama: { host: 'http://127.0.0.1:11434' } } },
    };

    finalizeWizardOptions(options);
    applyWizardOptionsToConfig(config, options);

    // legacy 数组 plugins 迁移为 instanceKey 映射；legacy endpoints 键被移除
    expect(config.endpoints).toBeUndefined();
    const plugins = config.plugins as Record<string, unknown>;
    expect(plugins.example).toEqual({});
    expect(plugins.telegram).toEqual({ polling: true, endpoints: [{ name: 'tg', token: '${TELEGRAM_TOKEN}' }] });
    expect(config.database).toEqual({ dialect: 'sqlite', filename: './data/bot.db', mode: 'wal' });
    expect(config.inbox).toBeUndefined();
    expect(config.ai).toMatchObject({
      providers: { ollama: { sdk: 'ollama', host: 'http://127.0.0.1:11434' } },
      agents: { zhin: { provider: 'ollama' } },
    });
    expect(config.ai).not.toHaveProperty('defaultProvider');
  });
});

describe('buildRuntimeConfigDocument', () => {
  const options: InitOptions = {
    httpToken: 'token',
    database: { dialect: 'sqlite', filename: './data/bot.db', mode: 'wal' },
    adapters: {
      packages: ['@zhin.js/adapter-sandbox'],
      plugins: ['@zhin.js/adapter-sandbox'],
      instances: [{
        package: '@zhin.js/adapter-sandbox',
        instanceKey: 'sandbox',
        config: { endpoints: [{ context: 'sandbox', name: 'sandbox-bot', owner: 'sandbox-user' }] },
      }],
      envVars: {},
    },
    ai: { enabled: false },
  };

  it('emits top-level http/database and plugins.<instanceKey> blocks', () => {
    const doc = buildRuntimeConfigDocument(options);

    expect(doc.http).toMatchObject({ token: '${HTTP_TOKEN}', port: 8068, base: '/api' });
    expect((doc.http as { corsOrigins: string[] }).corsOrigins).toContain('https://console.zhin.dev');
    expect(doc.database).toEqual({ dialect: 'sqlite', filename: './data/bot.db', mode: 'wal' });
    expect(doc.plugins).toEqual({
      sandbox: { endpoints: [{ context: 'sandbox', name: 'sandbox-bot', owner: 'sandbox-user' }] },
    });
    // runtime config-composer 不接受的顶层键不得出现
    expect(doc).not.toHaveProperty('endpoints');
    expect(doc).not.toHaveProperty('inbox');
  });

  it('serializes to yaml/json/toml', () => {
    const doc = buildRuntimeConfigDocument(options);
    expect(serializeRuntimeConfig(doc, 'yaml')).toContain('plugins:');
    expect(JSON.parse(serializeRuntimeConfig(doc, 'json')).plugins.sandbox).toBeDefined();
    expect(serializeRuntimeConfig(doc, 'toml')).toContain('[[plugins.sandbox.endpoints]]');
  });

  it('writes ai section only when enabled', () => {
    const aiOptions: InitOptions = {
      ...options,
      ai: { enabled: true, agentProvider: 'ollama', providers: { ollama: { host: 'http://127.0.0.1:11434' } } },
    };
    const doc = buildRuntimeConfigDocument(aiOptions);
    expect(doc.ai).toMatchObject({ agents: { zhin: { provider: 'ollama' } } });
    expect(buildRuntimeConfigDocument(options)).not.toHaveProperty('ai');
  });
});
