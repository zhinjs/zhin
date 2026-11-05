/**
 * Inbox admission policy (ADR 0048 H3) — ported from
 * `packages/im/agent/tests/turn/turn-admission-gate.test.ts` (#725). The
 * gate's `admit()` promise becomes a posted human mail; `run` admissions are
 * runner calls, `merged` / `rejected` are post results or cancelled finishes.
 * Each human mail opens its own engagement; they share one lane (the IM
 * session), which is what makes them queue and merge together.
 */
import { describe, expect, it } from 'vitest';
import { createInboxDriver, LANE } from '../support/inbox-driver.js';

const tick = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

describe('inbox admission (#725)', () => {
  it('runs a message on an idle lane immediately', async () => {
    const d = createInboxDriver();
    expect(d.say('alice', '你好').result).toEqual({ accepted: true, position: 1, disposition: 'queued' });
    await tick();
    const run = d.current()!;
    expect(run.text).toBe('你好');
    expect(run.control.facts).toEqual({ queuedMs: 0, mergedMessages: 1, supersededPrevious: false, carried: false, evicted: 0 });
    await d.release(run);
    expect(d.finished).toEqual([{ ids: ['m1'], result: { status: 'completed' } }]);
  });

  it('never runs a group message that does not address the agent', async () => {
    const d = createInboxDriver();
    expect(d.say('alice', '今天食堂有什么菜？', { unaddressed: true }).result).toEqual({
      accepted: false, code: 'not_addressed', message: 'the message does not address the agent',
    });
    await tick();
    expect(d.current()).toBeUndefined();
    expect(d.finished).toEqual([]);
  });

  it('merges a sender follow-up into one fresh turn when nothing was delivered yet', async () => {
    const d = createInboxDriver();
    d.say('alice', '帮我查明天的天气');
    await tick();
    const first = d.current()!;
    expect(d.say('alice', '还有后天的').result).toMatchObject({ accepted: true, disposition: 'superseded' });
    expect(first.signal.aborted).toBe(true);
    expect(first.signal.reason).toBe('superseded');
    await d.release(first);
    const replacement = d.current()!;
    expect(replacement).not.toBe(first);
    expect(replacement.text).toBe('帮我查明天的天气\n还有后天的');
    expect(replacement.control.facts.supersededPrevious).toBe(true);
    expect(replacement.control.facts.mergedMessages).toBe(2);
    // The superseded turn reports nothing: its mails are answered by the replacement.
    expect(d.finished).toEqual([]);
    await d.release(replacement);
    expect(d.finished).toEqual([{ ids: ['m1', 'm2'], result: { status: 'completed' } }]);
  });

  it('queues a sender follow-up once the running turn has already replied', async () => {
    const d = createInboxDriver();
    d.say('alice', '第一个问题');
    await tick();
    const first = d.current()!;
    first.control.markDelivered();
    expect(d.say('alice', '第二个问题').result).toMatchObject({ disposition: 'queued' });
    expect(first.signal.aborted).toBe(false);
    await tick();
    expect(d.runs).toHaveLength(1);
    await d.release(first);
    const next = d.current()!;
    expect(next.text).toBe('第二个问题');
    expect(next.control.facts.supersededPrevious).toBe(false);
  });

  it('never supersedes in fifo mode', async () => {
    const d = createInboxDriver({ supersedeSameSender: false });
    d.say('alice', 'a');
    await tick();
    const first = d.current()!;
    d.say('alice', 'b');
    expect(first.signal.aborted).toBe(false);
    await d.release(first);
    expect(d.current()!.text).toBe('b');
  });

  it('does not merge or supersede when attachments are involved', async () => {
    const d = createInboxDriver();
    d.say('alice', '看看这张图', { plainText: false });
    await tick();
    const first = d.current()!;
    d.say('alice', '说说看');
    expect(first.signal.aborted).toBe(false);
    await d.release(first);
    expect(d.current()!.text).toBe('说说看');
  });

  it('never lets one member abort or merge into another member\'s turn', async () => {
    const d = createInboxDriver();
    d.say('alice', 'alice 的问题');
    await tick();
    const alice = d.current()!;
    d.say('bob', 'bob 的问题');
    expect(alice.signal.aborted).toBe(false);
    await d.release(alice);
    expect(d.current()!.text).toBe('bob 的问题');
  });

  it('answers a five-message group burst without duplicates, losses or crossed turns', async () => {
    const d = createInboxDriver();
    d.say('alice', 'alice-1');
    await tick();
    const first = d.current()!;
    first.control.markDelivered();
    d.say('bob', 'bob-1');
    d.say('carol', 'carol-1');
    // bob-2 folds into bob's queued turn; nothing else merges across senders.
    expect(d.say('bob', 'bob-2').result).toMatchObject({ disposition: 'merged' });
    d.say('alice', 'alice-2');
    await d.advance(1_000);

    const answered: string[][] = [];
    for (let i = 0; i < 4; i++) {
      const run = d.current()!;
      answered.push([run.senders[0]!, run.text]);
      await d.release(run);
    }
    expect(answered).toEqual([
      ['alice', 'alice-1'],
      ['bob', 'bob-1\nbob-2'],
      ['carol', 'carol-1'],
      ['alice', 'alice-2'],
    ]);
    expect(d.finished.flatMap((f) => f.ids).sort()).toEqual(['m1', 'm2', 'm3', 'm4', 'm5']);
    expect(d.current()).toBeUndefined();
  });

  it('reports queue wait time on the admitted turn', async () => {
    const d = createInboxDriver();
    d.say('alice', 'a');
    await tick();
    const first = d.current()!;
    d.say('bob', 'b');
    await d.advance(2_500);
    await d.release(first);
    expect(d.current()!.control.facts.queuedMs).toBe(2_500);
  });

  it('rejects messages beyond maxQueuedTurns with a visible reason', async () => {
    const d = createInboxDriver({ maxQueuedTurns: 1 });
    d.say('alice', 'a');
    await tick();
    d.say('bob', 'b');
    expect(d.say('carol', 'c').result).toMatchObject({ accepted: false, code: 'queue_full' });
  });

  it('drops queued turns that waited longer than the TTL', async () => {
    const d = createInboxDriver({}, { queueTtlMs: 1_000 });
    d.say('alice', 'a');
    await tick();
    const first = d.current()!;
    const late = d.say('bob', 'b').mail;
    await d.advance(1_001);
    await d.release(first);
    expect(d.droppedReason(late)).toBe('expired');
    expect(d.current()).toBeUndefined();
  });

  describe('explicit stop', () => {
    it('lets the initiator stop their turn and drops their queued messages', async () => {
      const d = createInboxDriver();
      d.say('alice', 'a');
      await tick();
      const first = d.current()!;
      first.control.markDelivered();
      const queued = d.say('alice', 'b').mail;
      d.say('bob', 'c');
      expect(d.say('alice', '/stop', { isStop: true }).result).toEqual({ accepted: true, position: 0, disposition: 'stopped' });
      expect(first.signal.reason).toBe('stopped');
      await tick();
      expect(d.droppedReason(queued)).toBe('stopped');
      await d.release(first);
      expect(d.current()!.text).toBe('c');
    });

    it('does not let another member stop the turn', async () => {
      const d = createInboxDriver();
      d.say('alice', 'a');
      await tick();
      const first = d.current()!;
      expect(d.say('bob', '/stop', { isStop: true }).result).toMatchObject({ accepted: false, code: 'forbidden' });
      expect(first.signal.aborted).toBe(false);
    });

    it('lets the master stop any turn', async () => {
      const d = createInboxDriver();
      d.say('alice', 'a');
      await tick();
      const first = d.current()!;
      expect(d.say('owner', '/stop', { isStop: true, isMaster: true }).result).toMatchObject({ disposition: 'stopped' });
      expect(first.signal.aborted).toBe(true);
    });

    it('reports when nothing is running', () => {
      const d = createInboxDriver();
      expect(d.say('alice', '/stop', { isStop: true }).result).toMatchObject({ accepted: false, code: 'not_running' });
    });

    it('also works through cancelSender', async () => {
      const d = createInboxDriver();
      d.say('alice', 'a');
      await tick();
      d.current()!.control.markDelivered();
      d.say('alice', 'b');
      d.say('bob', 'c');
      expect(d.box.cancelSender({ actor: 'zhin', lane: LANE }, 'alice', 'stopped')).toBe(1);
      expect(d.box.cancelSender({ actor: 'zhin', lane: 'other' }, 'alice')).toBe(0);
    });
  });

  it('keeps lanes independent', async () => {
    const d = createInboxDriver();
    d.say('alice', 'a');
    d.say('alice', 'b', { lane: 'qq:bot:private:alice' });
    await tick();
    expect(d.runs.map((r) => r.text)).toEqual(['a', 'b']);
    expect(d.runs[0]!.signal.aborted).toBe(false);
  });

  it('runs without a lane per engagement, as in H1', async () => {
    const d = createInboxDriver();
    const { mail } = d.say('alice', 'a');
    // Same lane by default only within one engagement.
    expect(mail.lane).toBe(LANE);
    const plain = { ...mail, id: 'x', lane: undefined, engagementId: 'ex' };
    d.box.post(plain);
    await tick();
    expect(d.runs.map((r) => r.ids[0])).toEqual(['m1', 'x']);
  });
});

