import { describe, expect, it } from 'vitest';
import {
  TurnCapabilities,
  deriveLegacyProfile,
  defineAdapter,
  narrowCapabilities,
  normalizeCapabilityProfile,
  resolveTurnCapabilities,
  type AdapterCapabilityProfile,
} from '../src/index.js';

const conv = (kind: 'private' | 'group' | 'channel', extra: Record<string, unknown> = {}) => ({
  endpoint: { id: 'p', adapter: 'p' }, kind, id: 'c1', ...extra,
});

const profile: AdapterCapabilityProfile = {
  default: {
    messaging: { maxLength: 2000, quote: true, reaction: { emojis: ['👍', '❤️'] } },
    scene: { roles: { master: 'owner', manager: 'admin' } },
    actions: {
      poke: { scopes: ['private', 'group'] },
      reaction: { scopes: ['private', 'group'], params: { emojis: ['👍', '❤️'] } },
      mute: { scopes: ['group'], requiresRole: 'admin', params: { durationSeconds: { min: 60, max: 2592000 } } },
      kick: { scopes: ['group'], requiresRole: 'admin' },
      quoteReply: { scopes: ['private', 'group'] },
    },
    delivery: { send: true, proactive: true },
  },
  private: { messaging: { maxLength: 500 }, actions: { poke: { scopes: ['private'] } } },
  group: { messaging: { reaction: false } },
};

describe('profile validation', () => {
  it('rejects unknown sections, unknown fields and wrong types (fail closed)', () => {
    expect(() => normalizeCapabilityProfile({ defualt: {} } as never)).toThrow('unknown section');
    expect(() => normalizeCapabilityProfile({ default: { bogus: {} } } as never)).toThrow('bogus');
    expect(() => normalizeCapabilityProfile({ default: { messaging: { maxLength: '9' } } } as never)).toThrow('messaging.maxLength');
    expect(() => normalizeCapabilityProfile({ default: { actions: { mute: { requiresRole: 'admin' } } } } as never)).toThrow('scopes');
    expect(() => normalizeCapabilityProfile({ default: { actions: { mute: { scopes: ['group'], requiresRole: 'boss' } } } } as never)).toThrow('requiresRole');
    expect(() => normalizeCapabilityProfile({ default: { actions: { fly: { scopes: ['group'] } } } } as never)).toThrow('fly');
    expect(() => normalizeCapabilityProfile({ default: { actions: { mute: { scopes: ['group'], params: { durationSeconds: { min: 9, max: 1 } } } } } } as never)).toThrow('min must not exceed max');
    expect(() => normalizeCapabilityProfile({ default: { feedback: { mode: 'shout' } } } as never)).toThrow('feedback.mode');
    expect(() => normalizeCapabilityProfile({ kinds: { group: {} } } as never)).toThrow('new kind name');
  });

  it('defineAdapter validates at definition time and folds aliases', () => {
    const create = () => ({});
    expect(() => defineAdapter({ capabilities: ['outbound'], profile: { default: { nope: 1 } } as never, create }))
      .toThrow('nope');
    expect(() => defineAdapter({
      capabilities: ['outbound'],
      segments: { supported: ['text'] },
      profile: { default: { messaging: { segments: { supported: ['text'] } } } },
      create,
    })).toThrow('segments twice');
    const viaProfile = defineAdapter({
      capabilities: ['outbound'],
      profile: { default: { messaging: { segments: { supported: ['text'] } } } },
      create,
    });
    expect(viaProfile.segments).toEqual({ supported: ['text'] });
    const danmaku = defineAdapter({
      capabilities: ['inbound'], profile: { default: { events: { liveDanmaku: true } } }, create,
    });
    expect(danmaku.capabilities).toContain('liveDanmaku');
    const legacyDanmaku = defineAdapter({ capabilities: ['inbound', 'liveDanmaku'], profile: {}, create });
    expect(legacyDanmaku.profile?.default?.events?.liveDanmaku).toBe(true);
  });
});

