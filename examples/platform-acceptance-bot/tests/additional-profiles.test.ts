import { buildAdditionalProfile, additionalPlatforms } from '../additional-profiles.mjs';
import { resolveDiscordConfig } from '../../../plugins/adapters/discord/src/protocol.js';
import { resolveSlackConfig, slackInboundConversation } from '../../../plugins/adapters/slack/src/protocol.js';
import { resolveKookConfig } from '../../../plugins/adapters/kook/src/protocol.js';
import { resolveEmailConfig } from '../../../plugins/adapters/email/src/protocol.js';
import { resolveLarkConfig } from '../../../plugins/adapters/lark/src/protocol.js';
import { resolveDingTalkConfig } from '../../../plugins/adapters/dingtalk/src/protocol.js';

import { resolveLineConfig } from '../../../plugins/adapters/line/src/protocol.js';

const environment = {
  LINE_CHANNEL_SECRET: 'fixture-line-secret', LINE_CHANNEL_ACCESS_TOKEN: 'fixture-line-token',
  LARK_APP_ID: 'fixture-lark-app', LARK_APP_SECRET: 'fixture-lark-secret', LARK_VERIFY_TOKEN: 'fixture-verify',
  DINGTALK_APP_KEY: 'fixture-ding-app', DINGTALK_APP_SECRET: 'fixture-ding-secret',
  DISCORD_BOT_TOKEN: 'fixture-discord-secret', SLACK_BOT_TOKEN: 'xoxb-fixture-secret', SLACK_APP_TOKEN: 'xapp-fixture-secret', KOOK_BOT_TOKEN: 'fixture-kook-secret',
  EMAIL_SMTP_HOST: 'smtp.invalid', EMAIL_SMTP_USER: 'bot@example.invalid', EMAIL_SMTP_PASSWORD: 'fixture-smtp-secret',
  EMAIL_IMAP_HOST: 'imap.invalid', EMAIL_IMAP_USER: 'bot@example.invalid', EMAIL_IMAP_PASSWORD: 'fixture-imap-secret',
};
function expand(value: unknown): any {
  if (typeof value === 'string') return value.replace(/\$\{([^}]+)\}/g, (_, name) => environment[name as keyof typeof environment]);
  if (Array.isArray(value)) return value.map(expand);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, expand(item)]));
  return value;
}

it('produces profiles accepted by actual adapter config resolvers without embedding credentials', () => {
  const resolvers = { line: resolveLineConfig, discord: resolveDiscordConfig, slack: resolveSlackConfig, kook: resolveKookConfig, email: resolveEmailConfig, lark: resolveLarkConfig, dingtalk: resolveDingTalkConfig };
  for (const platform of additionalPlatforms) {
    const profile = buildAdditionalProfile(platform, environment);
    const serialized = JSON.stringify(profile);
    for (const value of Object.values(environment)) expect(serialized).not.toContain(value);
    const resolved = resolvers[platform as keyof typeof resolvers](expand(profile.instance.endpoints[0]));
    expect(resolved.id).toBe('test-bot');
    if (platform === 'slack') {
      expect('mode' in resolved && resolved.mode).toBe(profile.mode);
      expect(profile.defaultKind).toBe(slackInboundConversation('fixture', { channelId: 'C123', channelType: 'channel' }).kind);
    } else if ('connection' in resolved) expect(resolved.connection).toBe(profile.mode);
    else expect(profile.defaultKind).toBe('private');
  }
});

it('rejects missing credentials and malformed typed values with variable names only', () => {
  expect(() => buildAdditionalProfile('slack', { SLACK_BOT_TOKEN: 'secret-do-not-print' })).toThrow('SLACK_APP_TOKEN');
  for (const value of ['', '1e3', '12x', '1.5', '-1', '65536']) {
    expect(() => buildAdditionalProfile('email', { ...environment, EMAIL_SMTP_PORT: value })).toThrow('EMAIL_SMTP_PORT');
  }
  for (const value of ['', 'yes', '1', 'TRUE']) {
    expect(() => buildAdditionalProfile('email', { ...environment, EMAIL_IMAP_TLS: value })).toThrow('EMAIL_IMAP_TLS');
  }
  const profile = buildAdditionalProfile('email', { ...environment, EMAIL_SMTP_PORT: '587', EMAIL_SMTP_SECURE: 'false' });
  const resolved = resolveEmailConfig(expand(profile.instance.endpoints[0]));
  expect(resolved.smtp.port).toBe(587);
  expect(resolved.smtp.secure).toBe(false);
});


