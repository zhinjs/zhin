import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { SessionToldLedger } from '../../src/memory/told-ledger.js';
import { deliveredMessageContextRef, deliveredTextDigest } from '../../src/session/context-provenance.js';
import {
  answerResetSpelling,
  matchResetSpelling,
  resetHintText,
  sendFixedReply,
} from '../../src/plugin-runtime/ingress/reset-hint.js';

const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const privateChat = { endpoint: { adapter: 'root/sandbox', id: 'main' }, kind: 'private', id: 'user' } as const;
const groupChat = { endpoint: { adapter: 'root/sandbox', id: 'main' }, kind: 'group', id: 'g1' } as const;

function message(content: string, options: { group?: boolean; mentioned?: boolean; locale?: string; commandPrefix?: string } = {}) {
  return {
    content,
    conversation: options.group ? groupChat : privateChat,
    ...(options.mentioned !== undefined ? { mentioned: options.mentioned } : {}),
    locale: options.locale ?? 'zh-CN',
    commandPrefix: options.commandPrefix ?? '/',
  } as never;
}

/**
 * #1250 `own-unhandled-message-counts-as-background`: `/clear`-style spellings nobody handled get an
 * answer naming the actual reset ways, sent as a fixed reply this session records as its own delivery.
 */
describe('reset spelling hint (#1250)', () => {
  it('matches the common reset spellings in any case, with an ASCII or full-width slash', () => {
    for (const text of ['/clear', '/CLEAR', '／clear', '/Reset', '/new', ' /clear ', '／ｃｌｅａｒ']) {
      expect(matchResetSpelling(message(text))).toBe(`/${text.normalize('NFKC').trim().slice(1).trim().toLowerCase()}`);
    }
    for (const text of ['clear', '/clear all', '/clearance', '/help', 'please /clear', '/清空']) {
      expect(matchResetSpelling(message(text))).toBeUndefined();
    }
  });

  it('answers in a group only when the bot is mentioned', () => {
    expect(matchResetSpelling(message('/clear', { group: true }))).toBeUndefined();
    expect(matchResetSpelling(message('/clear', { group: true, mentioned: false }))).toBeUndefined();
    expect(matchResetSpelling(message('@bot /clear', { group: true, mentioned: true }))).toBe('/clear');
    expect(matchResetSpelling(message('[CQ:at,qq=1] /reset', { group: true, mentioned: true }))).toBe('/reset');
  });

  it('names the real clear command and, for operators, the reset command; localized', () => {
    const member = resetHintText({ spelling: '/clear', locale: 'zh-CN', isPrivate: true, isOperator: false, commandPrefix: '/' });
    expect(member).toContain('没有 /clear 这个指令');
    expect(member).toContain('清空');
    expect(member).not.toContain('/reset');
    const owner = resetHintText({ spelling: '/clear', locale: 'zh-CN', isPrivate: true, isOperator: true, commandPrefix: '/' });
    expect(owner).toContain('/reset');
    const english = resetHintText({ spelling: '/new', locale: 'en', isPrivate: false, isOperator: true, commandPrefix: '#' });
    expect(english).toContain('There is no /new command');
    expect(english).toContain('mention me');
    expect(english).toContain('#reset');
    // Without a known command environment the reset command is not named.
    expect(resetHintText({ spelling: '/clear', locale: 'en', isPrivate: true, isOperator: true })).not.toContain('reset to archive');
  });

  it('answers an untriggered reset spelling through the given reply and reports a suggestion', async () => {
    const send = vi.fn(async () => undefined);
    expect(await answerResetSpelling({ message: message('/clear'), triggered: false, isOperator: false, send })).toBe(true);
    expect(send).toHaveBeenCalledWith(expect.stringContaining('没有 /clear 这个指令'));
    // A triggered message (e.g. bare `clear` reaching the real clear command) is left alone.
    send.mockClear();
    expect(await answerResetSpelling({ message: message('/clear'), triggered: true, isOperator: false, send })).toBe(false);
    expect(await answerResetSpelling({ message: message('/weather'), triggered: false, isOperator: false, send })).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('records a fixed reply as delivered only with exact plain-text evidence', async () => {
    const ledger = new SessionToldLedger();
    const text = '没有 /clear 这个指令。';
    const ref = { conversation: privateChat, id: 'hint-1' };
    await sendFixedReply({ reply: async () => ({ status: 'sent', message: ref, outboundTextDigest: sha(text) }) as never,
      toldLedger: ledger, sessionKey: 'session-key', text });
    expect(ledger.hasDelivered('session-key', deliveredMessageContextRef(ref, deliveredTextDigest(text)))).toBe(true);
    // An outbound hook rewrote the text: the receipt digest differs, nothing is recorded.
    const rewritten = { conversation: privateChat, id: 'hint-2' };
    await sendFixedReply({ reply: async () => ({ status: 'sent', message: rewritten, outboundTextDigest: sha('rewritten') }) as never,
      toldLedger: ledger, sessionKey: 'session-key', text });
    expect(ledger.hasDelivered('session-key', deliveredMessageContextRef(rewritten, deliveredTextDigest(text)))).toBe(false);
    expect(ledger.hasDelivered('session-key', deliveredMessageContextRef(rewritten, deliveredTextDigest('rewritten')))).toBe(false);
    // A failed delivery records nothing either.
    const failed = { conversation: privateChat, id: 'hint-3' };
    await sendFixedReply({ reply: async () => ({ status: 'rejected', message: failed }) as never, toldLedger: ledger, sessionKey: 'session-key', text });
    expect(ledger.hasDelivered('session-key', deliveredMessageContextRef(failed, deliveredTextDigest(text)))).toBe(false);
  });
});
