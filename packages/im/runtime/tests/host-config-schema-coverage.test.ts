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
      'readiness', 'host', 'port', 'token', 'corsOrigins', 'base', 'tls', 'listeners',
    ]));
    expect(field(['http']).properties).not.toHaveProperty('apiBase');
    // ADR 0049: Console users / API tokens live in the database, not in config.
    expect(field(['http']).properties).not.toHaveProperty('tokens');
    check({ http: { host: '${BIND}', port: '${PORT}', base: '/api', token: '${ACCESS}',
      tls: false, listeners: [{ enabled: 'off', port: 8081, tls: null }, { port: '${EXTRA_PORT:-8082}' }],
      readiness: { endpoints: [{ owner: 'root/mock', name: 'main' }] },
    } });
    check({ http: { tls: { enabled: '${TLS_ENABLED}', keyFile: './key.pem', certFile: './cert.pem', passphrase: '${KEY_PASS}' } } });
    for (const trustProxy of [false, true, 2, ['loopback', '10.0.0.0/8'], '${TRUST_PROXY}']) check({ http: { trustProxy } });
    expect(parsePluginConfigSchema(hostSchema, { http: { trustProxy: { hops: 1 } } }).errors).not.toEqual([]);
  });

  it('accepts only 1–65535 integers or whole ${VAR} references as ports (#1250)', () => {
    for (const port of ['abc', '8081', -1, 65536, 99999, 80.5, 'x${PORT}']) {
      expect(parsePluginConfigSchema(hostSchema, { http: { port } }).errors, String(port)).not.toEqual([]);
      expect(parsePluginConfigSchema(hostSchema, { http: { listeners: [{ host: '127.0.0.1', port }] } }).errors, String(port)).not.toEqual([]);
    }
    // 0 keeps its listener meaning: the system picks a free port.
    for (const port of [0, 1, 8068, 65535, '${PORT}', '${PORT:-8068}']) check({ http: { port } });
  });

  it('declares console.loginAssist.captchaHelperUrl (ADR 0058)', () => {
    expect(field(['console', 'loginAssist', 'captchaHelperUrl'])).toMatchObject({ type: 'string' });
    check({ console: { loginAssist: { captchaHelperUrl: 'https://helper.example/tcaptcha.html' } } });
    check({ console: { loginAssist: { captchaHelperUrl: 'http://localhost:5173/tcaptcha.html' } } });
    expect(parsePluginConfigSchema(hostSchema, { console: { loginAssist: { captchaHelperUrl: 'http://evil.example/x' } } }).errors).not.toEqual([]);
    expect(parsePluginConfigSchema(hostSchema, { console: { loginAssist: { other: true } } }).errors).not.toEqual([]);
  });

  it('declares console.terminal with the same rules as the terminal parser (ADR 0051)', () => {
    expect(field(['console', 'terminal'])).toMatchObject({ 'x-zhin-config': { security: true } });
    const terminal = {
      enabled: true, shell: '/bin/bash', cwd: '.', idleTimeout: 900, maxSessions: 4,
      ssh: [
        { name: 'build-box', host: '10.0.0.12', port: 22, username: 'deploy', privateKeyPath: '~/.ssh/id_ed25519',
          hostFingerprint: `SHA256:${'A'.repeat(43)}` },
        { name: 'db', host: 'db.internal', port: 2222, username: 'ops', passwordEnv: 'DB_SSH_PASSWORD', insecureAcceptAnyHostKey: true },
      ],
    };
    expect(check({ console: { terminal } })).toEqual({ console: { terminal } });
    const errors = (value: unknown) => parsePluginConfigSchema(hostSchema, { console: { terminal: value } }).errors;
    expect(errors({ enabled: true, idleTimeout: 604801 })).not.toEqual([]);
    expect(errors({ enabled: true, maxSessions: 0 })).not.toEqual([]);
    expect(errors({ enabled: true, unknown: 1 })).not.toEqual([]);
    const ssh = (target: Record<string, unknown>) => errors({ ssh: [{ host: 'h', username: 'u', ...target }] });
    expect(ssh({ name: 'local', passwordEnv: 'P' })).not.toEqual([]);
    expect(ssh({ name: '-bad', passwordEnv: 'P' })).not.toEqual([]);
    expect(ssh({ name: 'box' })).not.toEqual([]);
    expect(ssh({ name: 'box', privateKeyPath: 'k', privateKeyEnv: 'K' })).not.toEqual([]);
    expect(ssh({ name: 'box', passwordEnv: 'P', hostFingerprint: 'MD5:aa' })).not.toEqual([]);
    const pin = `SHA256:${'B'.repeat(43)}`;
    expect(ssh({ name: 'box', privateKeyEnv: 'KEY', hostFingerprint: pin })).toEqual([]);
    expect(ssh({ name: 'box', privateKeyEnv: 'KEY', insecureAcceptAnyHostKey: true })).toEqual([]);
    // Host key verification is required by default (ADR 0051): neither, false, or both is invalid.
    expect(ssh({ name: 'box', privateKeyEnv: 'KEY' })).not.toEqual([]);
    expect(ssh({ name: 'box', privateKeyEnv: 'KEY', insecureAcceptAnyHostKey: false })).not.toEqual([]);
    expect(ssh({ name: 'box', privateKeyEnv: 'KEY', hostFingerprint: pin, insecureAcceptAnyHostKey: true })).not.toEqual([]);
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
      'enabled', 'venues', 'externalPeers', 'agents', 'sessions', 'context', 'multimodal', 'memory', 'knowledge', 'githubMcp', 'mcpServers',
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
      ['mcp', 'allowUnauthenticatedLocalhost'], ['a2a', 'mailbox', 'peers'],
      ['a2a', 'mailbox', 'maxBodyBytes'],
    ]) expect(field(path)).toBeTypeOf('object');
    expect(field(['assistant']).properties).not.toHaveProperty('queue');
    check({ speech: { stt: { enabled: true, provider: 'openai', apiKey: '${KEY}' },
      tts: { enabled: '${TTS_ON}', provider: 'azure', region: 'fixture', subscriptionKey: '${KEY}', rate: '+10%' } },
    assistant: { enabled: true,
      defaults: { notify: { channel: 'silent' } }, home: { aliases: { lamp: 'light.fixture' }, restToken: '${HOME_KEY}' } },
    mcp: { enabled: true, path: '/mcp', token: '${KEY}' },
    a2a: { enabled: '${A2A_ON}', mailbox: { enabled: true, peers: [{ actor: 'coder', url: 'https://remote.example/a2a/mailbox', secret: '${KEY}' }] } },
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
    { mcp: { path: null, token: null }, a2a: { path: null, token: null, publicUrl: null, mailbox: null } },
  ])('retains explicit null where the existing consumer already falls back: %#', input => {
    expect(check(input)).toEqual(input);
  });

  it('does not relax previously strict Host fields or non-null collection members', () => {
    for (const input of [
      { ai: { agent: null } }, { ai: { venues: null } }, { http: { readiness: null } },
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