it('supports long connections without HTTP verification credentials and preserves explicit webhook profiles', () => {
  for (const [platform, mode] of [['lark', 'websocket'], ['dingtalk', 'stream']]) {
    const profile = buildAdditionalProfile(platform, { ...environment, LARK_VERIFY_TOKEN: undefined });
    expect(profile.mode).toBe(mode);
    expect(profile.instance.endpoints[0].mode).toBe(mode);
    expect(profile.instance.endpoints[0]).not.toHaveProperty('webhookPath');
    const webhook = buildAdditionalProfile(platform, { ...environment, [`${platform.toUpperCase()}_MODE`]: 'webhook' });
    expect(webhook.mode).toBe('webhook');
    expect(webhook.instance.endpoints[0].webhookPath).toMatch(/^\//);
  }
  expect(() => buildAdditionalProfile('lark', { ...environment, LARK_MODE: 'polling' })).toThrow('LARK_MODE');
  expect(() => buildAdditionalProfile('dingtalk', { ...environment, DINGTALK_MODE: 'socket' })).toThrow('DINGTALK_MODE');
});

it('maps optional DingTalk card template references and validates the fixed button count', () => {
  const plain = buildAdditionalProfile('dingtalk', environment).instance.endpoints[0];
  expect(plain).not.toHaveProperty('cardTemplateId'); expect(plain).not.toHaveProperty('cardButtonCount');
  for (const count of ['1', '2', '5']) {
    const endpoint = buildAdditionalProfile('dingtalk', { ...environment, DINGTALK_CARD_TEMPLATE_ID: 'fixture-template.schema', DINGTALK_CARD_BUTTON_COUNT: count }).instance.endpoints[0];
    expect(endpoint.cardTemplateId).toBe('${DINGTALK_CARD_TEMPLATE_ID}'); expect(JSON.stringify(endpoint)).not.toContain('fixture-template.schema');
    expect(endpoint.cardButtonCount).toBe(Number(count));
    expect(resolveDingTalkConfig({ ...expand(endpoint), cardTemplateId: 'fixture-template.schema' }).cardButtonCount).toBe(Number(count));
  }
  for (const count of ['', '0', '6', '1.5', 'two']) expect(() => buildAdditionalProfile('dingtalk', { ...environment, DINGTALK_CARD_BUTTON_COUNT: count })).toThrow('DINGTALK_CARD_BUTTON_COUNT');
  const defaulted = buildAdditionalProfile('dingtalk', { ...environment, DINGTALK_CARD_TEMPLATE_ID: 'fixture-template.schema' }).instance.endpoints[0];
  expect(resolveDingTalkConfig({ ...expand(defaulted), cardTemplateId: 'fixture-template.schema' }).cardButtonCount).toBe(2);
});

it('maps a dedicated Slack Web API port without changing Socket transport', () => {
  const profile = buildAdditionalProfile('slack', { ...environment, SLACK_WEB_API_PROXY_PORT: '18560' });
  expect(resolveSlackConfig(expand(profile.instance.endpoints[0]))).toMatchObject({ mode: 'socket', webApiProxy: { port: 18560 } });
  expect(profile.instance.endpoints[0].streamProxy).toBeUndefined();
  for (const port of ['0', '65536', '1.5', 'NaN']) expect(() => buildAdditionalProfile('slack', { ...environment, SLACK_WEB_API_PROXY_PORT: port })).toThrow('SLACK_WEB_API_PROXY_PORT');
});

it('maps Discord REST proxy independently of Gateway proxy', () => {
  const profile = buildAdditionalProfile('discord', { ...environment, DISCORD_REST_API_PROXY_PORT: '18570' });
  expect(resolveDiscordConfig(expand(profile.instance.endpoints[0]))).toMatchObject({ connection: 'gateway', restApiProxy: { port: 18570 } });
  expect(profile.instance.endpoints[0].gatewayFaultProxyUrl).toBeUndefined();
  for (const port of ['0', '65536', '1.5', 'NaN']) expect(() => buildAdditionalProfile('discord', { ...environment, DISCORD_REST_API_PROXY_PORT: port })).toThrow('DISCORD_REST_API_PROXY_PORT');
});