describe('inheritance', () => {
  it('kind sections override default per field; false switches an inherited toggle off', () => {
    const priv = resolveTurnCapabilities({ profile, conversation: conv('private') });
    expect(priv.get('messaging.maxLength')).toBe(500);
    expect(priv.get('messaging.quote')).toBe(true);
    expect(priv.has('messaging.reaction')).toBe(true);
    expect(priv.get('actions.poke.scopes')).toEqual(['private']);
    const grp = resolveTurnCapabilities({ profile, conversation: conv('group'), facts: { bot: { platformRole: 'admin' } } });
    expect(grp.get('messaging.maxLength')).toBe(2000);
    expect(grp.has('messaging.reaction')).toBe(false);
  });

  it('drops actions whose scopes exclude the conversation kind, and applies thread and extra kinds', () => {
    const priv = resolveTurnCapabilities({ profile, conversation: conv('private') });
    expect(priv.has('actions.mute')).toBe(false);
    const rich: AdapterCapabilityProfile = {
      ...profile,
      thread: { messaging: { maxLength: 100 } },
      kinds: { forum: { messaging: { maxLength: 50 } } },
    };
    expect(resolveTurnCapabilities({ profile: rich, conversation: conv('channel', { threadId: 't' }) }).get('messaging.maxLength')).toBe(100);
    expect(resolveTurnCapabilities({ profile: rich, conversation: conv('channel'), extraKinds: ['forum'] }).get('messaging.maxLength')).toBe(50);
  });
});

describe('narrow-only resolution', () => {
  const base = () => resolveTurnCapabilities({
    profile, conversation: conv('group'), facts: { bot: { platformRole: 'manager' } },
  });

  it('applies the adapter patch when it narrows', () => {
    const caps = resolveTurnCapabilities({
      profile, conversation: conv('group'), facts: { bot: { platformRole: 'manager' } },
      narrow: () => ({
        actions: { kick: false, mute: { params: { durationSeconds: { max: 600 } } } },
        messaging: { maxLength: 100 },
      }),
    });
    expect(caps.has('actions.kick')).toBe(false);
    expect(caps.get('actions.mute.durationSeconds')).toEqual({ min: 60, max: 600 });
    expect(caps.get('messaging.maxLength')).toBe(100);
    expect(caps.narrowed).toContain('actions.kick.scopes');
    expect(caps.warnings).toEqual([]);
  });

  it('drops widening fields and records warnings', () => {
    const caps = resolveTurnCapabilities({
      profile, conversation: conv('private'),
      narrow: () => ({
        messaging: { maxLength: 9999, mention: { all: true } },
        actions: { mute: { scopes: ['group'] }, poke: { scopes: ['private', 'channel'] }, reaction: { params: { emojis: ['👍', '🔥'] } } },
        delivery: { requiresMessageSeq: true },
      }),
    });
    expect(caps.get('messaging.maxLength')).toBe(500);
    expect(caps.has('messaging.mention.all')).toBe(false);
    expect(caps.has('actions.mute')).toBe(false);
    expect(caps.get('actions.poke.scopes')).toEqual(['private']);
    expect(caps.get('actions.reaction.emojis')).toEqual(['👍', '❤️'].slice(0, 1));
    expect(caps.has('delivery.requiresMessageSeq')).toBe(false);
    expect(caps.warnings.length).toBeGreaterThanOrEqual(5);
  });

  it('a throwing resolver changes nothing', () => {
    const caps = resolveTurnCapabilities({
      profile, conversation: conv('group'), facts: { bot: { platformRole: 'manager' } },
      narrow: () => { throw new Error('boom'); },
    });
    expect(caps.key).toBe(base().key);
    expect(caps.warnings[0]).toContain('boom');
  });

  it('narrowCapabilities never mutates its input', () => {
    const section = base().resolved;
    const copy = JSON.stringify(section);
    narrowCapabilities(section, { actions: { mute: false } });
    expect(JSON.stringify(section)).toBe(copy);
  });
});