describe('inbox merge window (ADR 0038 §1)', () => {
  const MERGE = { quietMs: 1_500, maxWaitMs: 6_000, maxSenders: 3 };
  const mention = { mergeable: true } as const;

  it('waits for the window to go quiet, then answers every sender in one turn', async () => {
    const d = createInboxDriver({ merge: MERGE });
    d.say('alice', '今晚几点开会', { ...mention, senderName: 'Alice' });
    await d.advance(500);
    expect(d.say('bob', '会议链接在哪', mention).result).toMatchObject({ disposition: 'merged' });
    await d.advance(1_000);
    expect(d.say('carol', '我能旁听吗', mention).result).toMatchObject({ disposition: 'merged' });
    await tick();
    expect(d.runs).toHaveLength(0);
    await d.advance(1_499);
    expect(d.runs).toHaveLength(0);
    await d.advance(1);
    const run = d.current()!;
    expect(run.text).toBe('Alice: 今晚几点开会\nbob: 会议链接在哪\ncarol: 我能旁听吗');
    expect(run.senders).toEqual(['alice', 'bob', 'carol']);
    expect(run.control.facts).toMatchObject({ queuedMs: 3_000, mergedMessages: 3, supersededPrevious: false });
    // Q2: one engagement (the first) carries the merged turn.
    await d.release(run);
    expect(d.finished).toEqual([{ ids: ['m1', 'm2', 'm3'], result: { status: 'completed' } }]);
  });

  it('flushes at maxWaitMs even while messages keep arriving', async () => {
    const d = createInboxDriver({ merge: { ...MERGE, maxSenders: 10 } });
    d.say('u0', 'q0', mention);
    for (let index = 1; index <= 5; index += 1) {
      await d.advance(1_000);
      d.say(`u${index}`, `q${index}`, mention);
    }
    await d.advance(1_000);
    const run = d.current()!;
    expect(run.control.facts.queuedMs).toBe(6_000);
    expect(run.participants).toHaveLength(6);
  });

  it('folds a sender burst into their own entry instead of adding a sender', async () => {
    const d = createInboxDriver({ merge: MERGE });
    d.say('alice', '帮我看下', mention);
    d.say('bob', '我也想问', mention);
    d.say('alice', '明天的安排', mention);
    await d.advance(1_500);
    const run = d.current()!;
    expect(run.participants.map((p) => [p.senderId, p.texts])).toEqual([
      ['alice', ['帮我看下', '明天的安排']],
      ['bob', ['我也想问']],
    ]);
    expect(run.control.facts).toMatchObject({ mergedMessages: 3, queuedMs: 1_500 });
  });

  it('keeps the window open while a turn runs and flushes it after release', async () => {
    const d = createInboxDriver({ merge: MERGE });
    d.say('owner', '主人的问题');
    await tick();
    const master = d.current()!;
    d.say('alice', 'a', mention);
    d.say('bob', 'b', mention);
    await d.advance(10_000);
    expect(d.runs).toHaveLength(1);
    await d.release(master);
    expect(d.current()!.senders).toEqual(['alice', 'bob']);
  });

  it('never lets a merged turn be superseded by one of its senders', async () => {
    const d = createInboxDriver({ merge: MERGE });
    d.say('alice', 'a', mention);
    await d.advance(1_500);
    const run = d.current()!;
    expect(d.say('alice', 'ai: 换个问题').result).toMatchObject({ disposition: 'queued' });
    expect(run.signal.aborted).toBe(false);
    await d.release(run);
    expect(d.current()!.text).toBe('ai: 换个问题');
  });

  it('moves senders past maxSenders into the next window', async () => {
    const d = createInboxDriver({ merge: MERGE });
    d.say('u1', '1', mention);
    d.say('u2', '2', mention);
    d.say('u3', '3', mention);
    expect(d.say('u4', '4', mention).result).toMatchObject({ disposition: 'queued' });
    expect(d.say('u1', '1+', mention).result).toMatchObject({ disposition: 'merged' });
    await d.advance(1_500);
    const run1 = d.current()!;
    expect(run1.participants.map((p) => [p.senderId, p.texts.length])).toEqual([['u1', 2], ['u2', 1], ['u3', 1]]);
    await d.release(run1);
    const run2 = d.current()!;
    expect(run2.senders).toEqual(['u4']);
    expect(run2.text).toBe('4');
  });

  it('keeps non-mergeable messages FIFO behind an open window', async () => {
    const d = createInboxDriver({ merge: MERGE });
    d.say('alice', 'a', mention);
    d.say('bob', '[图片]', { plainText: false });
    await d.advance(1_500);
    const run = d.current()!;
    expect(run.senders).toEqual(['alice']);
    expect(d.runs).toHaveLength(1);
    await d.release(run);
    expect(d.current()!.text).toBe('[图片]');
  });

  it('counts windows against maxQueuedTurns', async () => {
    const d = createInboxDriver({ maxQueuedTurns: 1, merge: { ...MERGE, maxSenders: 1 } });
    d.say('alice', 'a', mention);
    expect(d.say('bob', 'b', mention).result).toMatchObject({ accepted: false, code: 'queue_full' });
  });

  it('expires a window that waited past the queue ttl', async () => {
    const d = createInboxDriver({ merge: MERGE }, { queueTtlMs: 5_000 });
    d.say('owner', 'x');
    await tick();
    const running = d.current()!;
    const carrier = d.say('alice', 'a', mention).mail;
    await d.advance(6_000);
    await d.release(running);
    expect(d.droppedReason(carrier)).toBe('expired');
  });

  it('drops only the stopping sender from a waiting window', async () => {
    const d = createInboxDriver({ merge: MERGE });
    d.say('alice', 'a', mention);
    await d.advance(1_500);
    const run = d.current()!;
    d.say('alice', 'again', mention);
    d.say('bob', 'b', mention);
    expect(d.say('alice', '/stop', { isStop: true }).result).toMatchObject({ disposition: 'stopped' });
    await d.release(run);
    await d.advance(1_500);
    const after = d.current()!;
    expect(after.senders).toEqual(['bob']);
    expect(after.text).toBe('b');
  });

  it('rejects a window when every sender in it stopped', async () => {
    const d = createInboxDriver({ merge: MERGE });
    d.say('alice', 'a', mention);
    await d.advance(1_500);
    const run = d.current()!;
    const next = d.say('alice', 'again', mention).mail;
    d.say('alice', '/stop', { isStop: true });
    await tick();
    expect(d.droppedReason(next)).toBe('stopped');
    await d.release(run);
    await d.advance(10_000);
    expect(d.runs).toHaveLength(1);
  });

  it('ignores `mergeable` when no merge window is configured (#725 behaviour)', async () => {
    const d = createInboxDriver();
    d.say('alice', 'a', mention);
    await tick();
    const first = d.current()!;
    d.say('bob', 'b', mention);
    await d.release(first);
    const run = d.current()!;
    expect(run.text).toBe('b');
    expect(run.participants.map((p) => p.senderId)).toEqual(['bob']);
  });

  it('lists each sender\'s message ids for the merged turn context (ADR 0038 §3)', async () => {
    const d = createInboxDriver({ merge: MERGE });
    d.say('alice', 'a', { ...mention, messageId: 'p1' });
    d.say('bob', 'b', mention);
    d.say('alice', 'a2', { ...mention, messageId: 'p3' });
    await d.advance(1_500);
    expect(d.current()!.participants.map(({ senderId, texts, messageIds }) => ({ senderId, texts, messageIds }))).toEqual([
      { senderId: 'alice', texts: ['a', 'a2'], messageIds: ['p1', 'p3'] },
      { senderId: 'bob', texts: ['b'], messageIds: undefined },
    ]);
  });

  it('keeps each sender\'s own mails (and so their authority) in participants (ADR 0038 §2)', async () => {
    const d = createInboxDriver({ merge: MERGE });
    const a = d.say('alice', 'a', mention).mail;
    const b = d.say('bob', 'b', mention).mail;
    const b2 = d.say('bob', 'b2', mention).mail;
    await d.advance(1_500);
    const run = d.current()!;
    expect(run.participants.map((p) => p.mails)).toEqual([[a], [b, b2]]);
    expect(run.participants[1]!.mails[0]!.authority.principal.id).toBe('bob');
  });

  it('cancels window timers on close', async () => {
    const d = createInboxDriver({ merge: MERGE });
    const carrier = d.say('alice', 'a', mention).mail;
    await tick();
    expect(d.pendingTimers()).toBe(1);
    await d.box.close('bye');
    expect(d.droppedReason(carrier)).toBe('closed');
    expect(d.pendingTimers()).toBe(0);
    await d.advance(10_000);
    expect(d.runs).toHaveLength(0);
  });
});

