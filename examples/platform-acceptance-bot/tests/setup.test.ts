import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, stringify } from 'yaml';
import { prepareProject } from '../run.mjs';

const home = fileURLToPath(new URL('..', import.meta.url));
const repo = path.resolve(home, '../..');
const environment = {
  NAPCAT_WS_URL: 'ws://127.0.0.1:3001', NAPCAT_ACCESS_TOKEN: 'fixture-bridge-secret', NAPCAT_BRIDGE_VERSION: 'fixture-version', NAPCAT_TEST_CHAT_ID: '100',
  ONEBOT11_WS_URL: 'ws://127.0.0.1:3001', ONEBOT11_BRIDGE_VERSION: 'fixture-version', ONEBOT11_TEST_CHAT_ID: '101',
  QQ_APP_ID: 'fixture-app', QQ_APP_SECRET: 'fixture-app-secret', QQ_TEST_CHAT_ID: '102',
  TELEGRAM_BOT_TOKEN: 'fixture-bot-secret', TELEGRAM_TEST_CHAT_ID: '103',
};
let temporary: string;
beforeEach(async () => {
  await mkdir(path.join(home, '.acceptance'), { recursive: true });
  temporary = await mkdtemp(path.join(home, '.acceptance/setup-test-'));
});
afterEach(async () => { await rm(temporary, { recursive: true, force: true }); });

it('generates isolated platform projects from environment variables without persisting credentials', async () => {
  const records = [];
  for (const platform of ['napcat', 'onebot11', 'qq', 'telegram']) {
    const record = await prepareProject(platform, environment, temporary);
    records.push(record);
    const source = await readFile(path.join(record.project, 'zhin.config.yml'), 'utf8');
    const config = parse(source);
    expect(Object.keys(config.plugins)).toEqual([platform]);
    expect(source).not.toContain('fixture-bot-secret');
    expect(source).not.toContain('fixture-app-secret');
    expect(source).not.toContain('fixture-bridge-secret');
    expect(record.policy.actions).toEqual(['reply-text']);
    expect(record.policy.targets).toHaveLength(1);
    expect(record.policy.targets[0].adapter).toBe(`root/${platform}`);
    expect(await readFile(path.join(record.project, 'commands/acceptance/index.ts'), 'utf8')).toBe(await readFile(path.join(home, 'commands/acceptance/index.ts'), 'utf8'));
  }
  expect(new Set(records.map(record => record.policy.eventsPath)).size).toBe(4);
  const discovery = await prepareProject('telegram', { ...environment, TELEGRAM_TEST_CHAT_ID: 'pending' }, temporary);
  expect(parse(await readFile(path.join(discovery.project, 'zhin.config.yml'), 'utf8')).log_level).toBe('debug');
  expect(discovery.policy.targets[0].id).toBe('pending');
  await expect(prepareProject('telegram', {}, temporary)).rejects.toThrow('TELEGRAM_TEST_CHAT_ID');
});

it('keeps Telegram fault proxy URLs as references and isolates account B', async () => {
  const prepared = await prepareProject('telegram', { ...environment, TELEGRAM_API_BASE_URL: 'http://127.0.0.1:18200', TELEGRAM_B_ENABLED: 'true', TELEGRAM_B_BOT_TOKEN: 'fixture-secondary-secret', TELEGRAM_B_TEST_CHAT_ID: '200', TELEGRAM_B_API_BASE_URL: 'http://127.0.0.1:18202' }, temporary);
  const source = await readFile(path.join(prepared.project, 'zhin.config.yml'), 'utf8');
  const endpoints = parse(source).plugins.telegram.endpoints;
  expect(endpoints[0].apiBaseUrl).toBe('${TELEGRAM_API_BASE_URL}');
  expect(endpoints[1].apiBaseUrl).toBe('${TELEGRAM_B_API_BASE_URL}');
  expect(source).not.toContain('fixture-secondary-secret');
  await expect(prepareProject('telegram', { ...environment, TELEGRAM_API_BASE_URL: 'file:///tmp/api' }, temporary)).rejects.toThrow('TELEGRAM_API_BASE_URL');
});

