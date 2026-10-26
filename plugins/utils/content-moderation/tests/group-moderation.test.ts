import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PluginStateStore, rootPluginId, type StateRecord } from 'zhin.js';
import { GroupModerator, parseGroupReview, type GroupModerationInput } from '../src/group-moderation.js';

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
  it('localizes official escalation notices without changing model evidence or recall decisions', async () => {
    const f = fixture();
    f.completeText.mockResolvedValue({ text: verdict(true), model: 'fixture', durationMs: 0 });
    await f.send(1, { locale: 'en' }); await f.send(2, { locale: 'en' }); await f.send(3, { locale: 'en' });
    expect(f.reply.mock.calls.map(([message]) => message)).toEqual([
      'Reminder. Do not post unsolicited advertising or promotional invitations.',
      'Warning. Do not post unsolicited advertising or promotional invitations.',
      'Muted for 10 minutes. Do not post unsolicited advertising or promotional invitations.',
    ]);
    expect(f.input.audit).toHaveBeenCalledWith(expect.objectContaining({
      event: 'group_review', evidence: [text], recallReason: '避免继续引流', recall: true,
    }));
    expect(f.recall).toHaveBeenCalledTimes(2);
    expect(f.moderateGroupMember).toHaveBeenCalledExactlyOnceWith('129043431', '123',
      { type: 'mute', durationSeconds: 600 }, expect.any(AbortSignal));
  });

  it('localizes newcomer and abuse notices while preserving their different actions', async () => {
    const newcomer = fixture();
    newcomer.inspectGroupMember.mockResolvedValue({ canModerate: true, joinedAt: NOW - 1000 });
    await newcomer.send(1, { locale: 'en' });
    expect(newcomer.reply).toHaveBeenCalledWith(
      'Removed from the group for posting clear advertising within 10 minutes of joining. Do not post unsolicited advertising or promotional invitations.', '123');
    expect(newcomer.moderateGroupMember).toHaveBeenCalledWith('129043431', '123',
      { type: 'kick', joinedAt: NOW - 1000, maxMembershipAgeMs: 600_000 }, expect.any(AbortSignal));
    const abuse = fixture();
    abuse.completeText.mockResolvedValue({ text: verdict(false, 'abuse'), model: 'fixture', durationMs: 0 });
    await abuse.send(2, { locale: 'en' });
    expect(abuse.reply).toHaveBeenCalledExactlyOnceWith('Reminder. Do not direct personal attacks at others.', '123');
    expect(abuse.moderateGroupMember).not.toHaveBeenCalled();
  });

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
