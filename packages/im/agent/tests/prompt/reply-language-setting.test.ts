import { buildTurnContextEnvelope } from '../../src/context/turn-envelope.js';
import { buildExhaustedTurnInstruction } from '../../src/core/exhausted-turn-reply.js';
import { buildProgressSummaryInstruction } from '../../src/core/progress-reporter.js';
import {
  REPLY_LANGUAGE_RULE,
  USER_REPLY_LOCALE_METADATA_KEY,
  formatReplyLanguageLine,
  userSetReplyLocale,
} from '../../src/prompt/rules/reply-language.js';
import type { TurnRequest } from '../../src/turn/turn-ingress.js';

/** #1250 b69: a language chosen with `/language` steers AI replies, not only command text. */
function imTurn(senderId: string, input: TurnRequest['input']) {
  return {
    identity: { traceId: 'trace', turnId: 'turn' },
    origin: { kind: 'im', platform: 'qq', endpoint: 'bot', scope: 'group', sceneId: 'g1' } as const,
    principal: { subjectId: senderId, roles: ['user'] },
    input,
    session: { key: `qq:group:g1:${senderId}` },
    policy: { permissions: ['user'], unattended: false },
    signal: new AbortController().signal,
    ports: {},
  } satisfies TurnRequest;
}
const userSet = (locale: 'en' | 'zh-CN') => ({ [USER_REPLY_LOCALE_METADATA_KEY]: locale });

describe('reply language set with /language', () => {
  it('ranks the current message request, then /language, then the written language, then SOUL.md', () => {
    const explicit = REPLY_LANGUAGE_RULE.indexOf('explicit reply-language request first');
    const setting = REPLY_LANGUAGE_RULE.indexOf("the user's /language setting");
    const written = REPLY_LANGUAGE_RULE.indexOf('match their actual request');
    const fallback = REPLY_LANGUAGE_RULE.indexOf('use Reply language fallback');
    const soul = REPLY_LANGUAGE_RULE.indexOf('SOUL.md');
    expect([explicit, setting, written, fallback, soul].every(index => index >= 0)).toBe(true);
    expect(explicit).toBeLessThan(setting);
    expect(setting).toBeLessThan(written);
    expect(written).toBeLessThan(fallback);
    expect(fallback).toBeLessThan(soul);
    // The per-turn line carries the detail: only a request in the current message overrides the
    // setting (e.g. "用中文回答"), and a profile language is a reference, never a replacement.
    const line = formatReplyLanguageLine('en', true)!;
    expect(line).toContain('Use it even when they write in another language');
    expect(line).toContain('only an explicit language request in the current message overrides it');
    expect(line).toContain('a language in [User profile] is only a reference');
    // Static rule stays user-independent so the cached system prefix does not change per user.
    expect(REPLY_LANGUAGE_RULE).not.toMatch(/: (?:en|zh-CN)\./u);
  });

  it('tells the model to answer in en when the user set en and asks in Chinese', () => {
    const context = buildTurnContextEnvelope({ turn: imTurn('alice', {
      text: '今天天气怎么样？', locale: 'en', metadata: userSet('en'),
    }) })!;
    expect(context).toContain('Reply language (set by the user with /language): en.');
    expect(context).not.toContain('Reply language fallback:');
  });

  it('keeps the fallback line unchanged when the user never set a language', () => {
    for (const metadata of [undefined, {}, { [USER_REPLY_LOCALE_METADATA_KEY]: false }]) {
      const context = buildTurnContextEnvelope({ turn: imTurn('bob', { text: '今天天气怎么样？', locale: 'en', ...(metadata ? { metadata } : {}) }) })!;
      expect(context).toContain('Reply language fallback: en.');
      expect(context).not.toContain('set by the user with /language');
    }
  });

  it('counts the marker only when it matches the resolved locale', () => {
    expect(userSetReplyLocale({ locale: 'en', metadata: userSet('en') })).toBe('en');
    expect(userSetReplyLocale({ locale: 'zh-CN', metadata: userSet('en') })).toBeUndefined();
    expect(userSetReplyLocale({ locale: 'en', metadata: { [USER_REPLY_LOCALE_METADATA_KEY]: true } })).toBeUndefined();
    expect(userSetReplyLocale({ locale: 'fr', metadata: { [USER_REPLY_LOCALE_METADATA_KEY]: 'fr' } })).toBeUndefined();
    expect(formatReplyLanguageLine(undefined, true)).toBeUndefined();
  });

  it('keeps a conflicting [User profile] language as a reference next to the /language line', () => {
    const context = buildTurnContextEnvelope({
      turn: imTurn('alice', { text: '帮我查一下', locale: 'en', metadata: userSet('en') }),
      profileSummary: '[User profile]\n- language: 中文',
    })!;
    expect(context).toContain('Reply language (set by the user with /language): en.');
    expect(context).toContain('- language: 中文');
    expect(context).toContain('a language in [User profile] is only a reference');
  });

  it('keeps two group members independent', () => {
    const alice = buildTurnContextEnvelope({ turn: imTurn('alice', { text: 'hi', locale: 'en', metadata: userSet('en') }) })!;
    const bob = buildTurnContextEnvelope({ turn: imTurn('bob', { text: 'hi', locale: 'zh-CN', metadata: {} }) })!;
    const carol = buildTurnContextEnvelope({ turn: imTurn('carol', { text: 'hi', locale: 'zh-CN', metadata: userSet('zh-CN') }) })!;
    expect(alice).toContain('Reply language (set by the user with /language): en.');
    expect(bob).toContain('Reply language fallback: zh-CN.');
    expect(bob).not.toContain('/language');
    expect(carol).toContain('Reply language (set by the user with /language): zh-CN.');
  });

  it('uses the same wording for the progress and exhausted-turn instructions', () => {
    for (const instruction of [buildProgressSummaryInstruction('en', true), buildExhaustedTurnInstruction(3, 'en', true)]) {
      expect(instruction).toContain(REPLY_LANGUAGE_RULE);
      expect(instruction).toContain('Reply language (set by the user with /language): en.');
    }
    for (const instruction of [buildProgressSummaryInstruction('en'), buildExhaustedTurnInstruction(3, 'en')]) {
      expect(instruction).toContain('Reply language fallback: en.');
    }
  });
});
