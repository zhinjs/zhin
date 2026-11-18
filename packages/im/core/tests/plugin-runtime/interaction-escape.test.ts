import { describe, expect, it, vi } from 'vitest';
import { Message } from '../../src/plugin-runtime/im/index.js';
import { RuntimeInteractiveRouter } from '../../src/plugin-runtime/im/interactive-router.js';
import { RuntimeInteractionCoordinator } from '../../src/plugin-runtime/im/interaction-runtime.js';
import { interactionEndOf } from '../../src/plugin-runtime/im/interaction-end.js';
import { parseUserInteractionAnswer, projectUserInteraction } from '../../src/built/user-interaction.js';

/** #1250 `interaction-prompt-swallows-messages` / ADR 0061 decision 11 (revised). */
const conversation = { endpoint: { adapter: 'test', id: 'main' }, kind: 'group' as const, id: 'room' };
const select = { type: 'select', title: '选一个', options: [{ label: '甲', value: 'a' }, { label: '乙', value: 'b' }] } as const;

function message(sender: string, content: string, extra: Partial<{ mentioned: boolean; segments: unknown[] }> = {},
  reply = vi.fn(async (_content: unknown) => ({ status: 'sent' as const }))) {
  return new Message({ conversation, content, sender: { id: sender }, ...extra } as never, { generation: 1, reply });
}

function start<R>(ask: (interactions: RuntimeInteractionCoordinator) => Promise<R>) {
  const interactions = new RuntimeInteractionCoordinator(new RuntimeInteractiveRouter(100));
  return { interactions, answer: ask(interactions) };
}

describe('cancel words on choice prompts', () => {
  it.each(['取消', 'cancel', 'CANCEL', '退出', 'quit'])('ends a select prompt on %s with a cancelled end and says so', async word => {
    const reply = vi.fn(async (_content: unknown) => ({ status: 'sent' as const }));
    const { interactions, answer } = start(i => i.create(message('alice', 'pick', {}, reply)).ask(select));
    const settled = answer.catch(error => error as Error);
    await vi.waitFor(() => expect(reply).toHaveBeenCalledTimes(1));
    expect(interactions.resolveClaimDetailed(message('alice', word))).toEqual({ answerLike: true });
    const error = await settled;
    expect(error).toMatchObject({ name: 'UserInteractionCancelledError', reason: 'cancelled' });
    expect(interactionEndOf(error)).toEqual({ outcome: 'interaction_cancelled', reason: 'cancelled' });
    expect(reply).toHaveBeenLastCalledWith('已取消。');
  });

  it('keeps an option labelled 取消 selectable, and cancels number / multiselect / list prompts but not text', async () => {
    const own = { type: 'select', title: 't', options: [{ label: '继续', value: 1 }, { label: '取消', value: 2 }] } as const;
    expect(parseUserInteractionAnswer(own, '取消')).toEqual({ ok: true, value: 2 });
    for (const type of ['number', 'multiselect', 'list'] as const) {
      const request = type === 'number' ? { type, title: 'n' } : type === 'list' ? { type, title: 'l', valueType: 'number' as const } : { ...select, type };
      const reply = vi.fn(async (_content: unknown) => ({ status: 'sent' as const }));
      const { interactions, answer } = start(i => i.create(message('alice', 'ask', {}, reply)).ask(request as never));
      const settled = answer.catch(error => error as Error);
      await vi.waitFor(() => expect(reply).toHaveBeenCalledTimes(1));
      interactions.resolveClaim(message('alice', 'cancel'));
      await expect(settled).resolves.toMatchObject({ name: 'UserInteractionCancelledError' });
    }
    const reply = vi.fn(async (_content: unknown) => ({ status: 'sent' as const }));
    const { interactions, answer } = start(i => i.create(message('alice', 'ask', {}, reply)).ask({ type: 'text', title: '名字' }));
    await vi.waitFor(() => expect(reply).toHaveBeenCalledTimes(1));
    interactions.resolveClaim(message('alice', '取消'));
    await expect(answer).resolves.toBe('取消');
  });

  it('says how to leave in every choice-like prompt, in both languages', () => {
    expect(projectUserInteraction(select).tip).toContain('回复「取消」退出');
    expect(projectUserInteraction(select, undefined, 'en').tip).toContain('reply "cancel" to exit');
    expect(projectUserInteraction({ type: 'number', title: 'n' }).tip).toContain('回复「取消」退出');
    expect(projectUserInteraction({ type: 'number', title: 'n' }, undefined, 'en').tip).toContain('reply "cancel" to exit');
    expect(projectUserInteraction({ ...select, type: 'multiselect' }).tip).toContain('回复「取消」退出');
  });

  it('keeps confirm: 取消 / 否 / 2 answer false, and the shared words work across languages', () => {
    const confirm = { type: 'confirm', title: '确认？' } as const;
    for (const word of ['取消', '否', '2', 'cancel']) expect(parseUserInteractionAnswer(confirm, word)).toEqual({ ok: true, value: false });
    for (const word of ['cancel', 'no', '取消']) expect(parseUserInteractionAnswer(confirm, word, 'en')).toEqual({ ok: true, value: false });
    for (const word of ['是', '确认', '1']) expect(parseUserInteractionAnswer(confirm, word)).toEqual({ ok: true, value: true });
    expect(parseUserInteractionAnswer(confirm, '随便')).toMatchObject({ ok: false });
  });
});

