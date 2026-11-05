import { describe, expect, it } from 'vitest';
import hostSchema from '../src/host-config-schema.json' with { type: 'json' };
import planSchema from '../../ai/provider-plan.schema.json' with { type: 'json' };
import { parsePluginConfigSchema } from '../src/config-composer.js';

type Schema = Record<string, unknown>;

function field(path: string[]): Schema {
  let current: Schema = hostSchema;
  for (const key of path) {
    const properties = current.properties as Record<string, Schema> | undefined;
    expect(properties, path.join('.')).toHaveProperty(key);
    current = properties![key]!;
  }
  return current;
}

function check(value: unknown): unknown {
  const result = parsePluginConfigSchema(hostSchema, value);
  expect(result.errors).toEqual([]);
  return result.value;
}

describe('Host configuration field coverage', () => {
  it('keeps project language optional without inserting a saved default', () => {
    expect(field(['locale'])).toMatchObject({ type: 'string', enum: ['zh-CN', 'en'] });
    expect(field(['locale'])).not.toHaveProperty('default');
    const input = { http: { host: '127.0.0.1' } };
    expect(check(input)).toEqual(input);
    expect(input).not.toHaveProperty('locale');
    expect(check({ locale: 'en' })).toEqual({ locale: 'en' });
    expect(check({ locale: 'zh-CN' })).toEqual({ locale: 'zh-CN' });
  });

  it('declares the actual HTTP installer inputs without inventing apiBase', () => {
    expect(Object.keys(field(['http']).properties as object)).toEqual(expect.arrayContaining([
      'readiness', 'host', 'port', 'token', 'tokens', 'corsOrigins', 'base', 'tls', 'listeners',
    ]));
    expect(field(['http']).properties).not.toHaveProperty('apiBase');
    expect(field(['http', 'tokens']).items).toMatchObject({ properties: {
      token: { writeOnly: true }, scope: { type: ['string', 'null'] }, principalId: { type: ['string', 'null'] },
    } });
    check({ http: { host: '${BIND}', port: '${PORT}', base: '/api', token: '${ACCESS}',
      tokens: [{ token: '${DEMO}', scope: 'demo', principalId: 'readonly' }],
      tls: false, listeners: [{ enabled: 'off', port: '8081', tls: null }],
      readiness: { endpoints: [{ owner: 'root/mock', name: 'main' }] },
    } });
    check({ http: { tls: { enabled: '${TLS_ENABLED}', keyFile: './key.pem', certFile: './cert.pem', passphrase: '${KEY_PASS}' } } });
  });

  it.each([
    { dialect: 'memory' },
    { dialect: 'sqlite', filename: './data/bot.db' },
    { dialect: 'mysql', host: '${DB_HOST}', port: '3306', user: 'bot', password: '${DB_PASS}', database: 'bot', pool: { max: 5 } },
    { dialect: 'pg', connectionString: '${DB_URL}', ssl: { rejectUnauthorized: false, ca: ['certificate-a', 'certificate-b'] }, pool: { min: 1, acquireTimeoutMillis: 1000 } },
    { dialect: 'mongodb', url: '${DB_URL}', dbName: 'bot', auth: { username: 'bot', password: '${DB_PASS}' }, maxPoolSize: 4 },
    { dialect: 'redis', url: '${REDIS_URL}', socket: { host: 'localhost', port: '${PORT}', tls: true }, database: 0 },
  ])('retains supported database dialect connection options: $dialect', database => {
    expect(check({ database })).toEqual({ database });
  });

  it('declares the public AI service inputs and nested Agent policies', () => {
    expect(Object.keys(field(['ai']).properties as object)).toEqual(expect.arrayContaining([
      'enabled', 'workroom', 'agents', 'sessions', 'context', 'multimodal', 'memory', 'knowledge', 'githubMcp', 'mcpServers',
      'agent', 'access', 'trigger',
    ]));
    for (const path of [
      ['ai', 'sessions', 'coldStartMaxAgeMs'], ['ai', 'context', 'summaryPrompt'],
      ['ai', 'multimodal', 'perception', 'timeoutMs'], ['ai', 'memory', 'budgets', 'global'],
      ['ai', 'agent', 'modelHarness'], ['ai', 'agent', 'providerResilience'],
      ['ai', 'agent', 'schedule'], ['ai', 'agent', 'thinkingPreviewMaxLength'],
      ['ai', 'agent', 'recordRequestBodies'],
    ]) expect(field(path)).toBeTypeOf('object');
    expect(field(['ai']).properties).not.toHaveProperty('providers');
    expect(field(['ai']).properties).not.toHaveProperty('modelCatalog');
    expect(field(['ai']).properties).not.toHaveProperty('modelPolicy');
    expect(field(['ai']).properties).not.toHaveProperty('decisions');
    expect(field(['ai']).properties).not.toHaveProperty('imageGeneration');
    expect(field(['ai']).properties).not.toHaveProperty('plan');
    expect(planSchema).toMatchObject({ required: ['version'], additionalProperties: false });
    expect(check({ ai: { agent: { recordRequestBodies: false } } })).toMatchObject({ ai: { agent: { recordRequestBodies: false } } });
    // The runtime option is boolean; accepting "false" would silently leave recording enabled.
    expect(parsePluginConfigSchema(hostSchema, { ai: { agent: { recordRequestBodies: 'false' } } }).errors).not.toEqual([]);
    check({ ai: { enabled: '${AI_ENABLED}', agents: { helper: { nickname: 'Helper', mcpServers: [] } },
    sessions: { maxHistory: 20 }, multimodal: { enabled: true, perception: { kinds: ['image'], timeoutMs: 1000 } },
    memory: { enabled: true, semantic: { recall: { topK: 3 } } },
    mcpServers: [{ name: 'fixture', transport: 'stdio', command: 'node', args: ['fixture.mjs'], env: { FIXTURE_KEY: '${KEY}' } }],
    agent: { maxIterations: 3, schedule: { budget: { maxTokens: 20 } } },
    access: { mode: 'closed' }, trigger: { prefixes: ['ask'] },
    } });
  });

  it('declares Speech, Assistant and MCP/A2A inputs as structured objects', () => {
    for (const path of [
      ['speech', 'stt', 'provider'], ['speech', 'tts', 'headers'],
      // assistant.queue removed (ADR 0048 H3): retries/concurrency are internal to TimerScheduler
      ['assistant', 'defaults', 'notify'],
      ['assistant', 'home', 'policy', 'requireMaster'], ['assistant', 'events', 'allowedSources'],
      ['mcp', 'allowUnauthenticatedLocalhost'], ['a2a', 'workroomCallbacks', 'bindings'],
      ['a2a', 'workroomRemoteExecutors', 'maxResponseBytes'],
    ]) expect(field(path)).toBeTypeOf('object');
    expect(field(['assistant']).properties).not.toHaveProperty('queue');
    check({ speech: { stt: { enabled: true, provider: 'openai', apiKey: '${KEY}' },
      tts: { enabled: '${TTS_ON}', provider: 'azure', region: 'fixture', subscriptionKey: '${KEY}', rate: '+10%' } },
    assistant: { enabled: true,
      defaults: { notify: { channel: 'silent' } }, home: { aliases: { lamp: 'light.fixture' }, restToken: '${HOME_KEY}' } },
    mcp: { enabled: true, path: '/mcp', token: '${KEY}' },
    a2a: { enabled: '${A2A_ON}', workroomCallbacks: { bindings: [{ endpointId: 'fixture', credential: { source: 'config', value: '${KEY}' } }] } },
    });
  });

  it('does not insert optional Hosts or new defaults, and preserves extension options', () => {
    expect(check({})).toEqual({});
    const input = { database: { dialect: 'memory', extension: { driverOption: 1 } },
      ai: { extension: { futureOption: [1, 2] } },
      speech: { tts: { extension: true } }, assistant: { extension: 'kept' } };
    expect(check(input)).toEqual(input);
    const schema = hostSchema as unknown as Schema;
    expect(schema.additionalProperties).toBe(false);
    for (const host of ['http', 'database', 'ai', 'speech', 'assistant', 'mcp', 'a2a']) {
      expect(field([host]).additionalProperties).toBe(true);
      expect(field([host])).not.toHaveProperty('default');
      expect(field([host])).not.toHaveProperty('required');
    }
    expect(parsePluginConfigSchema(hostSchema, { http: { readiness: { unsupported: true } } }).errors.length).toBeGreaterThan(0);
    expect(parsePluginConfigSchema(hostSchema, { menuStyle: { unsupported: true } }).errors.length).toBeGreaterThan(0);
  });

  it.each([
    { ai: { mcpServers: null } },
    { ai: { agents: { fixture: { mcpServers: null } } } },
    { ai: { agents: null, sessions: null, context: null, access: null, trigger: null } },
    { ai: { multimodal: null, memory: null } },
    { ai: { multimodal: { perception: null }, memory: { semantic: null } } },
    { ai: { memory: { semantic: { recall: null } } } },
    { ai: { memory: { semantic: { recall: { topK: null, maxTokens: null } } } } },
    { assistant: { defaults: null, profile: null, home: null, events: null } },
    { assistant: { defaults: { notify: null } } },
    { assistant: { profile: { file: null }, home: { aliases: null, watch: null, debounceMs: null, policy: null }, events: { rateLimitPerMinute: null } } },
    { assistant: { home: { policy: { confirmServices: null, allowedServiceDomains: null } } } },
    { speech: { stt: null, tts: null } },
    { http: { host: null, port: null, token: null, tokens: null, corsOrigins: null, base: null } },
    { http: { tokens: [null, { token: null }, { token: 'fixture', scope: null, principalId: null }], corsOrigins: [null, 'https://fixture.invalid'] } },
    { database: { dialect: 'mysql', pool: null } },
    { database: { dialect: 'pg', pool: { min: null, max: null, acquireTimeoutMillis: null, idleTimeoutMillis: null } } },
    { mcp: { path: null, token: null }, a2a: { path: null, token: null, publicUrl: null, workroomCallbacks: null, workroomRemoteExecutors: null } },
  ])('retains explicit null where the existing consumer already falls back: %#', input => {
    expect(check(input)).toEqual(input);
  });

  it('does not relax previously strict Host fields or non-null collection members', () => {
    for (const input of [
      { ai: { agent: null } }, { ai: { workroom: null } }, { http: { readiness: null } },
      { ai: { mcpServers: [null] } }, { http: { listeners: null } },
      { ai: { multimodal: { perception: { maxChars: null } } } },
    ]) expect(parsePluginConfigSchema(hostSchema, input).errors.length).toBeGreaterThan(0);
  });
});


it('declares only non-secret import inputs and validates actual target model contracts', () => {
  const valid = { version: 1, accounts: { subscription: { service: 'host-service', auth: { method: 'oauth' } } } };
  expect(parsePluginConfigSchema(planSchema, valid)).toEqual({ value: valid, errors: [] });
  for (const plan of [
    { version: 1, accounts: { bad: { service: 'host-service', auth: { method: 'api-key', source: 'literal-secret' } } } },
    { version: 1, accounts: { bad: { service: 'host-service', auth: { method: 'oauth', source: 'env://KEY' } } } },
    { version: 1, profiles: { bad: { account: 'account', model: 'model', apiKey: 'literal-secret' } } },
    { version: 1, purposes: { scenes: { scene: { ambient: { profile: 'wrong-scope' } } } } },
  ]) expect(parsePluginConfigSchema(planSchema, plan).errors.length).toBeGreaterThan(0);
});
