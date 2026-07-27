import { describe, expect, it, vi } from 'vitest';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import {
  appendWizardEnvVars,
  applyAdaptersToConfig,
  applyDatabaseToConfig,
  applyWizardOptionsToConfig,
  buildRuntimeConfigDocument,
  collectWizardDependencies,
  collectWizardFeatures,
  finalizeWizardOptions,
  mergeFeaturesIntoPackageJson,
  serializeRuntimeConfig,
} from '../src/apply.js';
import type { AdapterSetupResult, InitOptions } from '../src/types.js';

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

describe('applyDatabaseToConfig', () => {
  it('keeps sqlite config as-is', () => {
    const config: Record<string, unknown> = {};
    applyDatabaseToConfig(config, { dialect: 'sqlite', filename: './data/bot.db', mode: 'wal' });
    expect(config.database).toEqual({ dialect: 'sqlite', filename: './data/bot.db', mode: 'wal' });
  });

  it('references env vars instead of writing plaintext passwords for mysql', () => {
    const config: Record<string, unknown> = {};
    applyDatabaseToConfig(config, {
      dialect: 'mysql',
      host: 'db.internal',
      port: 3306,
      user: 'root',
      password: 'super-secret',
      database: 'zhin_bot',
    });
    expect(config.database).toEqual({
      dialect: 'mysql',
      host: '${DB_HOST}',
      port: '${DB_PORT}',
      user: '${DB_USER}',
      password: '${DB_PASSWORD}',
      database: '${DB_DATABASE}',
    });
    expect(JSON.stringify(config)).not.toContain('super-secret');
    expect(JSON.stringify(config)).not.toContain('db.internal');
  });
});

describe('appendWizardEnvVars', () => {
  it('writes database/adapter/ai env vars and is idempotent per KEY', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zhin-wizard-env-'));
    try {
      await fs.writeFile(path.join(dir, '.env'), '# HTTP 服务配置\nHTTP_TOKEN=tok\n');
      const database = {
        dialect: 'mysql',
        host: 'localhost',
        port: 3306,
        user: 'root',
        password: 'p#ss',
        database: 'zhin_bot',
      } as const;
      const adapters = {
        packages: [],
        plugins: [],
        instances: [],
        envVars: { TELEGRAM_TOKEN: 'tok #1' },
      };
      const ai = {
        enabled: true,
        agentProvider: 'openai',
        providers: { openai: { apiKey: '${AI_API_KEY}', __envApiKey: 'sk-real key' } },
      } as never;

      await appendWizardEnvVars(dir, adapters, ai, database);
      const first = await fs.readFile(path.join(dir, '.env'), 'utf-8');
      expect(first).toContain('HTTP_TOKEN=tok');
      expect(first).toContain('DB_PASSWORD="p#ss"');
      expect(first).toContain('TELEGRAM_TOKEN="tok #1"');
      expect(first).toContain('AI_API_KEY="sk-real key"');

      // 重复运行：同 KEY 覆盖，不产生重复行；新值生效
      await appendWizardEnvVars(dir, { ...adapters, envVars: { TELEGRAM_TOKEN: 'tok-2' } }, ai, database);
      const second = await fs.readFile(path.join(dir, '.env'), 'utf-8');
      expect(second).toContain('TELEGRAM_TOKEN=tok-2');
      expect(second).not.toContain('tok #1');
      expect(second.split('DB_PASSWORD=')).toHaveLength(2);
      expect(second.split('AI_API_KEY=')).toHaveLength(2);
    } finally {
      await fs.remove(dir);
    }
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

describe('applyAdaptersToConfig', () => {
  const sandboxResult = (endpoints: unknown[]): AdapterSetupResult => ({
    packages: ['@zhin.js/adapter-sandbox'],
    plugins: ['@zhin.js/adapter-sandbox'],
    instances: [{
      package: '@zhin.js/adapter-sandbox',
      instanceKey: 'sandbox',
      config: { endpoints },
    }],
    envVars: {},
  });

  it('rerun keeps manually added endpoints and other instance-level keys', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const config: Record<string, unknown> = {
        plugins: {
          sandbox: {
            commandPrefix: '/',
            endpoints: [
              { context: 'sandbox', name: 'sandbox-bot', owner: 'sandbox-user' },
              { context: 'sandbox', name: 'manual-bot', owner: 'someone-else' },
            ],
          },
        },
      };

      applyAdaptersToConfig(config, sandboxResult([
        { context: 'sandbox', name: 'sandbox-bot', owner: 'sandbox-user' },
      ]));

      const plugins = config.plugins as Record<string, Record<string, unknown>>;
      expect(plugins.sandbox.commandPrefix).toBe('/');
      expect(plugins.sandbox.endpoints).toEqual([
        { context: 'sandbox', name: 'sandbox-bot', owner: 'sandbox-user' },
        { context: 'sandbox', name: 'manual-bot', owner: 'someone-else' },
      ]);
    } finally {
      warn.mockRestore();
    }
  });

  it('wizard result wins on endpoint name conflicts and warns about dropped entries', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const config: Record<string, unknown> = {
        plugins: {
          sandbox: {
            endpoints: [{ context: 'sandbox', name: 'sandbox-bot', owner: 'stale-owner' }],
          },
        },
      };

      applyAdaptersToConfig(config, sandboxResult([
        { context: 'sandbox', name: 'sandbox-bot', owner: 'sandbox-user' },
      ]));

      const plugins = config.plugins as Record<string, Record<string, unknown>>;
      expect(plugins.sandbox.endpoints).toEqual([
        { context: 'sandbox', name: 'sandbox-bot', owner: 'sandbox-user' },
      ]);
      expect(warn).toHaveBeenCalledOnce();
      expect(String(warn.mock.calls[0]?.[0])).toContain('sandbox-bot');
    } finally {
      warn.mockRestore();
    }
  });

  it('adds new instances without touching existing ones', () => {
    const config: Record<string, unknown> = {
      plugins: { telegram: { polling: true } },
    };

    applyAdaptersToConfig(config, sandboxResult([{ context: 'sandbox', name: 'sandbox-bot' }]));

    const plugins = config.plugins as Record<string, unknown>;
    expect(plugins.telegram).toEqual({ polling: true });
    expect(plugins.sandbox).toEqual({ endpoints: [{ context: 'sandbox', name: 'sandbox-bot' }] });
  });
});

