import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { SessionToldLedger, sessionKeyLedgerId } from '../../src/memory/told-ledger.js';
import { deliveredMessageContextRef, deliveredTextDigest } from '../../src/session/context-provenance.js';
import { ZhinAgent } from '../../src/zhin-agent/index.js';
import { isClearCommand } from '../../src/plugin-runtime/ingress/content.js';
import {
  answerClearCommand,
  ClearConfirmCooldown,
  clearCommandAllowed,
  clearedText,
  matchClearCommand,
  sendFixedReply,
} from '../../src/plugin-runtime/ingress/clear-command.js';

const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const privateChat = { endpoint: { adapter: 'root/sandbox', id: 'main' }, kind: 'private', id: 'user' } as const;
const groupChat = { endpoint: { adapter: 'root/sandbox', id: 'main' }, kind: 'group', id: 'g1' } as const;

function message(content: string, options: { group?: boolean; mentioned?: boolean; locale?: string; commandPrefix?: string; sender?: string; metadata?: Record<string, unknown> } = {}) {
  return {
    content,
    conversation: options.group ? groupChat : privateChat,
    sender: { id: options.sender ?? 'user' },
    ...(options.mentioned !== undefined ? { mentioned: options.mentioned } : {}),
    metadata: options.metadata ?? {},
    locale: options.locale ?? 'zh-CN',
    commandPrefix: options.commandPrefix ?? '/',
  } as never;
}

function clearInput(msg: never, overrides: Partial<Parameters<typeof answerClearCommand>[0]> = {}) {
  const send = vi.fn(async (_text: string) => undefined);
  const archive = vi.fn(async () => true);
  return {
    send, archive,
    input: { message: msg, policy: {}, cooldown: new ClearConfirmCooldown(), cooldownKey: 'k', archive, send, ...overrides },
  };
}

/**
 * #1250 `own-unhandled-message-counts-as-background`: `/clear`, `/reset`, `/new` that no command handled
 * clear the sender's session context (the same archive as a triggered `清空`) and confirm with a fixed
 * reply this session records as its own delivery.
 */
