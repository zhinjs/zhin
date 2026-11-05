import { describe, expect, it } from 'vitest';
import {
  LIVE_WINDOW_MAX_MESSAGES,
  TurnAdmissionGate,
  type TurnAdmission,
  type TurnAdmissionRequest,
} from '../../src/turn/turn-admission-gate.js';
import { TriggerCancelledError } from '../../src/turn/trigger-cancelled-error.js';
import { TurnSupersededError } from '../../src/turn/prompt-controller.js';
import type { TurnAccessContext } from '../../src/turn/turn-ingress.js';

type RunAdmission = Extract<TurnAdmission, { kind: 'run' }>;

const SESSION = 'qq:bot:group:42';

function message(senderId: string, text: string, plainText = true): TurnAdmissionRequest {
  return { sessionKey: SESSION, senderId, text, plainText };
}

function createGate(overrides: Partial<ConstructorParameters<typeof TurnAdmissionGate>[0]> = {}) {
  let clock = 0;
  const gate = new TurnAdmissionGate({
    maxQueuedTurns: 5,
    queueTtlMs: 180_000,
    supersedeSameSender: true,
    now: () => clock,
    ...overrides,
  });
  return { gate, advance: (ms: number) => { clock += ms; } };
}

async function expectRun(admission: Promise<TurnAdmission>): Promise<RunAdmission> {
  const result = await admission;
  expect(result.kind).toBe('run');
  return result as RunAdmission;
}

function isSettled(promise: Promise<unknown>): Promise<boolean> {
  const marker = Symbol('pending');
  return Promise.race([promise.then(() => true), Promise.resolve(marker)]).then((value) => value !== marker);
}

