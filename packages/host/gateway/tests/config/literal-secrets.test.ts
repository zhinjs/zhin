import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseDotenv } from 'dotenv';
import { parse as parseYaml } from 'yaml';
import {
  findProjectLiteralSecrets, literalSecretEnvironmentName, moveLiteralSecretsToEnv,
} from '../../src/config/literal-secrets.js';

let root: string;
const configFile = () => join(root, 'zhin.config.yml');
const readConfig = async () => parseYaml(await readFile(configFile(), 'utf8')) as Record<string, any>;
const readEnv = async () => parseDotenv(await readFile(join(root, '.env'), 'utf8'));

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'zhin-literal-secrets-'));
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'literal-secrets-fixture', private: true }));
  await writeFile(configFile(), [
    'configVersion: 2',
    '# keep this comment',
    'plugins: {}',
    'http:',
    '  token: bootstrap-literal-value',
    '  port: 8086',
    'database:',
    '  dialect: pg',
    '  password: "pa ss#word"',
    'mcp:',
    '  token: ${MCP_TOKEN}',
    'custom:',
    '  endpoints:',
    '    - appSecret: endpoint-literal',
    '',
  ].join('\n'));
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('ADR 0057 zhin doctor literal secrets', () => {
  it('names variables after the path in upper snake case', () => {
    expect(literalSecretEnvironmentName(['http', 'token'])).toBe('ZHIN_HTTP_TOKEN');
    expect(literalSecretEnvironmentName(['qq', 'endpoints', '0', 'appSecret'])).toBe('ZHIN_QQ_ENDPOINTS_0_APP_SECRET');
  });

  it('reports literal secret paths only', async () => {
    const found = await findProjectLiteralSecrets(root, await readConfig());
    expect(found.map(item => item.path.join('.')).sort()).toEqual(['custom.endpoints.0.appSecret', 'database.password', 'http.token']);
    expect(JSON.stringify(found)).not.toContain('literal-value');
  });

  it('--fix moves literals into .env (0600), replaces them with ${…} and is idempotent', async () => {
    const result = await moveLiteralSecretsToEnv(root, configFile());
    expect(result.skipped).toEqual([]);
    expect(result.moved.map(item => item.variable).sort()).toEqual(['ZHIN_CUSTOM_ENDPOINTS_0_APP_SECRET', 'ZHIN_DATABASE_PASSWORD', 'ZHIN_HTTP_TOKEN']);
    const config = await readConfig();
    expect(config.http.token).toBe('${ZHIN_HTTP_TOKEN}');
    expect(config.database.password).toBe('${ZHIN_DATABASE_PASSWORD}');
    expect(config.custom.endpoints[0].appSecret).toBe('${ZHIN_CUSTOM_ENDPOINTS_0_APP_SECRET}');
    expect(config.mcp.token).toBe('${MCP_TOKEN}');
    expect(await readFile(configFile(), 'utf8')).toContain('# keep this comment');
    expect(await readEnv()).toEqual({
      ZHIN_HTTP_TOKEN: 'bootstrap-literal-value',
      ZHIN_DATABASE_PASSWORD: 'pa ss#word',
      ZHIN_CUSTOM_ENDPOINTS_0_APP_SECRET: 'endpoint-literal',
    });
    if (process.platform !== 'win32') expect((await stat(join(root, '.env'))).mode & 0o777).toBe(0o600);

    const envBefore = await readFile(join(root, '.env'), 'utf8');
    const configBefore = await readFile(configFile(), 'utf8');
    const second = await moveLiteralSecretsToEnv(root, configFile());
    expect(second.moved).toEqual([]);
    expect(await readFile(join(root, '.env'), 'utf8')).toBe(envBefore);
    expect(await readFile(configFile(), 'utf8')).toBe(configBefore);
    expect(await findProjectLiteralSecrets(root, await readConfig())).toEqual([]);
  });

  it('reuses a variable holding the same value and suffixes a name taken by another value', async () => {
    await writeFile(join(root, '.env'), 'ZHIN_HTTP_TOKEN=bootstrap-literal-value\nZHIN_DATABASE_PASSWORD=other\nKEEP=1\n', { mode: 0o640 });
    const result = await moveLiteralSecretsToEnv(root, configFile());
    const byPath = Object.fromEntries(result.moved.map(item => [item.path.join('.'), item]));
    expect(byPath['http.token']).toMatchObject({ variable: 'ZHIN_HTTP_TOKEN', reused: true });
    expect(byPath['database.password']).toMatchObject({ variable: 'ZHIN_DATABASE_PASSWORD_2', reused: false });
    const env = await readEnv();
    expect(env).toMatchObject({ ZHIN_HTTP_TOKEN: 'bootstrap-literal-value', ZHIN_DATABASE_PASSWORD: 'other', ZHIN_DATABASE_PASSWORD_2: 'pa ss#word', KEEP: '1' });
    expect((await readConfig()).database.password).toBe('${ZHIN_DATABASE_PASSWORD_2}');
    if (process.platform !== 'win32') expect((await stat(join(root, '.env'))).mode & 0o777).toBe(0o640);
  });

  it('treats a name defined with another value in .env.<environment> as taken', async () => {
    await writeFile(join(root, '.env.production'), 'ZHIN_HTTP_TOKEN=production-value\n');
    const result = await moveLiteralSecretsToEnv(root, configFile());
    expect(result.moved.find(item => item.path.join('.') === 'http.token')?.variable).toBe('ZHIN_HTTP_TOKEN_2');
  });

  it('skips values that cannot be written to .env safely and leaves them in place', async () => {
    await writeFile(configFile(), 'configVersion: 2\nplugins: {}\nhttp:\n  token: "line1\\nline2"\n');
    const result = await moveLiteralSecretsToEnv(root, configFile());
    expect(result.moved).toEqual([]);
    expect(result.skipped.map(item => item.path.join('.'))).toEqual(['http.token']);
    expect((await readConfig()).http.token).toBe('line1\nline2');
  });
});
