import { describe, expect, it, vi } from 'vitest';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import {
  assertDeclaredProfileActions,
  defineAdapter,
  resolveTurnCapabilities,
  type AdapterDefinition,
} from 'zhin.js/adapter';
import type { OutboundMessageService } from '@zhin.js/core/runtime';
import type { HttpHost } from '@zhin.js/host-http';
import { bindTestEndpoint } from '../test-utils/endpoint.js';

import bilibili from '../bilibili/adapters/bilibili/index.js';
import bilibiliLive from '../bilibili-live/adapters/bilibili-live/index.js';
import dingtalk from '../dingtalk/adapters/dingtalk/index.js';
import discord from '../discord/adapters/discord/index.js';
import email from '../email/adapters/email/index.js';
import github from '../github/adapters/github/index.js';
import kook from '../kook/adapters/kook/index.js';
import lark from '../lark/adapters/lark/index.js';
import line from '../line/adapters/line/index.js';
import milky, { MilkySseEndpoint, MilkyWebhookEndpoint, MilkyWsEndpoint, MilkyWssEndpoint } from '../milky/adapters/milky/index.js';
import napcat, { NapCatHttpEndpoint, NapCatWsEndpoint, NapCatWssEndpoint } from '../napcat/adapters/napcat/index.js';
import onebot11, { OneBot11WsEndpoint, OneBot11WssEndpoint } from '../onebot11/adapters/onebot11/index.js';
import onebot12, { OneBot12WebhookEndpoint, OneBot12WsEndpoint, OneBot12WssEndpoint } from '../onebot12/adapters/onebot12/index.js';
import qq, { QqWebsocketEndpoint } from '../qq/adapters/qq/index.js';
import sandbox from '../sandbox/adapters/sandbox/index.js';
import satori from '../satori/adapters/satori/index.js';
import slack from '../slack/adapters/slack/index.js';
import telegram from '../telegram/adapters/telegram/index.js';
import wechatMp from '../wechat-mp/adapters/wechat-mp/index.js';
import wecom from '../wecom/adapters/wecom/index.js';
import weixinIlink from '../weixin-ilink/adapters/weixin-ilink/index.js';
import icqq from '../icqq/adapters/icqq/index.js';

import { resolveMilkyConfig } from '../milky/src/protocol.js';
import { resolveNapCatConfig } from '../napcat/src/protocol.js';
import { resolveOneBot11Config } from '../onebot11/src/protocol.js';
import { resolveOneBot12Config } from '../onebot12/src/protocol.js';
import { resolveQqConfig } from '../qq/src/protocol.js';

const definitions: Record<string, AdapterDefinition<never>> = {
  icqq, qq, napcat, onebot11, onebot12, milky, kook, discord, telegram, slack, lark, satori, wecom,
  'weixin-ilink': weixinIlink, 'wechat-mp': wechatMp, line, dingtalk, email, github, bilibili,
  'bilibili-live': bilibiliLive, sandbox,
} as never;

const conv = (adapter: string, kind: 'private' | 'group' | 'channel') =>
  ({ endpoint: { id: adapter, adapter }, kind, id: '1' }) as const;

describe('adapter capability profiles (ADR 0044 C5)', () => {
  it.each(Object.entries(definitions))('%s declares a profile that validates and can send', (name, definition) => {
    expect(definition.profile, name).toBeDefined();
    // Re-defining proves the stored profile still passes validation (segments live in the profile alias).
    expect(() => defineAdapter({ ...definition, segments: undefined, create: () => ({ send: async () => 'id' }) as never })).not.toThrow();
    const caps = resolveTurnCapabilities({ profile: definition.profile!, conversation: conv(name, 'group') });
    expect(caps.has('delivery.send'), name).toBe(true);
    expect(definition.segments, name).toBeDefined();
  });

  it('undeclared means unsupported: platforms without management ports declare no moderation', () => {
    for (const name of ['kook', 'discord', 'telegram', 'slack', 'lark', 'qq', 'satori', 'wecom', 'email']) {
      const caps = resolveTurnCapabilities({
        profile: definitions[name]!.profile!,
        conversation: conv(name, 'group'),
        facts: { bot: { platformRole: 'owner' } },
      });
      for (const action of ['mute', 'kick', 'setCard', 'setTitle', 'essence', 'invite', 'poke']) {
        expect(caps.has(`actions.${action}`), `${name}.${action}`).toBe(false);
      }
    }
  });

  it('napcat declares announce for admins only', () => {
    const at = (platformRole: string) => resolveTurnCapabilities({
      profile: napcat.profile!, conversation: conv('napcat', 'group'), facts: { bot: { platformRole } },
    });
    expect(at('admin').has('actions.announce')).toBe(true);
    expect(at('member').has('actions.announce')).toBe(false);
  });

  it('qq official declares its passive reply window per conversation kind', () => {
    const window = (kind: 'private' | 'group' | 'channel') => resolveTurnCapabilities({
      profile: qq.profile!, conversation: conv('qq', kind),
    }).get('delivery.passiveWindow');
    expect(window('group')).toEqual({ seconds: 300, maxMessages: 5 });
    expect(window('private')).toEqual({ seconds: 3600, maxMessages: 4 });
    expect(window('channel')).toEqual({ seconds: 300, maxMessages: 5 });
    const closed = resolveTurnCapabilities({
      profile: qq.profile!, conversation: conv('qq', 'group'), delivery: { passiveWindowRemainingSeconds: 0 },
    });
    expect(closed.has('delivery.send')).toBe(false);
  });

  it('slack and weixin-ilink keep what their legacy declarations said', () => {
    const slackCaps = resolveTurnCapabilities({ profile: slack.profile!, conversation: conv('slack', 'channel') });
    expect(slackCaps.has('actions.reaction')).toBe(true);
    expect(slackCaps.get('messaging.edit')).toBe(true);
    const weixin = resolveTurnCapabilities({ profile: weixinIlink.profile!, conversation: conv('weixin-ilink', 'private') });
    expect(weixin.get('feedback.mode')).toBe('typing');
  });

  it('bilibili-live keeps liveDanmaku', () => {
    expect(bilibiliLive.capabilities).toContain('liveDanmaku');
    expect(resolveTurnCapabilities({ profile: bilibiliLive.profile!, conversation: conv('bilibili-live', 'group') })
      .get('events.liveDanmaku')).toBe(true);
  });
});