describe('TurnAdmissionGate (#725)', () => {
  it('runs a message on an idle session immediately', async () => {
    const { gate } = createGate();
    const run = await expectRun(gate.admit(message('alice', '你好')));
    expect(run.text).toBe('你好');
    expect(run.facts).toEqual({ queuedMs: 0, mergedMessages: 1, supersededPrevious: false });
    expect(gate.runningSender(SESSION)).toBe('alice');
    run.release();
    expect(gate.runningSender(SESSION)).toBeUndefined();
  });

  it('merges a sender follow-up into one fresh turn when nothing was delivered yet', async () => {
    const { gate } = createGate();
    const first = await expectRun(gate.admit(message('alice', '帮我查明天的天气')));
    const second = gate.admit(message('alice', '还有后天的'));

    expect(first.signal.aborted).toBe(true);
    expect(first.signal.reason).toBeInstanceOf(TurnSupersededError);
    first.release();

    const replacement = await expectRun(second);
    expect(replacement.text).toBe('帮我查明天的天气\n还有后天的');
    expect(replacement.facts.supersededPrevious).toBe(true);
    expect(replacement.facts.mergedMessages).toBe(2);
  });

  it('queues a sender follow-up once the running turn has already replied', async () => {
    const { gate } = createGate();
    const first = await expectRun(gate.admit(message('alice', '第一个问题')));
    first.markDelivered();
    const second = gate.admit(message('alice', '第二个问题'));

    expect(first.signal.aborted).toBe(false);
    expect(await isSettled(second)).toBe(false);
    first.release();

    const next = await expectRun(second);
    expect(next.text).toBe('第二个问题');
    expect(next.facts.supersededPrevious).toBe(false);
  });

  it('never supersedes in fifo mode', async () => {
    const { gate } = createGate({ supersedeSameSender: false });
    const first = await expectRun(gate.admit(message('alice', 'a')));
    const second = gate.admit(message('alice', 'b'));
    expect(first.signal.aborted).toBe(false);
    first.release();
    expect((await expectRun(second)).text).toBe('b');
  });

  it('does not merge or supersede when attachments are involved', async () => {
    const { gate } = createGate();
    const first = await expectRun(gate.admit(message('alice', '看看这张图', false)));
    const second = gate.admit(message('alice', '说说看'));
    expect(first.signal.aborted).toBe(false);
    first.release();
    expect((await expectRun(second)).text).toBe('说说看');
  });

  it('never lets one member abort or merge into another member\'s turn', async () => {
    const { gate } = createGate();
    const alice = await expectRun(gate.admit(message('alice', 'alice 的问题')));
    const bob = gate.admit(message('bob', 'bob 的问题'));

    expect(alice.signal.aborted).toBe(false);
    alice.release();
    const bobRun = await expectRun(bob);
    expect(bobRun.text).toBe('bob 的问题');
  });

  it('answers a five-message group burst without duplicates, losses or crossed turns', async () => {
    const { gate, advance } = createGate();
    const first = await expectRun(gate.admit(message('alice', 'alice-1')));
    first.markDelivered();
    const burst = [
      gate.admit(message('bob', 'bob-1')),
      gate.admit(message('carol', 'carol-1')),
      gate.admit(message('bob', 'bob-2')),
      gate.admit(message('alice', 'alice-2')),
    ];
    advance(1_000);

    // bob-2 folds into bob's queued turn; nothing else merges across senders.
    expect((await burst[2]).kind).toBe('merged');

    const answered: string[][] = [['alice', first.text]];
    first.release();
    for (const index of [0, 1, 3]) {
      const run = await expectRun(burst[index]!);
      answered.push([gate.runningSender(SESSION)!, run.text]);
      run.release();
    }

    expect(answered).toEqual([
      ['alice', 'alice-1'],
      ['bob', 'bob-1\nbob-2'],
      ['carol', 'carol-1'],
      ['alice', 'alice-2'],
    ]);
    const texts = answered.flatMap(([, text]) => text!.split('\n'));
    expect(texts.sort()).toEqual(['alice-1', 'alice-2', 'bob-1', 'bob-2', 'carol-1']);
    expect(gate.queuedTurns(SESSION)).toBe(0);
  });

  it('reports queue wait time on the admitted turn', async () => {
    const { gate, advance } = createGate();
    const first = await expectRun(gate.admit(message('alice', 'a')));
    const second = gate.admit(message('bob', 'b'));
    advance(2_500);
    first.release();
    expect((await expectRun(second)).facts.queuedMs).toBe(2_500);
  });

  it('rejects messages beyond maxQueuedTurns with a visible reason', async () => {
    const { gate } = createGate({ maxQueuedTurns: 1 });
    const first = await expectRun(gate.admit(message('alice', 'a')));
    void gate.admit(message('bob', 'b'));
    await expect(gate.admit(message('carol', 'c'))).resolves.toEqual({ kind: 'rejected', reason: 'queue_full' });
    first.release();
  });

  it('drops queued turns that waited longer than the TTL', async () => {
    const { gate, advance } = createGate({ queueTtlMs: 1_000 });
    const first = await expectRun(gate.admit(message('alice', 'a')));
    const late = gate.admit(message('bob', 'b'));
    advance(1_001);
    first.release();
    await expect(late).resolves.toEqual({ kind: 'rejected', reason: 'expired' });
    expect(gate.runningSender(SESSION)).toBeUndefined();
  });

  describe('explicit stop', () => {
    it('lets the initiator stop their turn and drops their queued messages', async () => {
      const { gate } = createGate();
      const first = await expectRun(gate.admit(message('alice', 'a')));
      first.markDelivered();
      const queued = gate.admit(message('alice', 'b'));
      const other = gate.admit(message('bob', 'c'));

      expect(gate.stop(SESSION, 'alice', false)).toBe('stopped');
      expect(first.signal.reason).toBeInstanceOf(TriggerCancelledError);
      await expect(queued).resolves.toEqual({ kind: 'rejected', reason: 'stopped' });

      first.release();
      expect((await expectRun(other)).text).toBe('c');
    });

    it('does not let another member stop the turn', async () => {
      const { gate } = createGate();
      const first = await expectRun(gate.admit(message('alice', 'a')));
      expect(gate.stop(SESSION, 'bob', false)).toBe('forbidden');
      expect(first.signal.aborted).toBe(false);
      first.release();
    });

    it('lets the master stop any turn', async () => {
      const { gate } = createGate();
      const first = await expectRun(gate.admit(message('alice', 'a')));
      expect(gate.stop(SESSION, 'owner', true)).toBe('stopped');
      expect(first.signal.aborted).toBe(true);
      first.release();
    });

    it('reports when nothing is running', () => {
      const { gate } = createGate();
      expect(gate.stop(SESSION, 'alice', false)).toBe('not_running');
    });
  });

  it('keeps sessions independent', async () => {
    const { gate } = createGate();
    const group = await expectRun(gate.admit(message('alice', 'a')));
    const dm = await expectRun(gate.admit({ sessionKey: 'qq:bot:private:alice', senderId: 'alice', text: 'b', plainText: true }));
    expect(group.signal.aborted).toBe(false);
    group.release();
    dm.release();
  });

  it('release is idempotent', async () => {
    const { gate } = createGate();
    const first = await expectRun(gate.admit(message('alice', 'a')));
    const second = gate.admit(message('bob', 'b'));
    first.release();
    const bob = await expectRun(second);
    first.release();
    expect(gate.runningSender(SESSION)).toBe('bob');
    bob.release();
  });
});

