import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PluginStateStore, rootPluginId, type StateRecord } from 'zhin.js';
import { GroupModerator, parseGroupReview, type GroupModerationInput } from '../src/group-moderation.js';
import inbound from '../middlewares/inbound/index.ts';
import { ModerationEngine } from '../src/engine.js';
import { moderationEngineToken } from '../src/runtime.js';
import { aiCompletionToken, databaseHostToken, outboundHostToken } from 'zhin.js';

const NOW = Date.UTC(2026, 9, 23, 12);
const text = '联系我购买这个产品';
const verdict = (recall = false, category = 'advertising') => JSON.stringify({
  category, evidence: [text], recall, recallReason: recall ? '避免继续引流' : '保留讨论上下文',
});

function fixture() {
  const rows = new Map<string, StateRecord>();
  let revision = 0;
  const state = new PluginStateStore(rootPluginId(), {
    read: async (_owner, _scope, key) => rows.get(key),
    compareExchange: async (_owner, _scope, key, expected, value, expiresAt) => {
      if (rows.get(key)?.revision !== expected) return false;
      if (value === undefined) rows.delete(key);
      else rows.set(key, { revision: String(++revision), value, expiresAt });
      return true;
    },
  });
  const moderator = new GroupModerator();
  const completeText = vi.fn(async () => ({ text: verdict(), model: 'fixture', durationMs: 0 }));
  const inspectGroupMember = vi.fn(async () => ({ canModerate: true, joinedAt: NOW - 3600_000 }));
  const moderateGroupMember = vi.fn(async () => {});
  const reply = vi.fn(async () => {});
  const recall = vi.fn(async () => {});
  const abort = new AbortController();
  const input: GroupModerationInput = {
    scope: 'icqq:bot:group', group: '129043431', sender: '123', messageId: 'm1', sentAt: NOW, text,
    signal: abort.signal, state, completion: { completeText },
    management: { inspectGroupMember, moderateGroupMember }, reply, recall, audit: vi.fn(),
  };
  const send = async (n: number, patch: Partial<GroupModerationInput> = {}) => {
    vi.setSystemTime(NOW + n * 2000);
    await moderator.review({ ...input, messageId: `m${n}`, sentAt: Date.now(), ...patch });
  };
  return { moderator, input, send, completeText, inspectGroupMember, moderateGroupMember, reply, recall, abort, rows };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => vi.useRealTimers());

