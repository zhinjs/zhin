import { describe, expect, it } from 'vitest';
import { containsChatOwnerClaimCode, createChatOwnerClaimCodeScanner, isChatIdentityBindText, isSecretLikeKey, matchChatOwnerClaimText, redactChatIdentityBindText, redactChatOwnerClaimText, registerChatOwnerClaimCode, redactDecisionPayload, redactSecretText } from '../src/index.js';

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

  it('masks JSON, YAML-style, query-string and Telegram bot-path secrets (#1250 batch 26)', () => {
    expect(redactSecretText('{"token":"abc123secret","name":"x"}')).toBe('{"token":"[redacted]","name":"x"}');
    expect(redactSecretText('{"api_key": "k-9 9", "ok": true}')).toBe('{"api_key": "[redacted]", "ok": true}');
    expect(redactSecretText('api_key: abcdef123456, next')).toBe('api_key: [redacted], next');
    expect(redactSecretText("password: 'hunter2'")).toBe("password: '[redacted]'");
    expect(redactSecretText('GET https://maps.example.com/v1?q=a&key=AbCdEf123&lang=zh')).toBe('GET https://maps.example.com/v1?q=a&key=[redacted]&lang=zh');
    expect(redactSecretText('POST https://api.telegram.org/bot123456:AAH-abcdefghijklmnopqrstuvwxyz012/sendMessage failed'))
      .toBe('POST https://api.telegram.org/bot123456:[redacted]/sendMessage failed');
  });

  it('leaves numbers and ordinary prose alone', () => {
    expect(redactSecretText('max_tokens: 100, tokens: 32000')).toBe('max_tokens: 100, tokens: 32000');
    expect(redactSecretText('{"tokens": 4096}')).toBe('{"tokens": 4096}');
    expect(redactSecretText('the keyboard is fine; monkey=1')).toBe('the keyboard is fine; monkey=1');
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
      expect(redactChatOwnerClaimText('ｃｌａｉｍ ＡＢＣＤ２３４５')).toBe('ｃｌａｉｍ ***');
      // Ordinary chat, and a wrong code, are kept as written.
      for (const text of ['claim it', '认领 任务', '认领 ZZZZ9999']) expect(redactChatOwnerClaimText(text)).toBe(text);
    } finally { unregister(); }
    expect(redactChatOwnerClaimText('认领 ABCD2345')).toBe('认领 ABCD2345');
  });

  it('replaces only the hit when just the NFKC form shows the code (#1289 review)', () => {
    const unregister = registerChatOwnerClaimCode('QWERTY23');
    try {
      expect(redactChatOwnerClaimText('你好，世界！① ＱＷＥＲＴＹ２３')).toBe('你好，世界！① ***');
      expect(redactChatOwnerClaimText('你好，世界！① ＱＷ\u200BＥＲ\u2062ＴＹ２３！')).toBe('你好，世界！① ***！');
      // Two hits, one written in ASCII and one full-width; the characters between are kept.
      expect(redactChatOwnerClaimText('ａ qwerty23 ｂ ＱＷＥＲＴＹ２３ ｃ')).toBe('ａ *** ｂ *** ｃ');
      // Gap characters around a hit are kept; inside it they go with it.
      expect(redactChatOwnerClaimText('「\u200BＱＷＥ-ＲＴＹ２３\u200B」')).toBe('「\u200B***\u200B」');
      expect(redactChatOwnerClaimText('①②③ ＱＷＥＲＴＹ２４')).toBe('①②③ ＱＷＥＲＴＹ２４');
    } finally { unregister(); }
  });

  it('ignores format characters and combining marks inside a code (#1289 review)', () => {
    for (const gap of ['\u2061', '\u2062', '\u2063', '\u2064', '\u200E', '\u200F', '\u180E', '\u034F', '\uFE0F', '\u0301', '\u00AD', '\u2060', '\uFEFF']) {
      const text = `认领 AB${gap}CD${gap}2345`;
      expect(containsChatOwnerClaimCode(text, 'ABCD2345'), JSON.stringify(gap)).toBe(true);
      const unregister = registerChatOwnerClaimCode('ABCD2345');
      try { expect(redactChatOwnerClaimText(text), JSON.stringify(gap)).toBe('认领 ***'); } finally { unregister(); }
    }
    // Visible punctuation still separates symbols.
    expect(containsChatOwnerClaimCode('认领 ABCD.2345', 'ABCD2345')).toBe(false);
  });

  it('shares the open codes across copies of the module (#1289 review)', () => {
    // Another copy of @zhin.js/kernel registers through the same process-wide set.
    const shared = (globalThis as Record<symbol, Set<{ readonly code: string }> | undefined>)[Symbol.for('zhin.kernel.chat-owner-claim-codes')];
    expect(shared).toBeInstanceOf(Set);
    const entry = Object.freeze({ code: 'ZXCV7788' });
    shared!.add(entry);
    try {
      expect(redactChatOwnerClaimText('认领 ZXCV7788')).toBe('认领 ***');
    } finally { shared!.delete(entry); }
    expect(redactChatOwnerClaimText('认领 ZXCV7788')).toBe('认领 ZXCV7788');
    // And a code registered here is visible to the other copy.
    const unregister = registerChatOwnerClaimCode('ZXCV7788');
    try { expect([...shared!].some(item => item.code === 'ZXCV7788')).toBe(true); } finally { unregister(); }
    expect(shared!.size).toBe(0);
  });

  it('scans many strings as one text, without a size limit', () => {
    const scan = (code: string, parts: readonly string[]) => {
      const scanner = createChatOwnerClaimCodeScanner(code);
      return parts.map(part => scanner.feed(part)).includes(true);
    };
    expect(scan('ABCD2345', ['hello', 'claim ab', 'ｃｄ２3', '45'])).toBe(true);
    expect(scan('ABCD2345', ['x'.repeat(100_000), `认领 AB\u200BCD2345`])).toBe(true);
    expect(scan('ABCD2345', [...Array.from({ length: 5000 }, (_, index) => `item ${index}`), 'ABCD2345'])).toBe(true);
    expect(scan('ABCD2345', ['ABCD', '2346', 'claim it'])).toBe(false);
    expect(scan('ABCD2345', [])).toBe(false);
    // Once found, it stays found.
    const scanner = createChatOwnerClaimCodeScanner('ABCD2345');
    expect(scanner.feed('ABCD2345')).toBe(true);
    expect(scanner.feed('nothing')).toBe(true);
  });
});