describe('TurnAdmissionGate merge window (ADR 0038 §1)', () => {
  const MERGE = { quietMs: 1_500, maxWaitMs: 6_000, maxSenders: 3 };

  function createMergeGate(overrides: Partial<ConstructorParameters<typeof TurnAdmissionGate>[0]> = {}) {
    let clock = 0;
    let timers: Array<{ at: number; run: () => void; cancelled: boolean }> = [];
    const gate = new TurnAdmissionGate({
      maxQueuedTurns: 5,
      queueTtlMs: 180_000,
      supersedeSameSender: true,
      merge: MERGE,
      now: () => clock,
      setTimer: (run, delayMs) => {
        const timer = { at: clock + delayMs, run, cancelled: false };
        timers.push(timer);
        return () => { timer.cancelled = true; };
      },
      ...overrides,
    });
    const advance = (ms: number) => {
      const until = clock + ms;
      for (;;) {
        const due = timers
          .filter((timer) => !timer.cancelled && timer.at <= until)
          .sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        clock = due.at;
        due.cancelled = true;
        due.run();
      }
      clock = until;
      timers = timers.filter((timer) => !timer.cancelled);
    };
    return { gate, advance };
  }

  function mention(senderId: string, text: string, extra: Partial<TurnAdmissionRequest> = {}): TurnAdmissionRequest {
    return { sessionKey: SESSION, senderId, text, plainText: true, mergeable: true, ...extra };
  }

  it('waits for the window to go quiet, then answers every sender in one turn', async () => {
    const { gate, advance } = createMergeGate();
    const joined: number[] = [];
    const carrier = gate.admit(mention('alice', '今晚几点开会', { senderName: 'Alice', onWindowJoined: (w) => joined.push(w.senders.length) }));
    advance(500);
    await expect(gate.admit(mention('bob', '会议链接在哪', { onWindowJoined: (w) => joined.push(w.senders.length) })))
      .resolves.toEqual({ kind: 'merged' });
    advance(1_000);
    await expect(gate.admit(mention('carol', '我能旁听吗'))).resolves.toEqual({ kind: 'merged' });
    expect(await isSettled(carrier)).toBe(false);

    advance(1_499);
    expect(await isSettled(carrier)).toBe(false);
    advance(1);
    const run = await expectRun(carrier);
    expect(run.text).toBe('Alice: 今晚几点开会\nbob: 会议链接在哪\ncarol: 我能旁听吗');
    expect(run.participants.map((p) => p.senderId)).toEqual(['alice', 'bob', 'carol']);
    expect(run.facts).toEqual({
      queuedMs: 3_000,
      mergedMessages: 3,
      supersededPrevious: false,
      mergeWindow: { senders: ['alice', 'bob', 'carol'], messages: 3, waitedMs: 3_000 },
    });
    expect(joined).toEqual([1, 2]);
    run.release();
  });

  it('flushes at maxWaitMs even while messages keep arriving', async () => {
    const { gate, advance } = createMergeGate({ merge: { ...MERGE, maxSenders: 10 } });
    const carrier = gate.admit(mention('u0', 'q0'));
    for (let index = 1; index <= 5; index += 1) {
      advance(1_000);
      void gate.admit(mention(`u${index}`, `q${index}`));
    }
    advance(1_000);
    const run = await expectRun(carrier);
    expect(run.facts.mergeWindow?.waitedMs).toBe(6_000);
    expect(run.participants).toHaveLength(6);
    run.release();
  });

  it('folds a sender burst into their own entry instead of adding a sender', async () => {
    const { gate, advance } = createMergeGate();
    const carrier = gate.admit(mention('alice', '帮我看下'));
    await gate.admit(mention('bob', '我也想问'));
    await gate.admit(mention('alice', '明天的安排'));
    advance(1_500);
    const run = await expectRun(carrier);
    expect(run.participants).toEqual([
      { senderId: 'alice', texts: ['帮我看下', '明天的安排'] },
      { senderId: 'bob', texts: ['我也想问'] },
    ]);
    expect(run.facts.mergeWindow).toEqual({ senders: ['alice', 'bob'], messages: 3, waitedMs: 1_500 });
    run.release();
  });

  it('keeps the window open while a turn runs and flushes it after release', async () => {
    const { gate, advance } = createMergeGate();
    const master = await expectRun(gate.admit(message('owner', '主人的问题')));
    const carrier = gate.admit(mention('alice', 'a'));
    await gate.admit(mention('bob', 'b'));
    advance(10_000);
    expect(await isSettled(carrier)).toBe(false);
    master.release();
    const run = await expectRun(carrier);
    expect(run.participants.map((p) => p.senderId)).toEqual(['alice', 'bob']);
    run.release();
  });

  it('never lets a merged turn be superseded by one of its senders', async () => {
    const { gate, advance } = createMergeGate();
    const carrier = gate.admit(mention('alice', 'a'));
    advance(1_500);
    const run = await expectRun(carrier);
    const next = gate.admit(message('alice', 'ai: 换个问题'));
    expect(run.signal.aborted).toBe(false);
    run.release();
    expect((await expectRun(next)).text).toBe('ai: 换个问题');
  });

  it('moves senders past maxSenders into the next window', async () => {
    const { gate, advance } = createMergeGate();
    const first = gate.admit(mention('u1', '1'));
    await gate.admit(mention('u2', '2'));
    await gate.admit(mention('u3', '3'));
    const second = gate.admit(mention('u4', '4'));
    await gate.admit(mention('u1', '1+'));
    expect(gate.queuedTurns(SESSION)).toBe(2);
    advance(1_500);
    const run1 = await expectRun(first);
    expect(run1.participants.map((p) => [p.senderId, p.texts.length])).toEqual([['u1', 2], ['u2', 1], ['u3', 1]]);
    expect(await isSettled(second)).toBe(false);
    run1.release();
    const run2 = await expectRun(second);
    expect(run2.participants.map((p) => p.senderId)).toEqual(['u4']);
    expect(run2.text).toBe('4');
    run2.release();
  });

  it('keeps non-mergeable messages FIFO behind an open window', async () => {
    const { gate, advance } = createMergeGate();
    const carrier = gate.admit(mention('alice', 'a'));
    const media = gate.admit(message('bob', '[图片]', false));
    advance(1_500);
    const run = await expectRun(carrier);
    expect(await isSettled(media)).toBe(false);
    run.release();
    (await expectRun(media)).release();
  });

  it('counts windows against maxQueuedTurns', async () => {
    const { gate } = createMergeGate({ maxQueuedTurns: 1, merge: { ...MERGE, maxSenders: 1 } });
    void gate.admit(mention('alice', 'a'));
    await expect(gate.admit(mention('bob', 'b'))).resolves.toEqual({ kind: 'rejected', reason: 'queue_full' });
  });

  it('expires a window that waited past the queue ttl', async () => {
    const { gate, advance } = createMergeGate({ queueTtlMs: 5_000 });
    const running = await expectRun(gate.admit(message('owner', 'x')));
    const carrier = gate.admit(mention('alice', 'a'));
    advance(6_000);
    running.release();
    await expect(carrier).resolves.toEqual({ kind: 'rejected', reason: 'expired' });
  });

  it('drops only the stopping sender from a waiting window', async () => {
    const { gate, advance } = createMergeGate();
    const carrier = gate.admit(mention('alice', 'a'));
    advance(1_500);
    const run = await expectRun(carrier);
    const next = gate.admit(mention('alice', 'again'));
    await gate.admit(mention('bob', 'b'));
    expect(gate.stop(SESSION, 'alice', false)).toBe('stopped');
    run.release();
    advance(1_500);
    const after = await expectRun(next);
    expect(after.participants.map((p) => p.senderId)).toEqual(['bob']);
    expect(after.text).toBe('b');
    after.release();
  });

  it('rejects a window when every sender in it stopped', async () => {
    const { gate, advance } = createMergeGate();
    const carrier = gate.admit(mention('alice', 'a'));
    advance(1_500);
    const run = await expectRun(carrier);
    const next = gate.admit(mention('alice', 'again'));
    expect(gate.stop(SESSION, 'alice', false)).toBe('stopped');
    await expect(next).resolves.toEqual({ kind: 'rejected', reason: 'stopped' });
    run.release();
  });

  it('ignores `mergeable` when no merge window is configured (#725 behaviour)', async () => {
    const { gate } = createGate();
    const first = await expectRun(gate.admit(mention('alice', 'a')));
    const second = gate.admit(mention('bob', 'b'));
    first.release();
    const run = await expectRun(second);
    expect(run.text).toBe('b');
    expect(run.facts.mergeWindow).toBeUndefined();
    expect(run.participants).toEqual([{ senderId: 'bob', texts: ['b'] }]);
    run.release();
  });

  it('lists each sender\'s message ids for the merged turn context (ADR 0038 §3)', async () => {
    const { gate, advance } = createMergeGate();
    const carrier = gate.admit(mention('alice', 'a', { messageId: 'm1' }));
    await gate.admit(mention('bob', 'b'));
    await gate.admit(mention('alice', 'a2', { messageId: 'm3' }));
    advance(1_500);
    const run = await expectRun(carrier);
    expect(run.participants).toEqual([
      { senderId: 'alice', texts: ['a', 'a2'], messageIds: ['m1', 'm3'] },
      { senderId: 'bob', texts: ['b'] },
    ]);
    run.release();
  });

  it('carries each sender\'s own access into participants (ADR 0038 §2)', async () => {
    const { gate, advance } = createMergeGate();
    const access = (subjectId: string) => ({ principal: { subjectId } }) as unknown as TurnAccessContext;
    const alice = access('alice');
    const bob = access('bob');
    const carrier = gate.admit(mention('alice', 'a', { access: alice }));
    await expect(gate.admit(mention('bob', 'b', { access: bob }))).resolves.toEqual({ kind: 'merged' });
    // A burst keeps the access of the sender's first message.
    await expect(gate.admit(mention('bob', 'b2', { access: access('bob') }))).resolves.toEqual({ kind: 'merged' });
    advance(1_500);
    const run = await expectRun(carrier);
    expect(run.participants.map((p) => p.access)).toEqual([alice, bob]);
    expect(run.participants[1]!.access).toBe(bob);
    run.release();
  });

  it('cancels window timers on dispose', async () => {
    const { gate, advance } = createMergeGate();
    const carrier = gate.admit(mention('alice', 'a'));
    gate.dispose();
    await expect(carrier).resolves.toEqual({ kind: 'rejected', reason: 'stopped' });
    advance(10_000);
    expect(gate.queuedTurns(SESSION)).toBe(0);
  });
});