describe('contextual group moderation', () => {
  it('keeps persistent deduplication bounded and does not re-review an evicted old message', async () => {
    const f = fixture();
    f.completeText.mockResolvedValue({ text: verdict(false, 'none'), model: 'fixture', durationMs: 0 });
    for (let n = 1; n <= 260; n++) await f.send(n);
    expect(f.rows.size).toBeLessThanOrEqual(2);
    expect([...f.rows.values()].every(row => Buffer.byteLength(JSON.stringify(row.value)) < 64 * 1024)).toBe(true);
    const calls = f.completeText.mock.calls.length;
    await new GroupModerator().review({ ...f.input, messageId: 'm1', sentAt: NOW + 2000 });
    expect(f.completeText).toHaveBeenCalledTimes(calls);
    expect(f.reply).not.toHaveBeenCalled();
  });

  it('does not use stale group context after an idle period', async () => {
    const f = fixture(); f.moderator.remember(f.input.scope, 'other-user', 'old request');
    await f.send(901);
    expect(f.completeText).toHaveBeenCalledWith(expect.objectContaining({
      untrusted: expect.arrayContaining([{ source: 'preceding-group-context', text: '' }]),
    }));
  });
  it.each([false, true])('leaves recall to the model at both reminder and warning: %s', async (recallChoice) => {
    const f = fixture();
    f.completeText.mockResolvedValue({ text: verdict(recallChoice), model: 'fixture', durationMs: 0 });
    await f.send(1); await f.send(2); await f.send(3);
    expect(f.reply.mock.calls.map(([message]) => message)).toEqual([
      expect.stringContaining('提醒'), expect.stringContaining('警告'), expect.stringContaining('禁言 10 分钟'),
    ]);
    expect(f.recall).toHaveBeenCalledTimes(recallChoice ? 2 : 0);
    expect(f.moderateGroupMember).toHaveBeenCalledExactlyOnceWith('129043431', '123',
      { type: 'mute', durationSeconds: 600 }, expect.any(AbortSignal));
  });

  it('recall failure neither retries nor increments the escalation stage', async () => {
    const f = fixture();
    f.completeText.mockResolvedValue({ text: verdict(true), model: 'fixture', durationMs: 0 });
    f.recall.mockRejectedValue(new Error('no permission'));
    await f.send(1); await f.send(1); await f.send(2);
    expect(f.reply).toHaveBeenCalledTimes(2);
    expect(f.reply).toHaveBeenLastCalledWith(expect.stringContaining('警告'), '123');
    expect(f.recall).toHaveBeenCalledTimes(2);
    expect(f.moderateGroupMember).not.toHaveBeenCalled();
  });

  it('does not count a message sent before the prior notice was delivered', async () => {
    const f = fixture();
    await f.send(1);
    await f.send(2, { sentAt: NOW + 1000 });
    await f.send(3);
    expect(f.reply).toHaveBeenCalledTimes(2);
    expect(f.reply).toHaveBeenLastCalledWith(expect.stringContaining('警告'), '123');
  });

  it('resets after 30 minutes without another violation', async () => {
    const f = fixture();
    await f.send(1); await f.send(2); await f.send(903);
    expect(f.reply).toHaveBeenLastCalledWith(expect.stringContaining('提醒'), '123');
    expect(f.moderateGroupMember).not.toHaveBeenCalled();
  });

  it('counts ads and abuse independently', async () => {
    const f = fixture();
    await f.send(1);
    f.completeText.mockResolvedValue({ text: verdict(false, 'abuse'), model: 'fixture', durationMs: 0 });
    await f.send(2);
    expect(f.reply).toHaveBeenLastCalledWith(expect.stringContaining('提醒'), '123');
  });

  it.each([0, 600_000])('automatically kicks a clear ad at newcomer age %d ms', async (age) => {
    const f = fixture();
    f.inspectGroupMember.mockResolvedValue({ canModerate: true, joinedAt: NOW - age });
    await f.moderator.review(f.input);
    expect(f.moderateGroupMember).toHaveBeenCalledWith('129043431', '123',
      { type: 'kick', joinedAt: NOW - age, maxMembershipAgeMs: 600_000 }, expect.any(AbortSignal));
    expect(f.recall).not.toHaveBeenCalled();
  });

  it.each([600_001, 3600_000])('does not automatically kick an older member (%d ms)', async (age) => {
    const f = fixture();
    f.inspectGroupMember.mockResolvedValue({ canModerate: true, joinedAt: NOW - age });
    await f.moderator.review(f.input);
    expect(f.moderateGroupMember).not.toHaveBeenCalled();
  });

  it('does not kick a newcomer for abuse', async () => {
    const f = fixture();
    f.inspectGroupMember.mockResolvedValue({ canModerate: true, joinedAt: NOW - 1000 });
    f.completeText.mockResolvedValue({ text: verdict(false, 'abuse'), model: 'fixture', durationMs: 0 });
    await f.send(1);
    expect(f.moderateGroupMember).not.toHaveBeenCalled();
  });

  it('does not kick when the message predates this membership', async () => {
    const f = fixture();
    f.inspectGroupMember.mockResolvedValue({ canModerate: true, joinedAt: NOW });
    await f.send(1, { sentAt: NOW - 1000 });
    expect(f.moderateGroupMember).not.toHaveBeenCalled();
  });

  it('does not retry unknown outcomes after a generation replacement', async () => {
    const f = fixture();
    f.reply.mockRejectedValueOnce(new Error('ACK timeout'));
    await f.send(1);
    vi.setSystemTime(NOW + 4000);
    await new GroupModerator().review({ ...f.input, messageId: 'after-reload', sentAt: Date.now() });
    expect(f.reply).toHaveBeenCalledTimes(1);
    expect(f.recall).not.toHaveBeenCalled();
  });

  it('reserves a member before concurrent reviews can issue multiple notices', async () => {
    const f = fixture();
    await Promise.all([f.moderator.review(f.input), f.moderator.review({ ...f.input, messageId: 'm2' })]);
    expect(f.completeText).toHaveBeenCalledTimes(2);
    expect(f.reply).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])('reviews an ad independently of a slow harmless review, replacement: %s', async (replacement) => {
    const f = fixture();
    f.inspectGroupMember.mockResolvedValue({ canModerate: true, joinedAt: NOW - 1000 });
    let release!: (value: { text: string; model: string; durationMs: number }) => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    f.completeText.mockImplementationOnce(() => {
      entered();
      return new Promise(resolve => { release = resolve; });
    });
    const first = f.moderator.review({ ...f.input, messageId: 'hello', text: '大家好' });
    await started;
    const nextModerator = replacement ? new GroupModerator() : f.moderator;
    await nextModerator.review({ ...f.input, messageId: 'ad' });
    expect(f.moderateGroupMember).toHaveBeenCalledTimes(1);
    release({ text: verdict(false, 'none'), model: 'fixture', durationMs: 0 });
    await first;
    expect(f.completeText).toHaveBeenCalledTimes(2);
    expect(f.moderateGroupMember).toHaveBeenCalledExactlyOnceWith('129043431', '123',
      { type: 'kick', joinedAt: NOW - 1000, maxMembershipAgeMs: 600_000 }, expect.any(AbortSignal));
    await f.moderator.review({ ...f.input, messageId: 'ad' });
    expect(f.completeText).toHaveBeenCalledTimes(2);
  });

  it('does not kick again for a concurrently reviewed ad sent before the delivered notice', async () => {
    const f = fixture();
    f.inspectGroupMember.mockResolvedValue({ canModerate: true, joinedAt: NOW - 1000 });
    let release!: (value: { text: string; model: string; durationMs: number }) => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    f.completeText.mockImplementationOnce(() => {
      entered(); return new Promise(resolve => { release = resolve; });
    });
    const first = f.moderator.review(f.input);
    await started;
    await new GroupModerator().review({ ...f.input, messageId: 'second-ad' });
    release({ text: verdict(), model: 'fixture', durationMs: 0 });
    await first;
    expect(f.completeText).toHaveBeenCalledTimes(2);
    expect(f.moderateGroupMember).toHaveBeenCalledTimes(1);
    expect(f.reply).toHaveBeenCalledTimes(1);
  });

  it('does not retain an already cancelled review behind an unrelated slow model call', async () => {
    const f = fixture();
    let release!: (value: { text: string; model: string; durationMs: number }) => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    f.completeText.mockImplementationOnce(() => {
      entered(); return new Promise(resolve => { release = resolve; });
    });
    const first = f.moderator.review(f.input);
    await started;
    const controller = new AbortController(); controller.abort();
    await f.moderator.review({ ...f.input, messageId: 'cancelled', signal: controller.signal });
    expect(f.completeText).toHaveBeenCalledTimes(1);
    release({ text: verdict(false, 'none'), model: 'fixture', durationMs: 0 });
    await first;
  });

  it('keeps a late model recall decision after its pending record is evicted without punishing', async () => {
    const f = fixture();
    const onReview = vi.fn();
    let release!: (value: { text: string; model: string; durationMs: number }) => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    f.completeText.mockResolvedValue({ text: verdict(false, 'none'), model: 'fixture', durationMs: 0 });
    f.completeText.mockImplementationOnce(() => {
      entered(); return new Promise(resolve => { release = resolve; });
    });
    const first = f.moderator.review({ ...f.input, messageId: 'original', onReview });
    await started;
    for (let n = 1; n <= 256; n++) await f.send(n);
    release({ text: verdict(false), model: 'fixture', durationMs: 0 });
    await first;
    expect(onReview).toHaveBeenCalledTimes(1);
    expect(f.reply).not.toHaveBeenCalled();
    expect(f.moderateGroupMember).not.toHaveBeenCalled();
    expect(f.recall).not.toHaveBeenCalled();
    const calls = f.completeText.mock.calls.length;
    await new GroupModerator().review({ ...f.input, messageId: 'original', onReview });
    expect(onReview).toHaveBeenCalledTimes(2);
    expect(f.completeText).toHaveBeenCalledTimes(calls);
  });

  it('lets a message sent after the notice advance while an optional recall is pending', async () => {
    const f = fixture();
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    f.completeText.mockResolvedValueOnce({ text: verdict(true), model: 'fixture', durationMs: 0 });
    f.recall.mockImplementationOnce(() => {
      entered(); return new Promise<void>(resolve => { release = resolve; });
    });
    const first = f.moderator.review(f.input);
    await started;
    vi.setSystemTime(NOW + 2000);
    await new GroupModerator().review({ ...f.input, messageId: 'after-notice', sentAt: Date.now() });
    expect(f.reply).toHaveBeenLastCalledWith(expect.stringContaining('警告'), '123');
    release(); await first;
    expect(f.reply).toHaveBeenCalledTimes(2);
    expect(f.recall).toHaveBeenCalledTimes(1);
  });

  it.each(['```json\n', '```\n'])('accepts a complete JSON object wrapped in %s', fence => {
    expect(parseGroupReview(`${fence}${verdict()}\n\x60\x60\x60`, text)).toEqual({
      category: 'advertising', evidence: [text], recall: false, recallReason: '保留讨论上下文',
    });
  });

  it('audits malformed review output without retrying or punishing', async () => {
    const f = fixture();
    f.completeText.mockResolvedValue({ text: '{', model: 'fixture', durationMs: 0 });
    await f.moderator.review(f.input);
    expect(f.input.audit).toHaveBeenCalledWith({ event: 'group_review_invalid', messageId: 'm1', reason: 'invalid_json' });
    expect(f.completeText).toHaveBeenCalledTimes(1);
    expect(f.reply).not.toHaveBeenCalled();
    expect(f.moderateGroupMember).not.toHaveBeenCalled();
  });

  it('does nothing when the platform cannot authorize moderation', async () => {
    const f = fixture();
    f.inspectGroupMember.mockResolvedValue({ canModerate: false, joinedAt: NOW });
    await f.send(1);
    expect(f.completeText).not.toHaveBeenCalled();
    expect(f.reply).not.toHaveBeenCalled();
  });

  it('does nothing if cancellation arrives during classification', async () => {
    const f = fixture();
    f.completeText.mockImplementation(async () => {
      f.abort.abort(); return { text: verdict(true), model: 'fixture', durationMs: 0 };
    });
    await f.send(1);
    expect(f.reply).not.toHaveBeenCalled(); expect(f.recall).not.toHaveBeenCalled();
  });

  it('cannot act on a delayed verdict after its persisted reservation has expired', async () => {
    const f = fixture();
    let release!: (value: { text: string; model: string; durationMs: number }) => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    f.completeText.mockImplementationOnce(async () => { entered(); return new Promise(resolve => { release = resolve; }); });
    const pending = f.moderator.review(f.input);
    await started;
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    release({ text: verdict(true), model: 'fixture', durationMs: 0 });
    await pending;
    expect(f.reply).not.toHaveBeenCalled(); expect(f.recall).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['none', 'uncertain', 'invalid-json', 'invented-evidence'])('fails closed for %s', async (category) => {
    const f = fixture();
    const answer = category === 'invalid-json' ? '{' : category === 'invented-evidence'
      ? verdict().replace(text, 'not in message') : verdict(true, category);
    f.completeText.mockResolvedValue({ text: answer, model: 'fixture', durationMs: 0 });
    await f.send(1);
    expect(f.reply).not.toHaveBeenCalled(); expect(f.recall).not.toHaveBeenCalled();
  });

  it('keeps model-supplied recipients and IDs out of the execution contract', () => {
    const result = parseGroupReview(JSON.stringify({ ...JSON.parse(verdict(true)), messageId: 'other', userId: 'victim' }), text);
    expect(result).toEqual({ category: 'advertising', evidence: [text], recall: true, recallReason: '避免继续引流' });
  });
});

describe('inbound group moderation wiring', () => {
  function middlewareFixture() {
    const f = fixture();
    const config = { groupModeration: [{ adapter: 'icqq', endpoint: '8596238', account: '8596238', group: '129043431' }],
      sources: [{ id: 'fixture', type: 'local', includeBuiltin: false, words: [{ word: text, severity: 'critical' }] }] };
    const engine = new ModerationEngine(); engine.configure(config);
    const hostRecall = vi.fn(async () => {});
    const resources = new Map<string, unknown>([
      [moderationEngineToken.id, engine], [aiCompletionToken.id, f.input.completion],
      [databaseHostToken.id, { state: { forConversation: () => f.input.state } }],
      [outboundHostToken.id, { recall: hostRecall }],
    ]);
    const endpoint = { identity: { adapter: 'icqq', id: 'canonical:8596238' }, selfUserId: '8596238', management: f.input.management };
    const message = { endpointId: '8596238', id: 'current-original-message', sender: { id: '123' },
      conversation: { endpoint: { adapter: 'icqq', id: 'canonical:8596238' }, kind: 'group', id: '129043431' },
      content: text, segments: [], metadata: { platformSentAt: NOW },
      $reply: vi.fn(async () => ({ status: 'sent' })) };
    const context = { config, input: message, signal: f.abort.signal,
      use: (token: { id: string }) => { if (!resources.has(token.id)) throw new Error('Missing resource'); return resources.get(token.id); },
      project: () => ({ connection: () => endpoint }) };
    const run = async (input = message) => inbound.handle({ ...context, input } as never, vi.fn(async () => undefined) as never);
    return { ...f, config, message, endpoint, engine, hostRecall, resources, run };
  }

  it('mentions the original sender through the outbound path at each escalation stage', async () => {
    const f = middlewareFixture();
    for (let n = 0; n < 3; n++) {
      vi.setSystemTime(NOW + n * 2000);
      f.message.id = `notice-${n}`;
      f.message.metadata.platformSentAt = Date.now();
      await f.run();
    }
    expect(f.message.$reply.mock.calls).toEqual(['提醒', '警告', '已禁言 10 分钟'].map(action => [[
      { type: 'mention', data: { target: '123' } },
      { type: 'text', data: { text: ` ${action}。请勿发布未经请求的广告或引流信息。` } },
    ]]));
  });

  it('preserves text-only replies when mention is omitted', async () => {
    const f = middlewareFixture();
    vi.spyOn(f.engine.groupModerator, 'review').mockImplementation(async input => {
      await input.reply('提醒。请勿发布未经请求的广告或引流信息。');
    });
    await f.run();
    expect(f.message.$reply).toHaveBeenCalledExactlyOnceWith('提醒。请勿发布未经请求的广告或引流信息。');
  });

  it.each([false, true])('protects the pending recall decision from a duplicate, replacement: %s', async (replacement) => {
    const f = middlewareFixture();
    let release!: (value: { text: string; model: string; durationMs: number }) => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    f.completeText.mockImplementationOnce(() => {
      entered();
      return new Promise(resolve => { release = resolve; });
    });
    const first = f.run();
    await started;
    if (replacement) {
      const engine = new ModerationEngine(); engine.configure(f.config);
      f.resources.set(moderationEngineToken.id, engine);
    }
    const duplicate = f.run();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.hostRecall).not.toHaveBeenCalled();
    release({ text: verdict(false), model: 'fixture', durationMs: 0 });
    await Promise.all([first, duplicate]);
    expect(f.completeText).toHaveBeenCalledTimes(1);
    expect(f.hostRecall).not.toHaveBeenCalled();
    expect(f.message.$reply).toHaveBeenCalledTimes(1);
  });

  it('does not suppress legacy recall for another message after an unknown notice outcome', async () => {
    const f = middlewareFixture();
    f.message.$reply.mockRejectedValueOnce(new Error('ACK timeout'));
    await f.run();
    expect(f.hostRecall).not.toHaveBeenCalled();
    f.completeText.mockResolvedValue({ text: verdict(false, 'none'), model: 'fixture', durationMs: 0 });
    vi.setSystemTime(NOW + 2000);
    await f.run({ ...f.message, id: 'different-message', metadata: { platformSentAt: Date.now() } });
    expect(f.hostRecall).toHaveBeenCalledExactlyOnceWith({ adapter: 'icqq', endpointKey: 'canonical:8596238',
      message: { conversation: f.message.conversation, id: 'different-message' } });
    expect(f.message.$reply).toHaveBeenCalledTimes(1);
  });

  it('captures preceding context in arrival order before overlapping reviews', async () => {
    const f = middlewareFixture();
    let release!: (value: { text: string; model: string; durationMs: number }) => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    f.completeText.mockResolvedValue({ text: verdict(false, 'none'), model: 'fixture', durationMs: 0 });
    f.completeText.mockImplementationOnce(() => {
      entered();
      return new Promise(resolve => { release = resolve; });
    });
    const first = f.run({ ...f.message, id: 'question', content: '请推荐一个产品' });
    await started;
    await f.run({ ...f.message, id: 'answer', sender: { id: '456' }, content: '推荐这个产品' });
    const secondRequest = f.completeText.mock.calls[1][0];
    expect(secondRequest.untrusted[0].text).toBe(JSON.stringify({ sender: '123', text: '请推荐一个产品' }));
    release({ text: verdict(false, 'none'), model: 'fixture', durationMs: 0 });
    await first;
    await f.run({ ...f.message, id: 'thanks', sender: { id: '789' }, content: '谢谢' });
    expect(f.completeText.mock.calls[2][0].untrusted[0].text).toBe([
      JSON.stringify({ sender: '123', text: '请推荐一个产品' }),
      JSON.stringify({ sender: '456', text: '推荐这个产品' }),
    ].join('\n'));
  });

  it.each([true, false])('keeps the model recall choice even when a lexicon says critical: %s', async (recall) => {
    const f = middlewareFixture();
    f.completeText.mockResolvedValue({ text: verdict(recall), model: 'fixture', durationMs: 0 });
    await f.run();
    expect(f.message.$reply).toHaveBeenCalledTimes(1);
    expect(f.hostRecall).toHaveBeenCalledTimes(recall ? 1 : 0);
    if (recall) expect(f.hostRecall).toHaveBeenCalledWith({ adapter: 'icqq', endpointKey: 'canonical:8596238',
      message: { conversation: f.message.conversation, id: 'current-original-message' } });
  });

  it.each(['account', 'group', 'endpoint', 'canonical'])('cannot moderate after a different %s is resolved', async (field) => {
    const f = middlewareFixture();
    if (field === 'account') f.endpoint.selfUserId = 'another-bot';
    if (field === 'group') f.message.conversation.id = 'another-group';
    if (field === 'endpoint') f.message.endpointId = 'another-instance';
    if (field === 'canonical') f.endpoint.identity.id = 'alias-fallback';
    await f.run();
    expect(f.completeText).not.toHaveBeenCalled();
    expect(f.message.$reply).not.toHaveBeenCalled();
    expect(f.moderateGroupMember).not.toHaveBeenCalled();
  });

  it('does not start moderation when AI or persistent state is absent', async () => {
    const f = middlewareFixture(); f.resources.delete(databaseHostToken.id);
    await f.run(); expect(f.completeText).not.toHaveBeenCalled();
    expect(f.message.$reply).not.toHaveBeenCalled();
  });

  it('does not advance after a suppressed notice', async () => {
    const f = middlewareFixture(); f.message.$reply.mockResolvedValue({ status: 'suppressed' });
    f.completeText.mockResolvedValue({ text: verdict(true), model: 'fixture', durationMs: 0 });
    await f.run();
    vi.setSystemTime(NOW + 2000);
    await f.run();
    expect(f.message.$reply).toHaveBeenCalledTimes(1);
    // The classification owns recall, even if its notice was suppressed; no legacy fallback deletion.
    expect(f.hostRecall).not.toHaveBeenCalled();
  });
});