describe('inbox stale reply (ADR 0038 §4)', () => {
  const MERGE = { quietMs: 1_500, maxWaitMs: 6_000, maxSenders: 3 };
  const mention = { mergeable: true } as const;

  async function startMerged() {
    const d = createInboxDriver({ merge: MERGE });
    d.say('alice', 'a1', { ...mention, messageId: 'p1' });
    d.say('bob', 'b1', { ...mention, messageId: 'p2' });
    await d.advance(1_500);
    return { d, run: d.current()! };
  }

  it('stays fresh when nobody it answers follows up', async () => {
    const { d, run } = await startMerged();
    d.say('carol', 'c1', mention);
    expect(run.control.staleCheck()).toEqual({ kind: 'fresh' });
  });

  it('drops the reply when an answered sender follows up, and answers old and new messages together', async () => {
    const { d, run } = await startMerged();
    d.say('alice', 'a2', { ...mention, messageId: 'p3' });
    expect(run.control.staleCheck()).toEqual({ kind: 'discard', senders: ['alice'] });
    // Later sends of the same turn are dropped as well.
    expect(run.control.staleCheck()).toEqual({ kind: 'discard', senders: ['alice'] });
    await d.release(run);
    // The discarded turn reports nothing; its mails ride with the follow-up.
    expect(d.finished).toEqual([]);
    await d.advance(1_500);
    const next = d.current()!;
    expect(next.participants.map(({ senderId, texts, messageIds }) => ({ senderId, texts, messageIds }))).toEqual([
      { senderId: 'alice', texts: ['a1', 'a2'], messageIds: ['p1', 'p3'] },
      { senderId: 'bob', texts: ['b1'], messageIds: ['p2'] },
    ]);
    expect(next.control.facts.carried).toBe(true);
    await d.release(next);
    expect(d.finished).toEqual([{ ids: ['m1', 'm2', 'm3'], result: { status: 'completed' } }]);
  });

  it('drops a reply at most once per sender chain (starvation guard)', async () => {
    const { d, run } = await startMerged();
    d.say('alice', 'a2', mention);
    expect(run.control.staleCheck().kind).toBe('discard');
    await d.release(run);
    await d.advance(1_500);
    const second = d.current()!;
    d.say('bob', 'b2', mention);
    expect(second.control.staleCheck()).toEqual({ kind: 'send', senders: ['bob'], reason: 'starvation' });
    await d.release(second);
    await d.advance(1_500);
    const third = d.current()!;
    // The guard is spent once the senders were answered: a new chain may be dropped again.
    d.say('bob', 'b3', mention);
    expect(third.control.staleCheck().kind).toBe('discard');
  });

  it('sends a stale reply when the turn already acted (tool call / hard gate)', async () => {
    const { d, run } = await startMerged();
    run.control.markActed();
    d.say('bob', 'b2', mention);
    expect(run.control.staleCheck()).toEqual({ kind: 'send', senders: ['bob'], reason: 'acted' });
  });

  it('does not cut a reply in half once part of it was delivered', async () => {
    const { d, run } = await startMerged();
    run.control.markDelivered();
    d.say('alice', 'a2', mention);
    expect(run.control.staleCheck()).toEqual({ kind: 'fresh' });
  });

  it('keeps the reply when the follow-up left the queue', async () => {
    const { d, run } = await startMerged();
    const followUp = d.say('alice', 'a2', mention).mail;
    expect(d.say('alice', '/stop', { isStop: true }).result).toMatchObject({ disposition: 'stopped' });
    await tick();
    expect(d.droppedReason(followUp)).toBe('stopped');
    expect(run.control.staleCheck()).toEqual({ kind: 'fresh' });
  });

  it('applies to an ordinary turn whose sender follows up into a window', async () => {
    const d = createInboxDriver({ merge: MERGE });
    d.say('alice', 'a1', mention);
    await d.advance(1_500);
    const run = d.current()!;
    d.say('alice', 'a2', mention);
    expect(run.control.staleCheck().kind).toBe('discard');
    await d.release(run);
    await d.advance(1_500);
    expect(d.current()!.text).toBe('a1\na2');
  });

  it('never marks a turn stale while no merge window is configured', async () => {
    const d = createInboxDriver();
    d.say('alice', 'a1');
    await tick();
    const run = d.current()!;
    d.say('bob', 'b1');
    expect(run.control.staleCheck()).toEqual({ kind: 'fresh' });
  });
});