describe('TurnAdmissionGate stale reply (ADR 0038 §4)', () => {
  function createStaleGate() {
    let clock = 0;
    let timers: Array<{ at: number; run: () => void; cancelled: boolean }> = [];
    const gate = new TurnAdmissionGate({
      maxQueuedTurns: 5,
      queueTtlMs: 180_000,
      supersedeSameSender: true,
      merge: { quietMs: 1_500, maxWaitMs: 6_000, maxSenders: 3 },
      now: () => clock,
      setTimer: (run, delayMs) => {
        const timer = { at: clock + delayMs, run, cancelled: false };
        timers.push(timer);
        return () => { timer.cancelled = true; };
      },
    });
    const advance = (ms: number) => {
      const until = clock + ms;
      for (;;) {
        const due = timers.filter((t) => !t.cancelled && t.at <= until).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        clock = due.at;
        due.cancelled = true;
        due.run();
      }
      clock = until;
      timers = timers.filter((t) => !t.cancelled);
    };
    return { gate, advance };
  }

  function mention(senderId: string, text: string, extra: Partial<TurnAdmissionRequest> = {}): TurnAdmissionRequest {
    return { sessionKey: SESSION, senderId, text, plainText: true, mergeable: true, ...extra };
  }

  async function startMerged(gate: TurnAdmissionGate, advance: (ms: number) => void): Promise<RunAdmission> {
    const carrier = gate.admit(mention('alice', 'a1', { messageId: 'm1' }));
    await gate.admit(mention('bob', 'b1', { messageId: 'm2' }));
    advance(1_500);
    return expectRun(carrier);
  }

  it('stays fresh when nobody it answers follows up', async () => {
    const { gate, advance } = createStaleGate();
    const run = await startMerged(gate, advance);
    // A new sender queues behind, but does not make this reply stale.
    void gate.admit(mention('carol', 'c1'));
    expect(run.staleCheck()).toEqual({ kind: 'fresh' });
    run.release();
  });

  it('drops the reply when an answered sender follows up, and answers old and new messages together', async () => {
    const { gate, advance } = createStaleGate();
    const run = await startMerged(gate, advance);
    const followUp = gate.admit(mention('alice', 'a2', { messageId: 'm3' }));
    expect(run.staleCheck()).toEqual({ kind: 'discard', senders: ['alice'] });
    // Later sends of the same turn are dropped as well.
    expect(run.staleCheck()).toEqual({ kind: 'discard', senders: ['alice'] });
    run.release();
    advance(1_500);
    const next = await expectRun(followUp);
    expect(next.participants).toEqual([
      { senderId: 'alice', texts: ['a1', 'a2'], messageIds: ['m1', 'm3'] },
      { senderId: 'bob', texts: ['b1'], messageIds: ['m2'] },
    ]);
    next.release();
  });

  it('drops a reply at most once per sender chain (starvation guard)', async () => {
    const { gate, advance } = createStaleGate();
    const run = await startMerged(gate, advance);
    const followUp = gate.admit(mention('alice', 'a2'));
    expect(run.staleCheck().kind).toBe('discard');
    run.release();
    advance(1_500);
    const second = await expectRun(followUp);
    const again = gate.admit(mention('bob', 'b2'));
    expect(second.staleCheck()).toEqual({ kind: 'send', senders: ['bob'], reason: 'starvation' });
    second.release();
    advance(1_500);
    const third = await expectRun(again);
    // The guard is spent once the senders were answered: a new chain may be dropped again.
    void gate.admit(mention('bob', 'b3'));
    expect(third.staleCheck().kind).toBe('discard');
    third.release();
  });

  it('sends a stale reply when the turn already acted (tool call / hard gate)', async () => {
    const { gate, advance } = createStaleGate();
    const run = await startMerged(gate, advance);
    run.markActed();
    void gate.admit(mention('bob', 'b2'));
    expect(run.staleCheck()).toEqual({ kind: 'send', senders: ['bob'], reason: 'acted' });
    run.release();
  });

  it('does not cut a reply in half once part of it was delivered', async () => {
    const { gate, advance } = createStaleGate();
    const run = await startMerged(gate, advance);
    run.markDelivered();
    void gate.admit(mention('alice', 'a2'));
    expect(run.staleCheck()).toEqual({ kind: 'fresh' });
    run.release();
  });

  it('keeps the reply when the follow-up left the queue', async () => {
    const { gate, advance } = createStaleGate();
    const run = await startMerged(gate, advance);
    const followUp = gate.admit(mention('alice', 'a2'));
    expect(gate.stop(SESSION, 'alice', false)).toBe('stopped');
    await expect(followUp).resolves.toEqual({ kind: 'rejected', reason: 'stopped' });
    expect(run.staleCheck()).toEqual({ kind: 'fresh' });
    run.release();
  });

  it('applies to an ordinary turn whose sender follows up into a window', async () => {
    const { gate, advance } = createStaleGate();
    const carrier = gate.admit(mention('alice', 'a1'));
    advance(1_500);
    const run = await expectRun(carrier);
    const followUp = gate.admit(mention('alice', 'a2'));
    expect(run.staleCheck().kind).toBe('discard');
    run.release();
    advance(1_500);
    const next = await expectRun(followUp);
    expect(next.text).toBe('a1\na2');
    next.release();
  });

  it('never marks a turn stale while no merge window is configured', async () => {
    const { gate } = createGate();
    const run = await expectRun(gate.admit(message('alice', 'a1')));
    void gate.admit(message('bob', 'b1'));
    expect(run.staleCheck()).toEqual({ kind: 'fresh' });
    run.release();
  });
});

