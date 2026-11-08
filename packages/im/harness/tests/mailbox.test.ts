import { createMailbox } from '../src/mailbox.js';
import type { ActorTurnResult, InboxReadyDecision, InboxView, Mail, MailboxKey, MailboxOptions } from '../src/contracts.js';

function mail(id: string, to: string, eng: string): Mail {
  return { id, to, engagementId: eng } as unknown as Mail;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
const tick = async (n = 5): Promise<void> => {
  for (let i = 0; i < n; i++) await Promise.resolve();
};
const ok: ActorTurnResult = { status: 'completed' };

interface Run {
  actor: string;
  ids: string[];
  signal: AbortSignal;
  d: Deferred<ActorTurnResult>;
}
function harness(opts: Partial<MailboxOptions> = {}, onError?: (e: unknown, c: string) => void) {
  const runs: Run[] = [];
  const finished: Array<{ key: MailboxKey; ids: string[]; result: ActorTurnResult }> = [];
  const box = createMailbox(
    {
      maxConcurrentTurns: 10,
      maxQueuedPerKey: 10,
      run: (actor, batch, signal) => {
        const d = deferred<ActorTurnResult>();
        runs.push({ actor, ids: batch.map((m) => m.id), signal, d });
        return d.promise;
      },
      onTurnFinished: (key, batch, result) => {
        finished.push({ key, ids: batch.map((m) => m.id), result });
      },
      ...opts,
    },
    { onError },
  );
  return { box, runs, finished };
}

describe('mailbox', () => {
  it('does not start synchronously inside post', async () => {
    const { box, runs } = harness();
    box.post(mail('1', 'a', 'e'));
    expect(runs).toHaveLength(0);
    await tick();
    expect(runs).toHaveLength(1);
  });

  it('serializes per key', async () => {
    const { box, runs } = harness();
    box.post(mail('1', 'a', 'e'));
    box.post(mail('2', 'a', 'e'));
    await tick();
    expect(runs.map((r) => r.ids)).toEqual([['1']]);
    runs[0].d.resolve(ok);
    await tick();
    expect(runs.map((r) => r.ids)).toEqual([['1'], ['2']]);
  });

  it('runs different keys in parallel (actor and engagement)', async () => {
    const { box, runs } = harness();
    box.post(mail('1', 'a', 'e1'));
    box.post(mail('2', 'a', 'e2'));
    box.post(mail('3', 'b', 'e1'));
    await tick();
    expect(runs).toHaveLength(3);
  });

  it('caps global concurrency and starts oldest-waiting key first', async () => {
    const { box, runs } = harness({ maxConcurrentTurns: 1 });
    box.post(mail('a1', 'a', 'e'));
    box.post(mail('a2', 'a', 'e'));
    box.post(mail('b1', 'b', 'e'));
    box.post(mail('c1', 'c', 'e'));
    await tick();
    expect(runs.map((r) => r.ids)).toEqual([['a1']]);
    runs[0].d.resolve(ok);
    await tick();
    expect(runs.map((r) => r.ids[0])).toEqual(['a1', 'a2']);
    runs[1].d.resolve(ok);
    await tick();
    expect(runs.map((r) => r.ids[0])).toEqual(['a1', 'a2', 'b1']);
    runs[2].d.resolve(ok);
    await tick();
    expect(runs.map((r) => r.ids[0])).toEqual(['a1', 'a2', 'b1', 'c1']);
  });

  it('fairness: a late mail of a busy key does not jump older keys', async () => {
    const { box, runs } = harness({ maxConcurrentTurns: 1 });
    box.post(mail('a1', 'a', 'e'));
    await tick();
    box.post(mail('b1', 'b', 'e'));
    box.post(mail('a2', 'a', 'e'));
    runs[0].d.resolve(ok);
    await tick();
    expect(runs.map((r) => r.ids[0])).toEqual(['a1', 'b1']);
  });

  it('applies the batch policy', async () => {
    const { box, runs } = harness({ policy: { ready: (v) => ({ kind: 'run', batch: v.pending.map((e) => e.mail) }) } });
    box.post(mail('1', 'a', 'e'));
    box.post(mail('2', 'a', 'e'));
    box.post(mail('3', 'a', 'e'));
    await tick();
    expect(runs[0].ids).toEqual(['1', '2', '3']);
  });

  it('falls back to the first mail on invalid batch selection', async () => {
    const errors: string[] = [];
    const run = (pick: (p: readonly Mail[]) => Mail[]) => (v: InboxView): InboxReadyDecision => ({ kind: 'run', batch: pick(v.pending.map((e) => e.mail)) });
    const bads: Array<(v: InboxView) => InboxReadyDecision> = [
      run(() => []),
      run((p) => [p[1]!]),
      run((p) => [p[1]!, p[0]!]),
      run(() => [mail('x', 'a', 'e')]),
      () => {
        throw new Error('boom');
      },
    ];
    for (const bad of bads) {
      const { box, runs } = harness({ policy: { ready: bad } }, (_e, c) => errors.push(c));
      box.post(mail('1', 'a', 'e'));
      box.post(mail('2', 'a', 'e'));
      await tick();
      expect(runs[0].ids).toEqual(['1']);
    }
    expect(errors).toHaveLength(5);
  });

  it('reports queue_full and positions', async () => {
    const { box } = harness({ maxQueuedPerKey: 2 });
    expect(box.post(mail('1', 'a', 'e'))).toEqual({ accepted: true, position: 1, disposition: 'queued' });
    expect(box.post(mail('2', 'a', 'e'))).toEqual({ accepted: true, position: 2, disposition: 'queued' });
    expect(box.post(mail('3', 'a', 'e'))).toMatchObject({ accepted: false, code: 'queue_full' });
    expect(box.post(mail('4', 'b', 'e'))).toEqual({ accepted: true, position: 1, disposition: 'queued' });
    await tick();
    // mail 1 left the queue when it started
    expect(box.post(mail('5', 'a', 'e'))).toEqual({ accepted: true, position: 2, disposition: 'queued' });
  });

  it('cancels a running mail via signal', async () => {
    const { box, runs, finished } = harness();
    box.post(mail('1', 'a', 'e'));
    await tick();
    expect(box.cancel('1', 'stop')).toBe(true);
    expect(runs[0].signal.aborted).toBe(true);
    expect(runs[0].signal.reason).toBe('stop');
    runs[0].d.resolve(ok);
    await tick();
    expect(finished[0].result.status).toBe('cancelled');
  });

  it('cancels a queued mail and reports it', async () => {
    const { box, runs, finished } = harness();
    box.post(mail('1', 'a', 'e'));
    box.post(mail('2', 'a', 'e'));
    await tick();
    expect(box.cancel('2', 'nah')).toBe(true);
    await tick();
    expect(finished).toHaveLength(1);
    expect(finished[0]).toMatchObject({ ids: ['2'], result: { status: 'cancelled' } });
    runs[0].d.resolve(ok);
    await tick();
    expect(runs).toHaveLength(1);
  });

  it('cancel of unknown mail returns false', () => {
    const { box } = harness();
    expect(box.cancel('nope')).toBe(false);
  });

  it('maps runner throw to failed', async () => {
    const { box, runs, finished } = harness();
    box.post(mail('1', 'a', 'e'));
    await tick();
    runs[0].d.reject(new Error('kaput'));
    await tick();
    expect(finished[0].result).toEqual({ status: 'failed', content: 'kaput' });
  });

  it('awaits onTurnFinished before the next turn and swallows its errors', async () => {
    const gate = deferred<void>();
    const errors: string[] = [];
    const { box, runs } = harness(
      {
        onTurnFinished: async () => {
          await gate.promise;
          throw new Error('hook');
        },
      },
      (_e, c) => errors.push(c),
    );
    box.post(mail('1', 'a', 'e'));
    box.post(mail('2', 'a', 'e'));
    await tick();
    runs[0].d.resolve(ok);
    await tick();
    expect(runs).toHaveLength(1);
    gate.resolve();
    await tick(10);
    expect(runs).toHaveLength(2);
    expect(errors).toEqual(['onTurnFinished']);
  });

  it('idle resolves immediately when idle and after work for many callers', async () => {
    const { box, runs } = harness();
    await box.idle();
    box.post(mail('1', 'a', 'e'));
    box.post(mail('2', 'a', 'e'));
    let n = 0;
    const p1 = box.idle().then(() => n++);
    const p2 = box.idle().then(() => n++);
    await tick();
    runs[0].d.resolve(ok);
    await tick();
    expect(n).toBe(0);
    runs[1].d.resolve(ok);
    await Promise.all([p1, p2]);
    expect(n).toBe(2);
  });

  it('close rejects posts, drops queue as cancelled, aborts running', async () => {
    const { box, runs, finished } = harness();
    box.post(mail('1', 'a', 'e'));
    box.post(mail('2', 'a', 'e'));
    await tick();
    let closedDone = false;
    const c = box.close('bye').then(() => {
      closedDone = true;
    });
    expect(box.post(mail('3', 'a', 'e'))).toMatchObject({ accepted: false, code: 'mailbox_closed' });
    expect(runs[0].signal.aborted).toBe(true);
    await tick();
    expect(closedDone).toBe(false);
    runs[0].d.resolve(ok);
    await c;
    expect(runs).toHaveLength(1);
    const byId = Object.fromEntries(finished.map((f) => [f.ids[0], f.result.status]));
    expect(byId).toEqual({ '1': 'cancelled', '2': 'cancelled' });
    await box.idle();
  });
});

describe('mailbox inbox policy plumbing (ADR 0048 H3)', () => {
  const human = (id: string, lane: string, eng: string): Mail =>
    ({ id, to: 'a', lane, engagementId: eng, from: { kind: 'human', principal: { kind: 'human', id: 'u', trust: 'stranger' } }, body: { kind: 'human', text: id, venue: { kind: 'g', id: '1' }, senderId: 'u' } }) as unknown as Mail;

  it('serializes one lane across engagements and reports the first engagement', async () => {
    const { box, runs, finished } = harness();
    box.post(human('1', 'L', 'e1'));
    box.post(human('2', 'L', 'e2'));
    await tick();
    expect(runs.map((r) => r.ids)).toEqual([['1']]);
    runs[0].d.resolve(ok);
    await tick();
    expect(finished[0].key).toEqual({ actor: 'a', lane: 'L', engagementId: 'e1' });
    expect(runs.map((r) => r.ids)).toEqual([['1'], ['2']]);
  });

  it('waits on the injected timer and does not hold a slot while waiting', async () => {
    let clock = 0;
    const timers: Array<{ at: number; fn: () => void }> = [];
    const { box, runs } = harness({
      maxConcurrentTurns: 1,
      now: () => clock,
      setTimer: (fn, ms) => {
        const t = { at: clock + ms, fn };
        timers.push(t);
        return () => timers.splice(timers.indexOf(t), 1);
      },
      policy: {
        ready: (v) => (v.key.lane === 'slow' && v.now < 100 ? { kind: 'wait', until: 100 } : { kind: 'run', batch: [v.pending[0]!.mail] }),
      },
    });
    box.post(human('s', 'slow', 'e1'));
    box.post(human('f', 'fast', 'e2'));
    await tick();
    expect(runs.map((r) => r.ids[0])).toEqual(['f']);
    expect(timers.map((t) => t.at)).toEqual([100]);
    runs[0].d.resolve(ok);
    await tick();
    clock = 100;
    timers.shift()!.fn();
    await tick();
    expect(runs.map((r) => r.ids[0])).toEqual(['f', 's']);
  });

  it('falls back to enqueue / fresh when policy callbacks throw', async () => {
    const errors: string[] = [];
    const { box, runs } = harness(
      {
        policy: {
          onPost: () => { throw new Error('post'); },
        },
      },
      (_e, c) => errors.push(c),
    );
    expect(box.post(human('1', 'L', 'e1'))).toMatchObject({ accepted: true, disposition: 'queued' });
    await tick();
    expect(runs).toHaveLength(1);
    expect(errors).toEqual(['onPost']);
  });

  it('applies reject decisions without queueing', () => {
    const { box } = harness({ policy: { onPost: () => ({ kind: 'reject', code: 'forbidden', message: 'no' }) } });
    expect(box.post(human('1', 'L', 'e1'))).toEqual({ accepted: false, code: 'forbidden', message: 'no' });
  });

  it('cancelling a superseded mail drops its requeued copy, not the aborted turn', async () => {
    const { box, runs, finished } = harness({ policy: { onPost: (_e, v) => (v.running ? { kind: 'supersede' } : { kind: 'enqueue' }), ready: (v) => ({ kind: 'run', batch: v.pending.map((e) => e.mail) }) } });
    box.post(human('1', 'L', 'e1'));
    await tick();
    expect(box.post(human('2', 'L', 'e2'))).toEqual({ accepted: true, position: 2, disposition: 'superseded' });
    expect(runs[0].signal.reason).toBe('superseded');
    expect(box.cancel('1', 'nah')).toBe(true);
    runs[0].d.resolve(ok);
    await tick();
    expect(finished.map((f) => [f.ids, f.result.status])).toEqual([[['1'], 'cancelled']]);
    expect(runs[1].ids).toEqual(['2']);
  });

  it('hands the runner a control with facts and a default fresh stale check', async () => {
    const controls: Array<Parameters<MailboxOptions['run']>[3]> = [];
    const box = createMailbox({ maxConcurrentTurns: 1, maxQueuedPerKey: 5, now: () => 100, run: async (_a, _b, _s, control) => { controls.push(control); return ok; } });
    box.post(mail('1', 'a', 'e'));
    await box.idle();
    expect(controls[0]!.facts).toEqual({ queuedMs: 0, mergedMessages: 1, supersededPrevious: false, carried: false, evicted: 0 });
    expect(controls[0]!.staleCheck()).toEqual({ kind: 'fresh' });
  });
});
