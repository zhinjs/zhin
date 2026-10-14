import { describe, expect, it } from 'vitest';
import {
  TurnAdmissionGate,
  type TurnAdmission,
  type TurnAdmissionRequest,
} from '../../src/turn/turn-admission-gate.js';
import { TriggerCancelledError } from '../../src/turn/trigger-cancelled-error.js';
import { TurnSupersededError } from '../../src/turn/prompt-controller.js';

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
