import {
  CONFIG_SECRET_KEYWORD, HOST_CONFIG_SCHEMA, configurationValidator, findLiteralConfigSecrets, formatConfigSecretPath,
  formatLiteralConfigSecretWarning, isSecretConfigKey, isSecretConfigSchema, snapshotConfigSecretSchemas,
  type ConfigSchemaNode,
} from '../src/index.js';

const host = HOST_CONFIG_SCHEMA as ConfigSchemaNode;
const paths = (found: readonly { path: readonly string[] }[]) => found.map(item => item.path.join('.'));

describe('ADR 0057 secret predicate', () => {
  it('falls back to credential-like names, case-insensitively, without catching budgets', () => {
    for (const key of ['token', 'Token', 'password', 'secret', 'apiKey', 'API_KEY', 'privateKey', 'botToken', 'accessToken',
      'githubToken', 'appSecret', 'clientSecret', 'dbPassword', 'openaiApiKey', 'refreshTokens']) {
      expect(isSecretConfigKey(key), key).toBe(true);
    }
    for (const key of ['maxTokens', 'tokenLimit', 'tokenizer', 'name', 'host', 'masterVolume', 'url']) {
      expect(isSecretConfigKey(key), key).toBe(false);
    }
  });

  it('reads the x-zhin-secret annotation and the existing writeOnly / secret / password ones', () => {
    expect(isSecretConfigSchema({ type: 'string', [CONFIG_SECRET_KEYWORD]: true })).toBe(true);
    expect(isSecretConfigSchema({ type: 'string', writeOnly: true })).toBe(true);
    expect(isSecretConfigSchema({ type: 'string', 'x-zhin-config': { secret: true } })).toBe(true);
    expect(isSecretConfigSchema({ type: 'string', format: 'password' })).toBe(true);
    expect(isSecretConfigSchema({ type: 'string', [CONFIG_SECRET_KEYWORD]: false })).toBe(false);
    expect(isSecretConfigSchema({ type: 'string', 'x-zhin-config': { hidden: true } })).toBe(false);
  });

  it('annotates the known Host credentials with x-zhin-secret', () => {
    const at = (...path: string[]) => path.reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], host) as ConfigSchemaNode;
    for (const section of ['http', 'mcp', 'a2a']) expect(at('properties', section, 'properties', 'token')[CONFIG_SECRET_KEYWORD], section).toBe(true);
    expect(at('properties', 'database', 'properties', 'password')[CONFIG_SECRET_KEYWORD]).toBe(true);
    expect(at('properties', 'speech', 'properties', 'stt', 'properties', 'apiKey')[CONFIG_SECRET_KEYWORD]).toBe(true);
  });

  it('is accepted by the strict Ajv configuration validator as an annotation, not a rule', () => {
    const validate = configurationValidator().compile({
      type: 'object', properties: { key: { type: 'string', [CONFIG_SECRET_KEYWORD]: true } },
    });
    expect(validate({ key: 'anything' })).toBe(true);
    expect(() => configurationValidator().compile({ type: 'string', [CONFIG_SECRET_KEYWORD]: 'yes' })).toThrow();
  });
});

describe('findLiteralConfigSecrets', () => {
  const document = {
    configVersion: 2,
    plugins: { qq: '@zhin.js/adapter-qq', demo: 'demo-plugin' },
    http: { token: 'literal-bootstrap', port: 8086 },
    mcp: { token: '${MCP_TOKEN}' },
    a2a: { token: 'env://A2A_TOKEN' },
    database: { dialect: 'pg', password: 'hunter2-literal', host: 'db' },
    log_level: 1,
    plugin: { greeting: 'hi', webhookKey: 'root-literal' },
    qq: {
      endpoints: [{ name: 'main', appid: '1', appSecret: 'qq-literal' }, { name: 'env', appid: '2', appSecret: '${QQ_SECRET}' }],
      signing: 'qq-annotated-literal',
    },
    demo: { credentials: { user: 'u', pass: 'nested-literal' }, empty: { token: '' }, child: { botToken: 'child-literal' } },
  };
  const plugins: [string[], ConfigSchemaNode][] = [
    [['plugin'], { type: 'object', properties: { webhookKey: { type: 'string', [CONFIG_SECRET_KEYWORD]: true } } }],
    [['qq'], { type: 'object', properties: { signing: { type: 'string', [CONFIG_SECRET_KEYWORD]: true } } }],
  ];

  it('lists literal secret paths from Host annotations, Plugin annotations and the name fallback', () => {
    expect(paths(findLiteralConfigSecrets(document, { host, plugins })).sort()).toEqual([
      'database.password', 'demo.child.botToken', 'demo.credentials.pass', 'demo.credentials.user',
      'http.token', 'plugin.webhookKey', 'qq.endpoints.0.appSecret', 'qq.signing',
    ]);
  });

  it('never returns values, and skips references, empty strings and declaration keys', () => {
    const found = findLiteralConfigSecrets(document, { host, plugins });
    const serialized = JSON.stringify(found);
    for (const value of ['literal-bootstrap', 'hunter2-literal', 'qq-literal', 'nested-literal', 'child-literal']) {
      expect(serialized).not.toContain(value);
    }
    expect(paths(found)).not.toContain('mcp.token');
    expect(paths(found)).not.toContain('a2a.token');
    expect(paths(found)).not.toContain('demo.empty.token');
  });

  it('needs no schema for the name fallback', () => {
    expect(paths(findLiteralConfigSecrets({ http: { token: 'x' }, custom: { apiKey: 'y', label: 'z' } }))).toEqual(['http.token', 'custom.apiKey']);
  });

  it('formats one warning with paths and the doctor hint, without values', () => {
    const found = findLiteralConfigSecrets(document, { host, plugins });
    const warning = formatLiteralConfigSecretWarning(found, 'zhin.config.yml');
    expect(warning).toContain('http.token');
    expect(warning).toContain('qq.endpoints[0].appSecret');
    expect(warning).toContain('zhin doctor --fix');
    expect(warning).not.toContain('hunter2-literal');
    expect(formatConfigSecretPath(['a', 'b.c', '0'])).toBe('a["b.c"][0]');
  });

  it('maps a committed snapshot to Plugin config paths, Root as `plugin`', () => {
    const schema = { type: 'object' };
    const tree = new Map<string, unknown>([
      ['root', { id: 'root', instanceKey: 'root', children: ['root/qq'], configSchema: schema }],
      ['root/qq', { id: 'root/qq', instanceKey: 'qq', parent: 'root', children: ['root/qq/sub'], configSchema: schema }],
      ['root/qq/sub', { id: 'root/qq/sub', instanceKey: 'sub', parent: 'root/qq', children: [] }],
    ]);
    const entries = snapshotConfigSecretSchemas({ root: 'root', tree } as never);
    expect(entries.map(([path]) => path.join('.'))).toEqual(['plugin', 'qq', 'qq.sub']);
  });
});