describe('inbox danmaku window (ADR 0038 §5)', () => {
  const LIVE = { lane: 'bilibili:live:room:1', live: true } as const;
  const opts = { merge: { quietMs: 1_500, maxWaitMs: 6_000, maxSenders: 5 }, live: { windowMs: 10_000, minIntervalMs: 15_000 } };

  it('answers 50 danmaku in 10 seconds with one turn and counts every candidate', async () => {
    const d = createInboxDriver(opts);
    d.say('v0', '主播好', LIVE);
    for (let index = 1; index < 50; index += 1) {
      await d.advance(200);
      expect(d.say(`v${index % 20}`, `弹幕${index}`, LIVE).result).toMatchObject({ disposition: 'merged' });
    }
    expect(d.runs).toHaveLength(0);
    await d.advance(10_000 - 49 * 200);
    const run = d.current()!;
    expect(run.control.facts).toMatchObject({ mergedMessages: 50, evicted: 0, queuedMs: 10_000 });
    expect(run.participants).toHaveLength(20);
  });

  it('has no sender limit and ignores the merge window quiet time', async () => {
    const d = createInboxDriver(opts);
    d.say('v0', 'a', LIVE);
    for (let index = 1; index <= 8; index += 1) d.say(`v${index}`, 'x', LIVE);
    await d.advance(1_500);
    expect(d.runs).toHaveLength(0);
    await d.advance(8_500);
    expect(d.current()!.participants).toHaveLength(9);
  });

  it('keeps at most LIVE_WINDOW_MAX_MESSAGES danmaku, evicting the oldest', async () => {
    const d = createInboxDriver(opts);
    const first = d.say('v0', 'first', { ...LIVE, messageId: 'd0' }).mail;
    for (let index = 1; index < 120; index += 1) d.say(`v${index}`, `d${index}`, { ...LIVE, messageId: `d${index}` });
    await d.advance(10_000);
    const run = d.current()!;
    expect(run.control.facts).toMatchObject({ mergedMessages: 100, evicted: 20 });
    expect(run.senders.includes('v0')).toBe(false);
    expect(run.participants.at(-1)).toMatchObject({ senderId: 'v119', messageIds: ['d119'] });
    expect(d.droppedReason(first)).toBe('evicted');
  });

  it('collects danmaku while a turn runs and waits minIntervalMs after it ended', async () => {
    const d = createInboxDriver(opts);
    d.say('v1', 'q1', LIVE);
    await d.advance(10_000);
    const run = d.current()!;
    d.say('v2', 'q2', LIVE);
    await d.advance(12_000);
    await d.release(run);
    // Window age is already past windowMs, but the previous reply ended just now.
    await d.advance(14_999);
    expect(d.runs).toHaveLength(1);
    await d.advance(1);
    expect(d.current()!.control.facts.mergedMessages).toBe(1);
  });

  it('never marks a danmaku turn stale or supersedes it', async () => {
    const d = createInboxDriver(opts);
    d.say('v1', 'q1', LIVE);
    await d.advance(10_000);
    const run = d.current()!;
    d.say('v2', 'opens the next window', LIVE);
    expect(d.say('v1', 'q2', LIVE).result).toMatchObject({ disposition: 'merged' });
    expect(run.signal.aborted).toBe(false);
    expect(run.control.staleCheck()).toEqual({ kind: 'fresh' });
  });

  it('leaves non-live messages to the ordinary and merge paths', async () => {
    const d = createInboxDriver(opts);
    d.say('streamer', '我来了', { lane: LIVE.lane });
    await tick();
    expect(d.current()!.text).toBe('我来了');
  });

  it('ignores `live` when no danmaku window is configured', async () => {
    const d = createInboxDriver({ merge: opts.merge });
    d.say('v1', 'q1', LIVE);
    await tick();
    expect(d.current()!.text).toBe('q1');
  });

  it('forgets a lane\'s last reply once minIntervalMs passed', async () => {
    const d = createInboxDriver(opts);
    d.say('v1', 'q1', LIVE);
    await d.advance(10_000);
    await d.release(d.current()!);
    await d.advance(15_000);
    d.say('v2', 'q2', LIVE);
    await d.advance(10_000);
    expect(d.current()!.control.facts.queuedMs).toBe(10_000);
  });
});