describe('built-in narrowing from trusted facts', () => {
  it('turns role-gated actions off unless the Bot role satisfies them (unknown fails closed)', () => {
    const at = (platformRole?: string) => resolveTurnCapabilities({
      profile, conversation: conv('group'), facts: platformRole ? { bot: { platformRole } } : { bot: { platformRoleError: 'x' } },
    });
    expect(at('member').has('actions.mute')).toBe(false);
    expect(at('member').has('actions.kick')).toBe(false);
    expect(at('member').has('actions.poke')).toBe(true);
    expect(at('manager').has('actions.mute')).toBe(true);
    expect(at('owner').has('actions.kick')).toBe(true);
    expect(at(undefined).has('actions.mute')).toBe(false);
  });

  it('turns sending off while the Bot is muted', () => {
    const facts = { bot: { platformRole: 'admin', mutedUntil: 2_000 } };
    const muted = resolveTurnCapabilities({ profile, conversation: conv('group'), facts, now: 1_000 });
    expect(muted.has('delivery.send')).toBe(false);
    expect(muted.has('delivery.proactive')).toBe(false);
    expect(muted.has('actions.quoteReply')).toBe(false);
    expect(muted.has('actions.poke')).toBe(true);
    const expired = resolveTurnCapabilities({ profile, conversation: conv('group'), facts, now: 3_000 });
    expect(expired.has('delivery.send')).toBe(true);
    const wholeGroup = (platformRole: string) => resolveTurnCapabilities({
      profile, conversation: conv('group'),
      facts: { bot: { platformRole }, conversation: { muteAll: true } },
    });
    expect(wholeGroup('member').has('delivery.send')).toBe(false);
    expect(wholeGroup('manager').has('delivery.send')).toBe(true);
  });

  it('shrinks the passive window to what the adapter reports and closes sending outside it', () => {
    const windowed: AdapterCapabilityProfile = {
      default: { delivery: { send: true, passiveWindow: { seconds: 300, maxMessages: 5 } } },
    };
    const open = resolveTurnCapabilities({
      profile: windowed, conversation: conv('private'),
      delivery: { passiveWindowRemainingSeconds: 120, passiveMessagesRemaining: 2 },
    });
    expect(open.get('delivery.passiveWindow')).toEqual({ seconds: 120, maxMessages: 2 });
    const closed = resolveTurnCapabilities({
      profile: windowed, conversation: conv('private'), delivery: { passiveWindowRemainingSeconds: 0 },
    });
    expect(closed.has('delivery.send')).toBe(false);
  });
});

describe('TurnCapabilities', () => {
  it('has/get read dotted paths with transparent action params', () => {
    const caps = resolveTurnCapabilities({ profile, conversation: conv('group'), facts: { bot: { platformRole: 'admin' } } });
    expect(caps).toBeInstanceOf(TurnCapabilities);
    expect(caps.has('actions.mute')).toBe(true);
    expect(caps.get('actions.mute.durationSeconds')).toEqual({ min: 60, max: 2592000 });
    expect(caps.has('actions.setCard')).toBe(false);
    expect(Object.isFrozen(caps)).toBe(true);
  });

  it('key is equal for equal capabilities regardless of conversation id', () => {
    const a = resolveTurnCapabilities({ profile, conversation: conv('group') });
    const b = resolveTurnCapabilities({ profile, conversation: { ...conv('group'), id: 'other' } });
    expect(a.key).toBe(b.key);
  });
});

describe('legacy derivation', () => {
  it('derives only what capabilities, operations and segments already say', () => {
    const derived = normalizeCapabilityProfile(deriveLegacyProfile({
      capabilities: ['inbound', 'outbound', 'liveDanmaku'],
      operations: ['recall', 'reaction', 'typing'],
      segments: { supported: ['text'], reaction: { values: [{ value: '76', label: '赞' }], scopes: ['group'] } },
    }));
    const caps = resolveTurnCapabilities({ profile: derived, conversation: conv('group') });
    expect(caps.has('delivery.send')).toBe(true);
    expect(caps.has('events.liveDanmaku')).toBe(true);
    expect(caps.get('feedback.mode')).toBe('typing');
    expect(caps.get('actions.reaction.emojis')).toEqual(['76']);
    expect(caps.has('actions.recall')).toBe(true);
    expect(caps.has('actions.mute')).toBe(false);
    expect(caps.has('delivery.proactive')).toBe(false);
    expect(resolveTurnCapabilities({ profile: derived, conversation: conv('private') }).has('actions.reaction')).toBe(false);
  });
});