describe('escaping a pending prompt', () => {
  it.each([
    ['media', message('alice', '', { segments: [{ type: 'image', data: { url: 'https://example.com/a.png' } }] }), undefined],
    ['a mention', message('alice', '@bot 在吗', { mentioned: true }), undefined],
    ['a command', message('alice', '/status'), () => true],
  ])('ends the sender’s prompt on %s and lets the message through', async (_kind, incoming, matchesCommand) => {
    const reply = vi.fn(async (_content: unknown) => ({ status: 'sent' as const }));
    const { interactions, answer } = start(i => i.create(message('alice', 'pick', {}, reply)).ask(select));
    const settled = answer.catch(error => error as Error);
    await vi.waitFor(() => expect(reply).toHaveBeenCalledTimes(1));
    expect(interactions.resolveClaim(incoming, undefined, matchesCommand ? { matchesCommand } : undefined)).toBe(false);
    const error = await settled;
    expect(error).toMatchObject({ name: 'UserInteractionCancelledError', reason: 'interrupted' });
    expect(interactionEndOf(error)).toEqual({ outcome: 'interaction_cancelled', reason: 'interrupted' });
    // The inbound runtime says "left"; the prompt itself sends nothing more.
    expect(reply).toHaveBeenCalledTimes(1);
  });

  it('takes a valid answer that mentions the bot or matches a command as the answer', async () => {
    const reply = vi.fn(async (_content: unknown) => ({ status: 'sent' as const }));
    const { interactions, answer } = start(i => i.create(message('alice', 'pick', {}, reply)).ask(select));
    await vi.waitFor(() => expect(reply).toHaveBeenCalledTimes(1));
    expect(interactions.resolveClaimDetailed(message('alice', '2'), undefined, { matchesCommand: () => true })).toEqual({ answerLike: true });
    await expect(answer).resolves.toBe('b');
  });

  it('notifies "left" at most once a minute per sender', async () => {
    const interactions = new RuntimeInteractionCoordinator(new RuntimeInteractiveRouter(100));
    const notices: boolean[] = [];
    for (let round = 0; round < 2; round += 1) {
      const reply = vi.fn(async (_content: unknown) => ({ status: 'sent' as const }));
      const answer = interactions.create(message('alice', 'pick', {}, reply)).ask(select).catch(() => undefined);
      await vi.waitFor(() => expect(reply).toHaveBeenCalledTimes(1));
      const resolution = interactions.resolveClaimDetailed(message('alice', '@bot hi', { mentioned: true }));
      notices.push(resolution !== false && resolution.notify === true);
      await answer;
    }
    expect(notices).toEqual([true, false]);
  });

  it("leaves an 'anyone' prompt and other members' messages alone", async () => {
    const reply = vi.fn(async (_content: unknown) => ({ status: 'sent' as const }));
    const abort = new AbortController();
    const { interactions, answer } = start(i => i.create(message('alice', 'vote', {}, reply))
      .ask({ ...select, answeredBy: 'anyone', signal: abort.signal }));
    try {
      await vi.waitFor(() => expect(reply).toHaveBeenCalledTimes(1));
      expect(interactions.resolveClaimDetailed(message('bob', '@bot hi', { mentioned: true }))).toBe(false);
      expect(interactions.resolveClaimDetailed(message('carol', '/status'), undefined, { matchesCommand: () => true })).toBe(false);
      expect(interactions.resolveClaim(message('bob', '1'))).toBe(true);
      await expect(answer).resolves.toBe('a');
    } finally { abort.abort(); }
  });
});

describe('interaction ends are expected outcomes', () => {
  it('maps timeout, cancel, interrupt and supersede by error name; other errors stay failures', () => {
    const named = (name: string, extra: object = {}) => Object.assign(new Error(name), { name }, extra);
    expect(interactionEndOf(named('UserInteractionTimeoutError'))).toEqual({ outcome: 'interaction_timeout', reason: 'timeout' });
    expect(interactionEndOf(named('UserInteractionSupersededError'))).toEqual({ outcome: 'interaction_cancelled', reason: 'superseded' });
    expect(interactionEndOf(named('UserInteractionCancelledError', { reason: 'interrupted' }))).toEqual({ outcome: 'interaction_cancelled', reason: 'interrupted' });
    expect(interactionEndOf(named('UserInteractionDeliveryError'))).toBeUndefined();
    expect(interactionEndOf(new Error('boom'))).toBeUndefined();
    expect(interactionEndOf('UserInteractionTimeoutError')).toBeUndefined();
  });
});
