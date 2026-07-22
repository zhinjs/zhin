import { describe, expect, it } from 'vitest';
import {
  buildFieldBasedInstanceConfig,
  collectAdapterPluginConfigs,
  collectAdapterPluginManifest,
  getAdapterDependencies,
  getAdapterSetupNotes,
  type AdapterDefinition,
  type AdapterSetupResult,
} from '../src/adapter.js';

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
