import { describe, expect, it } from 'vitest';
import { containsChatOwnerClaimCode, isSecretLikeKey, matchChatOwnerClaimText, redactChatOwnerClaimText, registerChatOwnerClaimCode, redactDecisionPayload, redactSecretText } from '../src/index.js';

describe('redaction (moved from @zhin.js/agent, ADR 0061 P1)', () => {
  it('masks secret keys, omits prompts and hides token-shaped text', () => {
    expect(redactDecisionPayload({ apiKey: 'x', prompt: 'full prompt', note: 'Bearer abcdefghijklmnop' })).toEqual({
      apiKey: '[redacted]', prompt: '[omitted]', note: 'Bearer [redacted]',
    });
    expect(redactDecisionPayload(null)).toEqual({});
    expect(redactSecretText('token=sk-abcdefghijkl')).not.toContain('sk-abcdefghijkl');
    expect(isSecretLikeKey('openaiApiKey')).toBe(true);
    expect(isSecretLikeKey('name')).toBe(false);
  });
});

describe('chat-owner claim text (ADR 0060 §3.3, zhinjs/zhin#1250)', () => {
  it('matches the keyword first, whitespace, then exactly one token, with or without the prefix', () => {
    expect(matchChatOwnerClaimText('认领 ABCD2345')).toEqual({ keyword: '认领', code: 'ABCD2345' });
    expect(matchChatOwnerClaimText('  claim   abcd-2345 \n')).toEqual({ keyword: 'claim', code: 'abcd-2345' });
    expect(matchChatOwnerClaimText('CLAIM ABCD2345')).toEqual({ keyword: 'CLAIM', code: 'ABCD2345' });
    expect(matchChatOwnerClaimText('认领　ABCD2345')).toEqual({ keyword: '认领', code: 'ABCD2345' });
    expect(matchChatOwnerClaimText('#认领 ABCD2345', '#')).toEqual({ keyword: '认领', code: 'ABCD2345' });
    expect(matchChatOwnerClaimText('# 认领 ABCD2345', '#')).toEqual({ keyword: '认领', code: 'ABCD2345' });
    // The bare form works where a prefix is configured.
    expect(matchChatOwnerClaimText('认领 ABCD2345', '#')).toEqual({ keyword: '认领', code: 'ABCD2345' });
    // Another (or a mistyped) punctuation prefix, and brackets copied from the hint, are tolerated.
    expect(matchChatOwnerClaimText('/认领 ABCD2345', '#')).toEqual({ keyword: '认领', code: 'ABCD2345' });
    expect(matchChatOwnerClaimText('「认领 ABCD2345」')).toEqual({ keyword: '认领', code: 'ABCD2345' });
    expect(matchChatOwnerClaimText('认领 <ABCD2345>')).toEqual({ keyword: '认领', code: 'ABCD2345' });
    // A word prefix is stripped when it is the configured one.
    expect(matchChatOwnerClaimText('bot 认领 ABCD2345', 'bot')).toEqual({ keyword: '认领', code: 'ABCD2345' });
    // A wrong code has the same shape.
    expect(matchChatOwnerClaimText('认领 不对的码')).toEqual({ keyword: '认领', code: '不对的码' });
  });

  it('leaves ordinary chat that mentions the word alone', () => {
    for (const text of ['我想认领这个任务', '认领', '认领了', '认领了吗 ABCD2345', '谁来认领 这个', 'claim this task',
      'I want to claim ABCD2345', 'claimABCD2345', '认领 ABCD 2345', '请认领 ABCD2345', '']) {
      expect(matchChatOwnerClaimText(text), text).toBeUndefined();
      expect(matchChatOwnerClaimText(text, '#'), text).toBeUndefined();
    }
    expect(matchChatOwnerClaimText('bot 认领 ABCD2345')).toBeUndefined();
  });

  it('finds the current code however it is written', () => {
    for (const text of ['认领 ABCD2345', '认领:ABCD2345', '認領 ABCD2345', 'ｃｌａｉｍ ａｂｃｄ２３４５', '认领码ABCD2345',
      '认领 ABCD2345 谢谢', '认领 ABCD 2345', '认领 abcd-2345!!!!', '认领 AB\u200BCD2345', '@bot 认领 ABCD2345']) {
      expect(containsChatOwnerClaimCode(text, 'ABCD2345'), text).toBe(true);
    }
    for (const text of ['认领 ABCD2346', 'claim it', '我想认领这个任务', '']) expect(containsChatOwnerClaimCode(text, 'ABCD2345'), text).toBe(false);
  });

  it('redacts only a currently open code, and nothing without one', () => {
    expect(redactChatOwnerClaimText('认领 ABCD2345')).toBe('认领 ABCD2345');
    expect(redactChatOwnerClaimText('claim it')).toBe('claim it');
    const unregister = registerChatOwnerClaimCode('ABCD2345');
    try {
      expect(redactChatOwnerClaimText('认领 ABCD2345')).toBe('认领 ***');
      expect(redactChatOwnerClaimText('#claim abcd-2345!!!')).toBe('#claim ***!!!');
      expect(redactChatOwnerClaimText('hello\n认领 ABCD 2345\nbye')).toBe('hello\n认领 ***\nbye');
      expect(redactChatOwnerClaimText('ｃｌａｉｍ ＡＢＣＤ２３４５')).toBe('claim ***');
      // Ordinary chat, and a wrong code, are kept as written.
      for (const text of ['claim it', '认领 任务', '认领 ZZZZ9999']) expect(redactChatOwnerClaimText(text)).toBe(text);
    } finally { unregister(); }
    expect(redactChatOwnerClaimText('认领 ABCD2345')).toBe('认领 ABCD2345');
  });
});
