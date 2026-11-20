import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { SessionToldLedger, sessionKeyLedgerId } from '../../src/memory/told-ledger.js';
import { deliveredMessageContextRef, deliveredTextDigest } from '../../src/session/context-provenance.js';
import {
  answerResetSpelling,
  matchResetSpelling,
  ResetHintCooldown,
  resetHintAllowed,
  resetHintText,
  sendFixedReply,
} from '../../src/plugin-runtime/ingress/reset-hint.js';

const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const privateChat = { endpoint: { adapter: 'root/sandbox', id: 'main' }, kind: 'private', id: 'user' } as const;
const groupChat = { endpoint: { adapter: 'root/sandbox', id: 'main' }, kind: 'group', id: 'g1' } as const;

function message(content: string, options: { group?: boolean; mentioned?: boolean; locale?: string; commandPrefix?: string; sender?: string } = {}) {
  return {
    content,
    conversation: options.group ? groupChat : privateChat,
    sender: { id: options.sender ?? 'user' },
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

  it('answers a reset spelling through the given reply and reports a suggestion', async () => {
    const send = vi.fn(async () => undefined);
    const base = { policy: {}, cooldown: new ResetHintCooldown(), isOperator: false, send };
    expect(await answerResetSpelling({ ...base, message: message('/clear'), cooldownKey: 'a' })).toBe(true);
    expect(send).toHaveBeenCalledWith(expect.stringContaining('没有 /clear 这个指令'));
    send.mockClear();
    expect(await answerResetSpelling({ ...base, message: message('/weather'), cooldownKey: 'b' })).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('answers once per conversation and sender within the cooldown, then falls through silently', async () => {
    let now = 1_000;
    const cooldown = new ResetHintCooldown(60_000, () => now);
    const send = vi.fn(async () => undefined);
    const ask = (key: string) => answerResetSpelling({ message: message('/clear'), policy: {}, cooldown, cooldownKey: key, isOperator: false, send });
    expect(await ask('conv\u0000user')).toBe(true);
    expect(await ask('conv\u0000user')).toBe(false);
    // Another sender (or conversation) has its own window.
    expect(await ask('conv\u0000other')).toBe(true);
    now += 59_999;
    expect(await ask('conv\u0000user')).toBe(false);
    now += 1;
    expect(await ask('conv\u0000user')).toBe(true);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('stays silent where the AI would not answer: trigger off, private or mentions disabled, access closed or not listed, outbound stopped', async () => {
    const send = vi.fn(async () => undefined);
    const ask = (msg: never, policy: Parameters<typeof resetHintAllowed>[1], outboundBlocked?: () => boolean) =>
      answerResetSpelling({ message: msg, policy, cooldown: new ResetHintCooldown(), cooldownKey: 'k', isOperator: false, send,
        ...(outboundBlocked ? { outboundBlocked } : {}) });
    expect(await ask(message('/clear'), { trigger: { enabled: false } })).toBe(false);
    expect(await ask(message('/clear'), { trigger: { respondToPrivate: false } })).toBe(false);
    expect(await ask(message('/clear', { group: true, mentioned: true }), { trigger: { respondToAt: false } })).toBe(false);
    expect(await ask(message('/clear'), { access: { mode: 'closed' } })).toBe(false);
    expect(await ask(message('/clear'), { access: { mode: 'whitelist', users: ['someone-else'] } })).toBe(false);
    expect(await ask(message('/clear'), { access: { mode: 'unknown-mode' } })).toBe(false);
    expect(await ask(message('/clear'), {}, () => true)).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(await ask(message('/clear'), { access: { mode: 'whitelist', users: ['user'] } })).toBe(true);
    expect(await ask(message('/clear', { group: true, mentioned: true, sender: 'x' }), { access: { mode: 'whitelist', groups: ['g1'] } })).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('records a fixed reply as delivered only with exact plain-text evidence', async () => {
    const ledger = new SessionToldLedger();
    const text = '没有 /clear 这个指令。';
    const ref = { conversation: privateChat, id: 'hint-1' };
    await sendFixedReply({ reply: async () => ({ status: 'sent', message: ref, outboundTextDigest: sha(text) }) as never,
      toldLedger: ledger, sessionKey: 'session-key', text });
    expect(ledger.hasDelivered(sessionKeyLedgerId('session-key'), deliveredMessageContextRef(ref, deliveredTextDigest(text)))).toBe(true);
    // Recorded under the `key:` namespace: a session id equal to the key never names it (ADR 0067 D8).
    expect(ledger.hasDelivered('session-key', deliveredMessageContextRef(ref, deliveredTextDigest(text)))).toBe(false);
    // An outbound hook rewrote the text: the receipt digest differs, nothing is recorded.
    const rewritten = { conversation: privateChat, id: 'hint-2' };
    await sendFixedReply({ reply: async () => ({ status: 'sent', message: rewritten, outboundTextDigest: sha('rewritten') }) as never,
      toldLedger: ledger, sessionKey: 'session-key', text });
    expect(ledger.hasDelivered(sessionKeyLedgerId('session-key'), deliveredMessageContextRef(rewritten, deliveredTextDigest(text)))).toBe(false);
    expect(ledger.hasDelivered(sessionKeyLedgerId('session-key'), deliveredMessageContextRef(rewritten, deliveredTextDigest('rewritten')))).toBe(false);
    // A failed delivery records nothing either.
    const failed = { conversation: privateChat, id: 'hint-3' };
    await sendFixedReply({ reply: async () => ({ status: 'rejected', message: failed }) as never, toldLedger: ledger, sessionKey: 'session-key', text });
    expect(ledger.hasDelivered(sessionKeyLedgerId('session-key'), deliveredMessageContextRef(failed, deliveredTextDigest(text)))).toBe(false);
  });
});
