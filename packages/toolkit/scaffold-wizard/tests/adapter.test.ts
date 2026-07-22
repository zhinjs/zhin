import { afterEach, describe, expect, it, vi } from 'vitest';
import inquirer from 'inquirer';
import {
  buildFieldBasedInstanceConfig,
  collectAdapterPluginConfigs,
  collectAdapterPluginManifest,
  getAdapterDependencies,
  getAdapterSetupNotes,
  type AdapterDefinition,
  type AdapterSetupResult,
} from '../src/adapter.js';
import {
  configureMilkyBot,
  configureNapcatBot,
  configureOneBot12Bot,
  configureSatoriBot,
} from '../src/adapter-configurers.js';

/** 按 question name 应答的 inquirer.prompt mock */
function mockPrompt(answers: Record<string, unknown>) {
  return vi.spyOn(inquirer, 'prompt').mockImplementation(async (questions: any) => {
    const list = Array.isArray(questions) ? questions : [questions];
    const out: Record<string, unknown> = {};
    for (const q of list) out[q.name] = answers[q.name];
    return out as any;
  });
}

const configureCtx = () => ({ envVars: {} as Record<string, string>, markRequiresDatabase: () => {} });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('adapter setup notes', () => {
  it('returns telegram webhook guidance when webhook mode is configured', () => {
    const result: AdapterSetupResult = {
      packages: ['@zhin.js/adapter-telegram'],
      plugins: ['@zhin.js/adapter-telegram'],
      instances: [{
        package: '@zhin.js/adapter-telegram',
        instanceKey: 'telegram',
        config: {
          polling: false,
          webhook: { domain: 'https://bot.example.com', path: '/telegram/webhook' },
          endpoints: [{ name: 'tg', token: '${TELEGRAM_TOKEN}' }],
        },
      }],
      envVars: { TELEGRAM_TOKEN: 'secret' },
    };

    const notes = getAdapterSetupNotes(result);
    expect(notes.some(n => n.includes('HTTPS'))).toBe(true);
  });

  it('returns github app and webhook notes', () => {
    const result: AdapterSetupResult = {
      packages: ['@zhin.js/adapter-github'],
      plugins: ['@zhin.js/adapter-github'],
      instances: [{
        package: '@zhin.js/adapter-github',
        instanceKey: 'github',
        config: {
          webhook_path: '/github/webhook',
          endpoints: [{
            name: 'gh',
            app_id: '${GITHUB_APP_ID}',
            private_key: './data/github-app.pem',
            webhook_secret: '${GITHUB_WEBHOOK_SECRET}',
          }],
        },
      }],
      envVars: {},
      requiresDatabase: true,
    };

    const notes = getAdapterSetupNotes(result);
    expect(notes.some(n => n.includes('/github/webhook'))).toBe(true);
    expect(notes.some(n => n.includes('SQLite'))).toBe(true);
  });
});

describe('buildFieldBasedInstanceConfig', () => {
  const def = (value: string, fields: AdapterDefinition['fields']): AdapterDefinition => ({
    name: value,
    value,
    package: `@zhin.js/adapter-${value}`,
    plugin: `@zhin.js/adapter-${value}`,
    needsHttp: false,
    fields,
  });

  it('puts endpoint-level fields into endpoints[0] and defaults name', () => {
    const config = buildFieldBasedInstanceConfig(
      def('kook', [{ key: 'token', message: 'Token:' }]),
      { token: '${KOOK_TOKEN}' },
    );

    expect(config).toEqual({
      endpoints: [{ name: 'kook-bot', token: '${KOOK_TOKEN}' }],
    });
  });

  it('keeps shared fields at top level (lark webhookPath)', () => {
    const config = buildFieldBasedInstanceConfig(
      def('lark', [
        { key: 'appId', message: 'App ID:' },
        { key: 'appSecret', message: 'App Secret:' },
        { key: 'webhookPath', message: 'Webhook 路径:', scope: 'shared' },
      ]),
      { appId: '${LARK_APP_ID}', appSecret: '${LARK_APP_SECRET}', webhookPath: '/lark/webhook' },
    );

    expect(config).toEqual({
      webhookPath: '/lark/webhook',
      endpoints: [{ name: 'lark-bot', appId: '${LARK_APP_ID}', appSecret: '${LARK_APP_SECRET}' }],
    });
  });

  it('maps wechat-mp webhookPath to top-level path', () => {
    const config = buildFieldBasedInstanceConfig(
      def('wechat-mp', [
        { key: 'appId', message: 'App ID:' },
        { key: 'appSecret', message: 'App Secret:' },
        { key: 'token', message: 'Token:' },
        { key: 'webhookPath', message: 'Webhook 路径:', scope: 'shared' },
      ]),
      { appId: 'a', appSecret: 's', token: 't', webhookPath: '/wechat/webhook' },
    );

    expect(config).toEqual({
      path: '/wechat/webhook',
      endpoints: [{ name: 'wechat-mp-bot', appId: 'a', appSecret: 's', token: 't' }],
    });
  });

  it('keeps icqq master at top level and name in endpoints', () => {
    const config = buildFieldBasedInstanceConfig(
      def('icqq', [
        { key: 'name', message: 'QQ 号:' },
        { key: 'master', message: '主人 QQ 号:', scope: 'shared' },
      ]),
      { name: '${ICQQ_ACCOUNT}', master: '1659488338' },
    );

    expect(config).toEqual({
      master: '1659488338',
      endpoints: [{ name: '${ICQQ_ACCOUNT}' }],
    });
  });

  it('nests email smtp/imap under endpoints[0]', () => {
    const config = buildFieldBasedInstanceConfig(
      def('email', [
        { key: 'smtpHost', message: 'SMTP:' },
        { key: 'imapHost', message: 'IMAP:' },
      ]),
      {
        smtpHost: 'smtp.qq.com',
        smtpPort: '465',
        imapHost: 'imap.qq.com',
        imapPort: '993',
        user: '${EMAIL_USER}',
        password: '${EMAIL_PASSWORD}',
      },
    );

    expect(config).toEqual({
      endpoints: [{
        name: 'email-bot',
        smtp: {
          host: 'smtp.qq.com',
          port: 465,
          secure: true,
          auth: { user: '${EMAIL_USER}', pass: '${EMAIL_PASSWORD}' },
        },
        imap: {
          host: 'imap.qq.com',
          port: 993,
          tls: true,
          user: '${EMAIL_USER}',
          password: '${EMAIL_PASSWORD}',
        },
      }],
    });
  });
});