it('generates each advanced transport with its real adapter configuration and matching evidence mode', async () => {
  const cases = [
    { platform: 'napcat', mode: 'wss', fields: { NAPCAT_REVERSE_WS_PATH: '/napcat/reverse' }, expected: { connection: 'wss', path: '/napcat/reverse' } },
    { platform: 'onebot11', mode: 'wss', fields: { ONEBOT11_REVERSE_WS_PATH: '/onebot11/reverse' }, expected: { connection: 'wss', path: '/onebot11/reverse' } },
    { platform: 'napcat', mode: 'http', fields: { NAPCAT_HTTP_URL: 'http://127.0.0.1:3000', NAPCAT_POST_PATH: '/napcat/events' }, expected: { connection: 'http', http_url: '${NAPCAT_HTTP_URL}', post_path: '/napcat/events' } },
    { platform: 'qq', mode: 'webhook', fields: { QQ_WEBHOOK_PATH: '/qq/events' }, expected: { mode: 'webhook', webhookPath: '/qq/events' } },
    { platform: 'qq', mode: 'middleware', fields: { QQ_WEBHOOK_PATH: '/qq/events' }, expected: { mode: 'middleware', webhookPath: '/qq/events' } },
    { platform: 'telegram', mode: 'webhook', fields: { TELEGRAM_WEBHOOK_DOMAIN: 'https://fixture.invalid', TELEGRAM_WEBHOOK_PATH: '/telegram/events', TELEGRAM_WEBHOOK_SECRET: 'fixture-webhook-secret' }, expected: { polling: false, webhook: { domain: '${TELEGRAM_WEBHOOK_DOMAIN}', path: '/telegram/events', secretToken: '${TELEGRAM_WEBHOOK_SECRET}' } } },
  ];
  for (const item of cases) {
    const prepared = await prepareProject(item.platform, { ...environment, ...item.fields, [`${item.platform.toUpperCase()}_MODE`]: item.mode, ACCEPTANCE_HTTP_PORT: '18081' }, temporary);
    const source = await readFile(path.join(prepared.project, 'zhin.config.yml'), 'utf8');
    const config = parse(source);
    expect({ ...config.plugins[item.platform], ...config.plugins[item.platform].endpoints[0] }).toMatchObject(item.expected);
    expect(config.http).toMatchObject({ host: '127.0.0.1', port: 18081 });
    expect(prepared.policy.mode).toBe(item.mode);
    expect(source).not.toContain('fixture-webhook-secret');
    const manifest = JSON.parse(await readFile(path.join(prepared.project, 'package.json'), 'utf8'));
    expect(manifest.zhin.plugins).toEqual([{ package: `@zhin.js/adapter-${item.platform}`, instanceKey: item.platform }]);
  }
  await expect(prepareProject('onebot11', { ...environment, ONEBOT11_MODE: 'http' }, temporary)).rejects.toThrow('ONEBOT11_MODE');
  await expect(prepareProject('telegram', { ...environment, TELEGRAM_MODE: 'webhook', TELEGRAM_WEBHOOK_PATH: '/events', TELEGRAM_WEBHOOK_DOMAIN: 'http://localhost', TELEGRAM_WEBHOOK_SECRET: 'fixture' }, temporary)).rejects.toThrow('TELEGRAM_WEBHOOK_DOMAIN');
  await expect(prepareProject('napcat', { ...environment, NAPCAT_MODE: 'wss', NAPCAT_REVERSE_WS_PATH: '/reverse', ACCEPTANCE_HTTP_PORT: '0' }, temporary)).rejects.toThrow('ACCEPTANCE_HTTP_PORT');
});

it('honors an explicit HTTP port in QQ websocket mode while retaining ephemeral defaults', async () => {
  const explicit = await prepareProject('qq', { ...environment, ACCEPTANCE_HTTP_PORT: '18181' }, temporary);
  expect(parse(await readFile(path.join(explicit.project, 'zhin.config.yml'), 'utf8')).http.port).toBe(18181);
  const automatic = await prepareProject('qq', environment, temporary);
  expect(parse(await readFile(path.join(automatic.project, 'zhin.config.yml'), 'utf8')).http.port).toBe(0);
  await expect(prepareProject('qq', { ...environment, ACCEPTANCE_HTTP_PORT: '0' }, temporary)).rejects.toThrow('ACCEPTANCE_HTTP_PORT');
});