describe('collectWizardDependencies / collectWizardFeatures', () => {
  it('adds @zhin.js/tool dependency and feature entry when AI is enabled', () => {
    const ai = {
      enabled: true,
      agentProvider: 'ollama',
      providers: { ollama: { host: 'http://127.0.0.1:11434' } },
    };

    const deps = collectWizardDependencies({ ai });
    expect(deps['@zhin.js/agent']).toBe('latest');
    expect(deps['@zhin.js/tool']).toBe('latest');
    expect(collectWizardFeatures({ ai })).toEqual([{ package: '@zhin.js/tool', api: '^1.0.0' }]);
  });

  it('does not add @zhin.js/tool when AI is disabled', () => {
    const deps = collectWizardDependencies({ ai: { enabled: false } });
    expect(deps).not.toHaveProperty('@zhin.js/tool');
    expect(deps).not.toHaveProperty('@zhin.js/agent');
    expect(collectWizardFeatures({ ai: { enabled: false } })).toEqual([]);
  });
});

describe('mergeFeaturesIntoPackageJson', () => {
  it('merges feature entries into zhin.features idempotently', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zhin-wizard-features-'));
    try {
      await fs.writeJson(path.join(dir, 'package.json'), {
        name: 'bot',
        zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts', features: [] },
      });

      const changed = await mergeFeaturesIntoPackageJson(dir, [{ package: '@zhin.js/tool', api: '^1.0.0' }]);
      expect(changed).toBe(true);
      let pkg = await fs.readJson(path.join(dir, 'package.json'));
      expect(pkg.zhin.features).toEqual([{ package: '@zhin.js/tool', api: '^1.0.0' }]);

      // 重复运行不重复追加
      expect(await mergeFeaturesIntoPackageJson(dir, [{ package: '@zhin.js/tool', api: '^1.0.0' }])).toBe(false);
      pkg = await fs.readJson(path.join(dir, 'package.json'));
      expect(pkg.zhin.features).toHaveLength(1);
    } finally {
      await fs.remove(dir);
    }
  });
});