describe('TurnAdmissionGate danmaku window (ADR 0038 §5)', () => {
  const ROOM = 'bilibili:live:room:1';

  function createLiveGate(overrides: Partial<ConstructorParameters<typeof TurnAdmissionGate>[0]> = {}) {
    let clock = 0;
    let timers: Array<{ at: number; run: () => void; cancelled: boolean }> = [];
    const gate = new TurnAdmissionGate({
      maxQueuedTurns: 5,
      queueTtlMs: 180_000,
      supersedeSameSender: true,
      merge: { quietMs: 1_500, maxWaitMs: 6_000, maxSenders: 5 },
      live: { windowMs: 10_000, minIntervalMs: 15_000 },
      now: () => clock,
      setTimer: (run, delayMs) => {
        const timer = { at: clock + delayMs, run, cancelled: false };
        timers.push(timer);
        return () => { timer.cancelled = true; };
      },
      ...overrides,
    });
    const advance = (ms: number) => {
      const until = clock + ms;
      for (;;) {
        const due = timers.filter((t) => !t.cancelled && t.at <= until).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        clock = due.at;
        due.cancelled = true;
        due.run();
      }
      clock = until;
      timers = timers.filter((t) => !t.cancelled);
    };
    return { gate, advance };
  }

  function danmaku(senderId: string, text: string, extra: Partial<TurnAdmissionRequest> = {}): TurnAdmissionRequest {
    return { sessionKey: ROOM, senderId, text, plainText: true, live: true, ...extra };
  }

  it('answers 50 danmaku in 10 seconds with one turn and counts every candidate', async () => {
    const { gate, advance } = createLiveGate();
    const carrier = gate.admit(danmaku('v0', '主播好'));
    const others: Promise<TurnAdmission>[] = [];
    for (let index = 1; index < 50; index += 1) {
      advance(200);
      others.push(gate.admit(danmaku(`v${index % 20}`, `弹幕${index}`)));
    }
    for (const other of others) expect((await other).kind).toBe('merged');
    expect(await isSettled(carrier)).toBe(false);
    advance(10_000 - 49 * 200);
    const run = await expectRun(carrier);
    expect(run.facts.liveWindow).toEqual({ candidates: 50, kept: 50, senders: 20, waitedMs: 10_000 });
    expect(run.facts.mergeWindow).toBeUndefined();
    expect(run.participants).toHaveLength(20);
    run.release();
  });

  it('has no sender limit and ignores the merge window quiet time', async () => {
    const { gate, advance } = createLiveGate();
    const carrier = gate.admit(danmaku('v0', 'a'));
    for (let index = 1; index <= 8; index += 1) await gate.admit(danmaku(`v${index}`, 'x'));
    advance(1_500);
    expect(await isSettled(carrier)).toBe(false);
    advance(8_500);
    const run = await expectRun(carrier);
    expect(run.participants).toHaveLength(9);
    run.release();
  });

  it('keeps at most LIVE_WINDOW_MAX_MESSAGES danmaku, dropping the oldest', async () => {
    const { gate, advance } = createLiveGate();
    const carrier = gate.admit(danmaku('v0', 'first', { messageId: 'd0' }));
    for (let index = 1; index < LIVE_WINDOW_MAX_MESSAGES + 20; index += 1) {
      await gate.admit(danmaku(`v${index}`, `d${index}`, { messageId: `d${index}` }));
    }
    advance(10_000);
    const run = await expectRun(carrier);
    expect(run.facts.liveWindow).toMatchObject({ candidates: LIVE_WINDOW_MAX_MESSAGES + 20, kept: LIVE_WINDOW_MAX_MESSAGES });
    expect(run.participants.some((p) => p.senderId === 'v0')).toBe(false);
    expect(run.participants.at(-1)).toMatchObject({ senderId: `v${LIVE_WINDOW_MAX_MESSAGES + 19}`, messageIds: [`d${LIVE_WINDOW_MAX_MESSAGES + 19}`] });
    run.release();
  });

  it('collects danmaku while a turn runs and waits minIntervalMs after it ended', async () => {
    const { gate, advance } = createLiveGate();
    const first = gate.admit(danmaku('v1', 'q1'));
    advance(10_000);
    const run = await expectRun(first);

    const next = gate.admit(danmaku('v2', 'q2'));
    advance(12_000);
    run.release();
    // Window age is already past windowMs, but the previous reply ended just now.
    advance(14_999);
    expect(await isSettled(next)).toBe(false);
    advance(1);
    const second = await expectRun(next);
    expect(second.facts.liveWindow?.candidates).toBe(1);
    second.release();
  });

  it('never marks a danmaku turn stale or supersedes it', async () => {
    const { gate, advance } = createLiveGate();
    const first = gate.admit(danmaku('v1', 'q1'));
    advance(10_000);
    const run = await expectRun(first);
    void gate.admit(danmaku('v2', 'opens the next window'));
    expect((await gate.admit(danmaku('v1', 'q2'))).kind).toBe('merged');
    expect(run.signal.aborted).toBe(false);
    expect(run.staleCheck()).toEqual({ kind: 'fresh' });
    run.release();
  });

  it('leaves non-live messages to the ordinary and merge paths', async () => {
    const { gate } = createLiveGate();
    const run = await expectRun(gate.admit({ sessionKey: ROOM, senderId: 'streamer', text: '我来了', plainText: true }));
    expect(run.facts.liveWindow).toBeUndefined();
    run.release();
  });

  it('ignores `live` when no danmaku window is configured', async () => {
    const { gate } = createLiveGate({ live: undefined });
    const run = await expectRun(gate.admit(danmaku('v1', 'q1')));
    expect(run.facts.liveWindow).toBeUndefined();
    run.release();
  });

  it('forgets a room\'s last reply once minIntervalMs passed', async () => {
    const { gate, advance } = createLiveGate();
    const first = gate.admit(danmaku('v1', 'q1'));
    advance(10_000);
    (await expectRun(first)).release();
    advance(15_000);
    const next = gate.admit(danmaku('v2', 'q2'));
    advance(10_000);
    const run = await expectRun(next);
    expect(run.facts.liveWindow?.waitedMs).toBe(10_000);
    run.release();
  });
});