it('prepares the additional platforms with matching manifests, targets and transport labels', async () => {
  const profiles = [
    ['lark', 'websocket', 'private', { LARK_APP_ID: 'fixture-lark-app', LARK_APP_SECRET: 'fixture-lark-secret' }],
    ['dingtalk', 'stream', 'private', { DINGTALK_APP_KEY: 'fixture-ding-app', DINGTALK_APP_SECRET: 'fixture-ding-secret' }],
    ['line', 'webhook', 'private', { LINE_CHANNEL_SECRET: 'fixture-line-secret', LINE_CHANNEL_ACCESS_TOKEN: 'fixture-line-token' }],
    ['discord', 'gateway', 'channel', { DISCORD_BOT_TOKEN: 'fixture-discord-secret' }],
    ['slack', 'socket', 'group', { SLACK_BOT_TOKEN: 'fixture-slack-secret', SLACK_APP_TOKEN: 'fixture-app-secret' }],
    ['kook', 'websocket', 'channel', { KOOK_BOT_TOKEN: 'fixture-kook-secret' }],
    ['email', 'smtp-imap', 'private', { EMAIL_SMTP_HOST: 'smtp.fixture.invalid', EMAIL_SMTP_USER: 'fixture', EMAIL_SMTP_PASSWORD: 'fixture-mail-secret', EMAIL_IMAP_HOST: 'imap.fixture.invalid', EMAIL_IMAP_USER: 'fixture', EMAIL_IMAP_PASSWORD: 'fixture-mail-secret' }],
  ] as const;
  for (const [platform, mode, kind, fields] of profiles) {
    const prepared = await prepareProject(platform, { ...fields, [`${platform.toUpperCase()}_TEST_CHAT_ID`]: 'fixture-target' }, temporary);
    expect(prepared.policy.mode).toBe(mode);
    expect(prepared.policy.targets[0]).toMatchObject({ adapter: `root/${platform}`, endpoint: 'test-bot', kind });
    const source = await readFile(path.join(prepared.project, 'zhin.config.yml'), 'utf8');
    expect(source).not.toContain('fixture-mail-secret');
    expect(source).not.toContain('fixture-discord-secret');
    expect(parse(source).plugins[platform].commandPrefix).toBe(platform === 'slack' ? '!' : '/');
    const manifest = JSON.parse(await readFile(path.join(prepared.project, 'package.json'), 'utf8'));
    expect(manifest.zhin.plugins).toEqual([{ package: `@zhin.js/adapter-${platform}`, instanceKey: platform }]);
  }
});

it('isolates account B credentials, target and readiness and rejects listener collisions', async () => {
  const prepared = await prepareProject('telegram', { ...environment, TELEGRAM_B_BOT_TOKEN: 'fixture-b-secret', TELEGRAM_B_TEST_CHAT_ID: '104', TELEGRAM_B_TEST_CHAT_KIND: 'group' }, temporary);
  const source = await readFile(path.join(prepared.project, 'zhin.config.yml'), 'utf8');
  const config = parse(source);
  expect(config.plugins.telegram.endpoints[1]).toMatchObject({ id: 'test-bot-b', token: '${TELEGRAM_B_BOT_TOKEN}' });
  expect(prepared.policy.targets[1]).toMatchObject({ alias: 'telegram-b', endpoint: 'test-bot-b', kind: 'group', id: '104' });
  expect(config.http.readiness.endpoints).toHaveLength(2);
  expect(source).not.toContain('fixture-b-secret');
  await expect(prepareProject('qq', { ...environment, QQ_B_TEST_CHAT_ID: '104' }, temporary)).rejects.toThrow('QQ_B_APP_ID');
  await expect(prepareProject('napcat', { ...environment, NAPCAT_MODE: 'wss', NAPCAT_REVERSE_WS_PATH: '/reverse', NAPCAT_B_TEST_CHAT_ID: '104', NAPCAT_B_BRIDGE_VERSION: 'fixture', NAPCAT_B_REVERSE_WS_PATH: '/reverse' }, temporary)).rejects.toThrow('入站路径');
});