describe('chat-identity bind text (ADR 0060 §2.4, #1250 sandbox-transcript-shared-bind-code)', () => {
  it('hides the code of a bind message by its shape alone, with or without a command prefix', () => {
    // Nothing registers bind codes: whether one is open (or expired) never decides.
    expect(redactChatIdentityBindText('绑定 ABCD2345')).toBe('绑定 ***');
    expect(redactChatIdentityBindText('  /绑定 ABCD2345 ')).toBe('/绑定 ***');
    expect(redactChatIdentityBindText('#bind abcd-2345')).toBe('#bind ***');
    expect(redactChatIdentityBindText('BIND <ABCD2345>')).toBe('BIND ***');
    expect(redactChatIdentityBindText('绑定码：ABCD 2345')).toBe('绑定码 ***');
    expect(redactChatIdentityBindText('綁定 ＡＢＣＤ２３４５')).toBe('綁定 ***');
    expect(redactChatIdentityBindText('绑定 AB\u200BCD2345')).toBe('绑定 ***');
    expect(redactChatIdentityBindText('zhin 绑定 ABCD2345', 'zhin')).toBe('zhin 绑定 ***');
    expect(isChatIdentityBindText('绑定 ZZZZ9999')).toBe(true);
    expect(redactChatIdentityBindText('bind zzzz-9999')).toBe('bind ***');
    expect(redactChatIdentityBindText('绑定 ABCDEFGH')).toBe('绑定 ***');
    expect(redactChatIdentityBindText('绑定 A\u0336BCD2345')).toBe('绑定 ***');
  });

  it('hides an argument with the shape of a code: it cannot be told from one (known trade-off, README)', () => {
    // All 8 symbols are in the alphabet (no 0 / 1 / O / I): a QQ number like this is hidden too.
    expect(redactChatIdentityBindText('绑定 23456789')).toBe('绑定 ***');
    expect(isChatIdentityBindText('#绑定 23456789')).toBe(true);
  });

  it('keeps names, several words and codes split into more than two parts (#1250 review)', () => {
    for (const text of ['bind username', 'BIND ME PLEASE', 'Bind Mysterys', 'bind a-b-c-d-e-f-g-h', '绑定 AB CD 2345', '绑定 ABCD EFGH',
      '绑定 ABCD--2345', '绑定 ABCD_2345', 'bind ABCD2345 now']) {
      expect(redactChatIdentityBindText(text)).toBe(text);
      expect(isChatIdentityBindText(text)).toBe(false);
    }
  });

  it('stays linear on long near-misses (no polynomial backtracking)', () => {
    const started = performance.now();
    for (const filler of [' ', '-', 'A', '!']) {
      const text = `绑定 A${filler.repeat(50_000)}B!`;
      expect(redactChatIdentityBindText(text)).toBe(text);
    }
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it('leaves other text as written', () => {
    for (const text of ['绑定 ***', '我想绑定 ABCD2345', '绑定 ABCD2345 谢谢', '绑定 12345678', '绑定 ABCD234', '认领 ABCD2345', 'binding ABCD2345', '']) {
      expect(redactChatIdentityBindText(text)).toBe(text);
      expect(isChatIdentityBindText(text)).toBe(false);
    }
  });
});
