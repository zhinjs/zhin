import { describe, expect, it } from 'vitest';
import {
  DEFAULT_QQ_BOT_KIND,
  QQ_INTENTS_BY_KIND,
  defaultQqEndpointIntentFields,
  parseQqBotKind,
  resolveQqIntents,
} from '../src/qq-intents.js';
import { resolveQqConfig } from '../src/protocol.js';

const SHARED = [
  'GROUP_AND_C2C_EVENT',
  'GUILDS',
  'GUILD_MEMBERS',
  'DIRECT_MESSAGE',
] as const;

describe('parseQqBotKind', () => {
  it('仅接受 public|private', () => {
    expect(parseQqBotKind('public')).toBe('public');
    expect(parseQqBotKind('private')).toBe('private');
    expect(parseQqBotKind('group')).toBeUndefined();
    expect(parseQqBotKind('other')).toBeUndefined();
    expect(parseQqBotKind(undefined)).toBeUndefined();
  });
});

describe('resolveQqIntents', () => {
  it('显式 intents 优先', () => {
    expect(resolveQqIntents({ intents: ['INTERACTION'], botKind: 'private' })).toEqual([
      'INTERACTION',
    ]);
  });

  it('空 intents 按 botKind 展开', () => {
    expect(resolveQqIntents({ intents: [], botKind: 'private' })).toEqual([
      ...QQ_INTENTS_BY_KIND.private,
    ]);
  });

  it('未声明时默认 public，且含群聊 intent', () => {
    expect(resolveQqIntents({})).toEqual([...QQ_INTENTS_BY_KIND.public]);
    expect(DEFAULT_QQ_BOT_KIND).toBe('public');
    expect(QQ_INTENTS_BY_KIND.public).toEqual([...SHARED, 'PUBLIC_GUILD_MESSAGES']);
    expect(QQ_INTENTS_BY_KIND.private).toEqual([...SHARED, 'GUILD_MESSAGES']);
  });
});

describe('defaultQqEndpointIntentFields', () => {
  it('扫码绑定默认写入 public intents', () => {
    expect(defaultQqEndpointIntentFields()).toEqual({
      botKind: 'public',
      intents: [...SHARED, 'PUBLIC_GUILD_MESSAGES'],
    });
  });
});

describe('resolveQqConfig intents', () => {
  it('websocket 无 intents 时按默认 public 生成', () => {
    const resolved = resolveQqConfig({ appid: 'a', secret: 's' });
    expect(resolved.mode).toBe('websocket');
    if (resolved.mode === 'websocket') {
      expect(resolved.intents).toEqual([...SHARED, 'PUBLIC_GUILD_MESSAGES']);
    }
  });

  it('endpoint.botKind=private 时用 GUILD_MESSAGES', () => {
    const resolved = resolveQqConfig({
      endpoints: [
        {
          name: 'g',
          appid: 'a',
          secret: 's',
          botKind: 'private',
        },
      ],
    });
    if (resolved.mode === 'websocket') {
      expect(resolved.intents).toEqual([...SHARED, 'GUILD_MESSAGES']);
      expect(resolved.intents).toContain('GROUP_AND_C2C_EVENT');
    }
  });
});