describe('chat clear command (#1250)', () => {
  it('recognizes one set of spellings: clear words and slash spellings in any case, ASCII or full-width slash', () => {
    for (const text of ['clear', '清空', '重置', ' CLEAR ', '/clear', '/CLEAR', '／clear', '/Reset', '/new', ' /clear ', '／ｃｌｅａｒ', '/ clear']) {
      expect(isClearCommand(text)).toBe(true);
    }
    for (const text of ['/clear all', '/clearance', '/help', 'please /clear', 'please clear', '/清空', 'new', 'reset', '']) {
      expect(isClearCommand(text)).toBe(false);
    }
    // The untriggered matcher uses the same recognizer.
    for (const text of ['/clear', '／ＲＥＳＥＴ', '/New', '清空']) expect(matchClearCommand(message(text))).toBe(true);
    for (const text of ['/clear all', '/weather']) expect(matchClearCommand(message(text))).toBe(false);
  });

  it('acts in a group only when the bot is mentioned', () => {
    expect(matchClearCommand(message('/clear', { group: true }))).toBe(false);
    expect(matchClearCommand(message('/clear', { group: true, mentioned: false }))).toBe(false);
    expect(matchClearCommand(message('@bot /clear', { group: true, mentioned: true }))).toBe(true);
    expect(matchClearCommand(message('[CQ:at,qq=1] /reset', { group: true, mentioned: true }))).toBe(true);
    // The same mention test as the AI trigger: `metadata.mentioned` counts too.
    expect(matchClearCommand(message('/clear', { group: true, metadata: { mentioned: true } }))).toBe(true);
    expect(clearCommandAllowed(message('/clear', { group: true, metadata: { mentioned: true } }), {})).toBe(true);
  });

  it('accepts /clear@<this bot> (adapter-reported handle) and never /clear@<another account>', () => {
    const own = { metadata: { botUsername: 'ZhinBot' } };
    for (const text of ['/clear@ZhinBot', '/RESET@zhinbot', '／new@ZhinBot']) {
      expect(matchClearCommand(message(text, { group: true, ...own }))).toBe(true);
      expect(clearCommandAllowed(message(text, { group: true, ...own }), {})).toBe(true);
      expect(matchClearCommand(message(text, own))).toBe(true);
    }
    expect(matchClearCommand(message('@ZhinBot /clear@ZhinBot', { group: true, mentioned: true, ...own }))).toBe(true);
    for (const options of [{ group: true, ...own }, { group: true, mentioned: true, ...own }, own, { group: true }, {}]) {
      expect(matchClearCommand(message('/clear@OtherBot', options))).toBe(false);
    }
    expect(matchClearCommand(message('/clear@ZhinBot', { group: true }))).toBe(false);
    expect(matchClearCommand(message('/weather@ZhinBot', { group: true, ...own }))).toBe(false);
    expect(clearCommandAllowed(message('/clear@ZhinBot', { group: true, ...own }), { trigger: { respondToAt: false } })).toBe(false);
  });

  it('confirms what was cleared and what was not; localized', () => {
    expect(clearedText('zh-CN')).toContain('已清空本会话的 AI 多轮上下文');
    expect(clearedText('zh-CN')).toContain('长期记忆和定时任务不受影响');
    expect(clearedText('en')).toContain('Cleared the AI conversation context');
    expect(clearedText('en')).toContain('Long-term memory and scheduled tasks are not affected');
  });

  it('clears the session and confirms instead of answering with a hint', async () => {
    const { input, send, archive } = clearInput(message('/clear'));
    expect(await answerClearCommand(input)).toBe(true);
    expect(archive).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledExactlyOnceWith(clearedText('zh-CN'));
    expect(send.mock.calls[0]![0]).not.toContain('没有 /clear 这个指令');
    const other = clearInput(message('/weather'));
    expect(await answerClearCommand(other.input)).toBe(false);
    expect(other.archive).not.toHaveBeenCalled();
    expect(other.send).not.toHaveBeenCalled();
  });

  it('a private /clear leaves the next turn with an empty context (real ZhinAgent session archive)', async () => {
    const agent = new ZhinAgent();
    try {
      const key = 'private-session-key';
      const before = await agent.agentSessionStore.getOrCreateActive({ session_key: key });
      await agent.contextRepository.appendMessages(before.session_id, [
        { role: 'user', content: [{ type: 'text', text: '记住我叫小明' }], timestamp: 1 },
        { role: 'assistant', content: [{ type: 'text', text: '好的' }], timestamp: 2 },
      ] as never);
      expect((await agent.contextRepository.loadMessageRows(before.session_id)).length).toBe(2);

      const { input, send } = clearInput(message('／CLEAR'), { archive: () => agent.archiveSession(key) });
      expect(await answerClearCommand(input)).toBe(true);
      expect(send).toHaveBeenCalledExactlyOnceWith(clearedText('zh-CN'));

      const after = await agent.agentSessionStore.getOrCreateActive({ session_key: key });
      expect(after.session_id).not.toBe(before.session_id);
      expect(await agent.contextRepository.loadMessageRows(after.session_id)).toEqual([]);
      expect((await agent.contextRepository.loadContext(after.session_id)).messages).toEqual([]);
    } finally {
      await agent.dispose();
    }
  });

  it('does not flood: a repeated clear with nothing left is confirmed at most once per cooldown', async () => {
    let now = 1_000;
    const cooldown = new ClearConfirmCooldown(60_000, () => now);
    const send = vi.fn(async () => undefined);
    let active = true;
    const archive = vi.fn(async () => { const had = active; active = false; return had; });
    const ask = (key: string) => answerClearCommand({ message: message('/clear'), policy: {}, cooldown, cooldownKey: key, archive, send });
    expect(await ask('conv\u0000user')).toBe(true);
    expect(await ask('conv\u0000user')).toBe(true);
    expect(await ask('conv\u0000user')).toBe(true);
    // Every message is handled (and archived, idempotently), but only one confirmation went out.
    expect(archive).toHaveBeenCalledTimes(3);
    expect(send).toHaveBeenCalledTimes(1);
    // Another sender (or conversation) has its own window.
    expect(await ask('conv\u0000other')).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
    // New context since the last clear: archived again, confirmed again even inside the window.
    active = true;
    expect(await ask('conv\u0000user')).toBe(true);
    expect(send).toHaveBeenCalledTimes(3);
    now += 59_999;
    expect(await ask('conv\u0000user')).toBe(true);
    expect(send).toHaveBeenCalledTimes(3);
    now += 1;
    expect(await ask('conv\u0000user')).toBe(true);
    expect(send).toHaveBeenCalledTimes(4);
  });

  it('neither clears nor answers where the AI would not answer: trigger off, private or mentions disabled, outbound stopped', async () => {
    const send = vi.fn(async () => undefined);
    const archive = vi.fn(async () => true);
    const ask = (msg: never, policy: Parameters<typeof clearCommandAllowed>[1], outboundBlocked?: () => boolean) =>
      answerClearCommand({ message: msg, policy, cooldown: new ClearConfirmCooldown(), cooldownKey: 'k', archive, send,
        ...(outboundBlocked ? { outboundBlocked } : {}) });
    expect(await ask(message('/clear'), { trigger: { enabled: false } })).toBe(false);
    expect(await ask(message('/clear'), { trigger: { respondToPrivate: false } })).toBe(false);
    expect(await ask(message('/clear', { group: true, mentioned: true }), { trigger: { respondToAt: false } })).toBe(false);
    expect(await ask(message('/clear', { group: true }), {})).toBe(false);
    expect(await ask(message('/clear'), {}, () => true)).toBe(false);
    expect(archive).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    // `ai.access` is not part of the policy (no IM ingress path enforces it).
    expect(await ask(message('/clear'), {})).toBe(true);
    expect(await ask(message('/clear', { group: true, mentioned: true, sender: 'x' }), {})).toBe(true);
    expect(archive).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('takes the confirmation cooldown only when a confirmation is sent', async () => {
    let now = 0;
    const cooldown = new ClearConfirmCooldown(60_000, () => now);
    const send = vi.fn(async () => undefined);
    const archive = vi.fn(async () => false);
    // Outbound stopped: nothing is cleared or sent, and the window is not started.
    expect(await answerClearCommand({ message: message('/clear'), policy: {}, cooldown, cooldownKey: 'k', archive, send, outboundBlocked: () => true })).toBe(false);
    expect(await answerClearCommand({ message: message('/clear'), policy: {}, cooldown, cooldownKey: 'k', archive, send })).toBe(true);
    expect(send).toHaveBeenCalledOnce();
    now += 1;
    expect(cooldown.take('k')).toBe(false);
  });

  it('records a fixed reply as delivered only with exact plain-text evidence', async () => {
    const ledger = new SessionToldLedger();
    const text = clearedText('zh-CN');
    const ref = { conversation: privateChat, id: 'cleared-1' };
    await sendFixedReply({ reply: async () => ({ status: 'sent', message: ref, outboundTextDigest: sha(text) }) as never,
      toldLedger: ledger, sessionKey: 'session-key', text });
    expect(ledger.hasDelivered(sessionKeyLedgerId('session-key'), deliveredMessageContextRef(ref, deliveredTextDigest(text)))).toBe(true);
    // Recorded under the `key:` namespace: a session id equal to the key never names it (ADR 0067 D8).
    expect(ledger.hasDelivered('session-key', deliveredMessageContextRef(ref, deliveredTextDigest(text)))).toBe(false);
    // An outbound hook rewrote the text: the receipt digest differs, nothing is recorded.
    const rewritten = { conversation: privateChat, id: 'cleared-2' };
    await sendFixedReply({ reply: async () => ({ status: 'sent', message: rewritten, outboundTextDigest: sha('rewritten') }) as never,
      toldLedger: ledger, sessionKey: 'session-key', text });
    expect(ledger.hasDelivered(sessionKeyLedgerId('session-key'), deliveredMessageContextRef(rewritten, deliveredTextDigest(text)))).toBe(false);
    expect(ledger.hasDelivered(sessionKeyLedgerId('session-key'), deliveredMessageContextRef(rewritten, deliveredTextDigest('rewritten')))).toBe(false);
    // A failed delivery records nothing either.
    const failed = { conversation: privateChat, id: 'cleared-3' };
    await sendFixedReply({ reply: async () => ({ status: 'rejected', message: failed }) as never, toldLedger: ledger, sessionKey: 'session-key', text });
    expect(ledger.hasDelivered(sessionKeyLedgerId('session-key'), deliveredMessageContextRef(failed, deliveredTextDigest(text)))).toBe(false);
  });
});