describe('collectAdapterPluginConfigs', () => {
  it('maps instances to plugins.<instanceKey> config blocks', () => {
    const plugins = collectAdapterPluginConfigs({
      packages: ['@zhin.js/adapter-sandbox'],
      plugins: ['@zhin.js/adapter-sandbox'],
      instances: [{
        package: '@zhin.js/adapter-sandbox',
        instanceKey: 'sandbox',
        config: { endpoints: [{ context: 'sandbox', name: 'sandbox-bot', owner: 'sandbox-user' }] },
      }],
      envVars: {},
    });

    expect(plugins).toEqual({
      sandbox: { endpoints: [{ context: 'sandbox', name: 'sandbox-bot', owner: 'sandbox-user' }] },
    });
  });
});

describe('collectAdapterPluginManifest', () => {
  it('maps instances to package.json zhin.plugins entries', () => {
    const manifest = collectAdapterPluginManifest({
      packages: [],
      plugins: [],
      instances: [
        { package: '@zhin.js/adapter-sandbox', instanceKey: 'sandbox', config: {} },
        { package: '@zhin.js/adapter-telegram', instanceKey: 'telegram', config: {} },
      ],
      envVars: {},
    });

    expect(manifest).toEqual([
      { package: '@zhin.js/adapter-sandbox', instanceKey: 'sandbox' },
      { package: '@zhin.js/adapter-telegram', instanceKey: 'telegram' },
    ]);
  });
});

describe('getAdapterDependencies', () => {
  it('uses latest for @zhin.js adapters in user projects', () => {
    const deps = getAdapterDependencies({
      packages: ['@zhin.js/adapter-sandbox', '@zhin.js/adapter-telegram', '@icqqjs/icqq@latest'],
      plugins: [],
      instances: [],
      envVars: {},
    });

    expect(deps['@zhin.js/adapter-sandbox']).toBe('latest');
    expect(deps['@zhin.js/adapter-telegram']).toBe('latest');
    expect(deps['@icqqjs/icqq']).toBe('latest');
  });
});