it('boots the generated Telegram project through the real CLI and stops with --once using a local fake API', async () => {
  const methods: string[] = [];
  const server = createServer((request, response) => {
    const method = request.url?.split('/').at(-1) ?? '';
    methods.push(method);
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ ok: true, result: method === 'getMe' ? { id: 1, is_bot: true, first_name: 'Fixture', username: 'fixture_bot' } : [] }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing fixture listener');
    const prepared = await prepareProject('telegram', environment, temporary);
    const configFile = path.join(prepared.project, 'zhin.config.yml');
    const config = parse(await readFile(configFile, 'utf8'));
    config.plugins.telegram.apiBaseUrl = `http://127.0.0.1:${address.port}`;
    await writeFile(configFile, stringify(config));
    const runtimeEnvironment = { ...process.env, ...environment, ZHIN_ACCEPTANCE_POLICY: prepared.policyPath };
    delete runtimeEnvironment.ZHIN_RUNTIME_CHILD;
    const child = spawn(process.execPath, [path.join(repo, 'basic/cli/bin/zhin.js'), 'runtime', 'start', '--once'], { cwd: prepared.project, env: runtimeEnvironment, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    const timer = setTimeout(() => child.kill('SIGTERM'), 15000);
    const code = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); }).finally(() => clearTimeout(timer));
    expect(code, output).toBe(0);
    expect(methods).toContain('getMe');
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}, 20000);

it('pending mode logs an incoming chat ID without replying to the unapproved conversation', async () => {
  const methods: string[] = [];
  let delivered = false;
  let child: ReturnType<typeof spawn> | undefined;
  const server = createServer((request, response) => {
    const method = request.url?.split('/').at(-1) ?? '';
    methods.push(method);
    let result: unknown = [];
    if (method === 'getMe') result = { id: 1, is_bot: true, first_name: 'Fixture', username: 'fixture_bot' };
    if (method === 'getUpdates' && !delivered) {
      delivered = true;
      result = [{ update_id: 1, message: { message_id: 1, date: 1, chat: { id: 123456789, type: 'private' }, from: { id: 123456789, is_bot: false, first_name: 'Fixture' }, text: '/start' } }];
    }
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ ok: true, result }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing fixture listener');
    const prepared = await prepareProject('telegram', { ...environment, TELEGRAM_TEST_CHAT_ID: 'pending' }, temporary);
    const configFile = path.join(prepared.project, 'zhin.config.yml');
    const config = parse(await readFile(configFile, 'utf8'));
    config.plugins.telegram.apiBaseUrl = `http://127.0.0.1:${address.port}`;
    await writeFile(configFile, stringify(config));
    const runtimeEnvironment: NodeJS.ProcessEnv = { ...process.env, ...environment, ZHIN_ACCEPTANCE_POLICY: prepared.policyPath };
    delete runtimeEnvironment.ZHIN_RUNTIME_CHILD;
    delete runtimeEnvironment.ZHIN_LOG_LEVEL;
    delete runtimeEnvironment.LOG_LEVEL;
    child = spawn(process.execPath, [path.join(repo, 'basic/cli/bin/zhin.js'), 'runtime', 'start'], { cwd: prepared.project, env: runtimeEnvironment, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`No chat ID log: ${output}`)), 10000);
      const read = (chunk: Buffer) => {
        output += chunk;
        if (output.includes('conv: private:123456789')) { clearTimeout(timer); resolve(); }
      };
      child!.stdout!.on('data', read);
      child!.stderr!.on('data', read);
      child!.once('error', error => { clearTimeout(timer); reject(error); });
      child!.once('exit', () => { clearTimeout(timer); reject(new Error(`Early runtime exit: ${output}`)); });
    });
    expect(methods).not.toContain('sendMessage');
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exiting = new Promise(resolve => child!.once('exit', resolve));
      child.kill('SIGTERM');
      await exiting;
    }
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}, 20000);