describe('declared actions find their ports on real endpoints (assembly check)', () => {
  const gateway: OutboundMessageService = { receive: vi.fn(), send: vi.fn(async () => 'sent') };
  const httpStub = { ws: vi.fn(), route: vi.fn() } as unknown as HttpHost;
  const id = capabilityId(rootPluginId(), featureId('zhin.adapter'), 'x');
  const check = (definition: AdapterDefinition<never>, endpoints: unknown[]) => {
    for (const endpoint of endpoints) {
      expect(() => assertDeclaredProfileActions(endpoint, definition.profile!, 'x', true)).not.toThrow();
    }
  };

  it('napcat (ws, wss, http)', () => {
    check(napcat, [
      new NapCatWsEndpoint({ id, gateway, config: resolveNapCatConfig({ connection: 'ws', id: 't', url: 'ws://127.0.0.1:3001' }) as never }),
      new NapCatWssEndpoint({ id, gateway, http: httpStub, config: resolveNapCatConfig({ connection: 'wss', id: 't', path: '/napcat' }) as never }),
      new NapCatHttpEndpoint({ id, gateway, http: httpStub, config: resolveNapCatConfig({ connection: 'http', id: 't', http_url: 'http://127.0.0.1:3000', post_path: '/napcat/post' }) as never }),
    ].map((endpoint) => bindTestEndpoint(endpoint, gateway, undefined)));
  });

  it('onebot11 (ws, wss)', () => {
    check(onebot11, [
      new OneBot11WsEndpoint({ id, gateway, config: resolveOneBot11Config({ connection: 'ws', id: 't', url: 'ws://127.0.0.1:6700' }) as never }),
      new OneBot11WssEndpoint({ id, gateway, http: httpStub, config: resolveOneBot11Config({ connection: 'wss', id: 't', path: '/onebot11' }) as never }),
    ].map((endpoint) => bindTestEndpoint(endpoint, gateway, undefined)));
  });

  it('onebot12 (ws, wss, webhook)', () => {
    check(onebot12, [
      new OneBot12WsEndpoint({ id, gateway, config: resolveOneBot12Config({ connection: 'ws', id: 't', url: 'ws://127.0.0.1:6700' }) as never }),
      new OneBot12WssEndpoint({ id, gateway, http: httpStub, config: resolveOneBot12Config({ connection: 'wss', id: 't', path: '/onebot12' }) as never }),
      new OneBot12WebhookEndpoint({ id, gateway, http: httpStub, config: resolveOneBot12Config({ connection: 'webhook', id: 't', path: '/onebot12/webhook', api_url: 'http://127.0.0.1:5701' }) as never }),
    ].map((endpoint) => bindTestEndpoint(endpoint, gateway, undefined)));
  });

  it('milky (ws, wss, sse, webhook)', () => {
    const base = { id: 't', baseUrl: 'http://127.0.0.1:3000' };
    check(milky, [
      new MilkyWsEndpoint({ id, gateway, config: resolveMilkyConfig({ ...base, connection: 'ws' }) as never }),
      new MilkyWssEndpoint({ id, gateway, http: httpStub, config: resolveMilkyConfig({ ...base, connection: 'wss', path: '/milky' }) as never }),
      new MilkySseEndpoint({ id, gateway, config: resolveMilkyConfig({ ...base, connection: 'sse' }) as never }),
      new MilkyWebhookEndpoint({ id, gateway, http: httpStub, config: resolveMilkyConfig({ ...base, connection: 'webhook', path: '/milky/webhook' }) as never }),
    ].map((endpoint) => bindTestEndpoint(endpoint, gateway, undefined)));
  });

  it('qq official (websocket)', () => {
    const config = resolveQqConfig({ id: 'qq-t', appid: 'a', secret: 's', mode: 'websocket' }) as never;
    check(qq, [bindTestEndpoint(new QqWebsocketEndpoint({ id, config, createBot: (() => ({})) as never }), gateway, undefined)]);
  });
});