describe('field-based adapters (line / wecom / weixin-ilink)', () => {
  const def = (value: string, fields: AdapterDefinition['fields']): AdapterDefinition => ({
    name: value,
    value,
    package: `@zhin.js/adapter-${value}`,
    plugin: `@zhin.js/adapter-${value}`,
    needsHttp: false,
    fields,
  });

  it('line：凭据进 endpoints[0]，webhookPath 留顶层', () => {
    const config = buildFieldBasedInstanceConfig(
      def('line', [
        { key: 'channelSecret', message: '' },
        { key: 'channelAccessToken', message: '' },
        { key: 'webhookPath', message: '', scope: 'shared' },
      ]),
      {
        channelSecret: '${LINE_CHANNEL_SECRET}',
        channelAccessToken: '${LINE_CHANNEL_ACCESS_TOKEN}',
        webhookPath: '/line/webhook',
      },
    );

    expect(config).toEqual({
      webhookPath: '/line/webhook',
      endpoints: [{
        name: 'line-bot',
        channelSecret: '${LINE_CHANNEL_SECRET}',
        channelAccessToken: '${LINE_CHANNEL_ACCESS_TOKEN}',
      }],
    });
  });

  it('wecom：四个凭据进 endpoints[0]，webhookPath 留顶层', () => {
    const config = buildFieldBasedInstanceConfig(
      def('wecom', [
        { key: 'corpId', message: '' },
        { key: 'agentSecret', message: '' },
        { key: 'token', message: '' },
        { key: 'encodingAESKey', message: '' },
        { key: 'webhookPath', message: '', scope: 'shared' },
      ]),
      {
        corpId: '${WECOM_CORP_ID}',
        agentSecret: '${WECOM_AGENT_SECRET}',
        token: '${WECOM_TOKEN}',
        encodingAESKey: '${WECOM_AES_KEY}',
        webhookPath: '/wecom/callback',
      },
    );

    expect(config).toEqual({
      webhookPath: '/wecom/callback',
      endpoints: [{
        name: 'wecom-bot',
        corpId: '${WECOM_CORP_ID}',
        agentSecret: '${WECOM_AGENT_SECRET}',
        token: '${WECOM_TOKEN}',
        encodingAESKey: '${WECOM_AES_KEY}',
      }],
    });
  });

  it('weixin-ilink：botToken 进 endpoints[0]', () => {
    const config = buildFieldBasedInstanceConfig(
      def('weixin-ilink', [{ key: 'botToken', message: '' }]),
      { botToken: '${WEIXIN_ILINK_TOKEN}' },
    );

    expect(config).toEqual({
      endpoints: [{ name: 'weixin-ilink-bot', botToken: '${WEIXIN_ILINK_TOKEN}' }],
    });
  });
});

describe('connection-aware configurers (napcat / onebot12 / milky / satori)', () => {
  it('napcat ws：connection 顶层，url/access_token 进 endpoints[0]', async () => {
    mockPrompt({
      connection: 'ws',
      endpointName: 'napcat-bot',
      url: 'ws://127.0.0.1:3001',
      accessToken: 'tok',
    });
    const ctx = configureCtx();
    const config = await configureNapcatBot(ctx);

    expect(config).toEqual({
      connection: 'ws',
      endpoints: [{ name: 'napcat-bot', url: 'ws://127.0.0.1:3001', access_token: '${NAPCAT_TOKEN}' }],
    });
    expect(ctx.envVars.NAPCAT_TOKEN).toBe('tok');
  });

  it('napcat http：http_url/post_path 进 endpoints[0]', async () => {
    mockPrompt({
      connection: 'http',
      endpointName: 'napcat-bot',
      http_url: 'http://127.0.0.1:3000',
      post_path: '/napcat/post',
      accessToken: '',
    });
    const ctx = configureCtx();
    const config = await configureNapcatBot(ctx);

    expect(config).toEqual({
      connection: 'http',
      endpoints: [{ name: 'napcat-bot', http_url: 'http://127.0.0.1:3000', post_path: '/napcat/post' }],
    });
    expect(ctx.envVars.NAPCAT_TOKEN).toBeUndefined();
  });

  it('onebot12 webhook：path/api_url 进 endpoints[0]', async () => {
    mockPrompt({
      connection: 'webhook',
      endpointName: 'ob12-bot',
      path: '/onebot12/webhook',
      api_url: 'http://127.0.0.1:6700',
      accessToken: 'x',
    });
    const ctx = configureCtx();
    const config = await configureOneBot12Bot(ctx);

    expect(config).toEqual({
      connection: 'webhook',
      endpoints: [{
        name: 'ob12-bot',
        path: '/onebot12/webhook',
        api_url: 'http://127.0.0.1:6700',
        access_token: '${ONEBOT12_ACCESS_TOKEN}',
      }],
    });
    expect(ctx.envVars.ONEBOT12_ACCESS_TOKEN).toBe('x');
  });

  it('milky ws：baseUrl 进 endpoints[0]，无 path', async () => {
    mockPrompt({
      connection: 'ws',
      endpointName: 'milky-bot',
      baseUrl: 'http://127.0.0.1:8080',
      accessToken: 'm',
    });
    const ctx = configureCtx();
    const config = await configureMilkyBot(ctx);

    expect(config).toEqual({
      connection: 'ws',
      endpoints: [{ name: 'milky-bot', baseUrl: 'http://127.0.0.1:8080', access_token: '${MILKY_ACCESS_TOKEN}' }],
    });
    expect(ctx.envVars.MILKY_ACCESS_TOKEN).toBe('m');
  });

  it('satori webhook：baseUrl/path/token 进 endpoints[0]', async () => {
    mockPrompt({
      connection: 'webhook',
      endpointName: 'satori-bot',
      baseUrl: 'http://127.0.0.1:5140',
      path: '/satori/webhook',
      token: 't',
    });
    const ctx = configureCtx();
    const config = await configureSatoriBot(ctx);

    expect(config).toEqual({
      connection: 'webhook',
      endpoints: [{
        name: 'satori-bot',
        baseUrl: 'http://127.0.0.1:5140',
        path: '/satori/webhook',
        token: '${SATORI_TOKEN}',
      }],
    });
    expect(ctx.envVars.SATORI_TOKEN).toBe('t');
  });
});
