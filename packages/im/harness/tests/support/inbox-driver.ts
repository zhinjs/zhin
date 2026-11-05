/**
 * Test driver: a mailbox with an injectable clock / timers and a deferred
 * runner, so inbox-policy behaviour can be asserted step by step.
 */
import { createMailbox } from '../../src/mailbox.js';
import { createInboxPolicy, type InboxPolicyOptions } from '../../src/policies/admission.js';
import { participantsOf, renderInboxText, type InboxParticipant } from '../../src/policies/merge.js';
import type {
  ActorTurnControl,
  ActorTurnResult,
  Authority,
  Mail,
  MailboxOptions,
  PostResult,
} from '../../src/contracts.js';

export const LANE = 'qq:bot:group:42';
export const ok: ActorTurnResult = { status: 'completed' };

export interface HumanFlags {
  readonly plainText?: boolean;
  readonly mergeable?: boolean;
  readonly live?: boolean;
  readonly isMaster?: boolean;
  readonly isStop?: boolean;
  readonly unaddressed?: boolean;
  readonly messageId?: string;
  readonly senderName?: string;
  readonly lane?: string;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((a) => {
    resolve = a;
  });
  return { promise, resolve };
}

export interface DriverRun {
  readonly batch: readonly Mail[];
  readonly ids: readonly string[];
  readonly text: string;
  readonly participants: readonly InboxParticipant[];
  readonly senders: readonly string[];
  readonly signal: AbortSignal;
  readonly control: ActorTurnControl;
  readonly done: Deferred<ActorTurnResult>;
  ended: boolean;
}

export const tick = async (n = 20): Promise<void> => {
  for (let i = 0; i < n; i++) await Promise.resolve();
};

const authority = (id: string): Authority =>
  ({
    principal: { kind: 'human', id, trust: 'group_member' },
    trust: 'group_member',
    tools: { kind: 'all' },
    contacts: { kind: 'all' },
    egress: { network: false, hosts: { kind: 'all' } },
    approvers: [id],
    chain: [],
  }) as Authority;

export function humanMail(n: number, senderId: string, text: string, flags: HumanFlags = {}): Mail {
  return {
    id: `m${n}`,
    kind: 'human',
    engagementId: `e${n}`,
    from: { kind: 'human', principal: { kind: 'human', id: senderId, trust: 'group_member' } },
    to: 'zhin',
    lane: flags.lane ?? LANE,
    authority: authority(senderId),
    grantId: `g${n}`,
    body: {
      kind: 'human',
      text,
      venue: { kind: 'group', id: '42' },
      senderId,
      plainText: flags.plainText ?? true,
      ...(flags.mergeable ? { mergeable: true } : {}),
      ...(flags.live ? { live: true } : {}),
      ...(flags.isMaster ? { isMaster: true } : {}),
      ...(flags.isStop ? { isStop: true } : {}),
      ...(flags.unaddressed ? { unaddressed: true } : {}),
      ...(flags.messageId ? { messageId: flags.messageId } : {}),
      ...(flags.senderName ? { senderName: flags.senderName } : {}),
    },
    createdAt: 0,
  };
}

export function createInboxDriver(policy: Partial<InboxPolicyOptions> = {}, mailbox: Partial<MailboxOptions> = {}) {
  let clock = 0;
  let timers: Array<{ at: number; run: () => void; cancelled: boolean }> = [];
  let n = 0;
  const runs: DriverRun[] = [];
  const finished: Array<{ ids: string[]; result: ActorTurnResult }> = [];
  const errors: string[] = [];
  const box = createMailbox(
    {
      maxConcurrentTurns: 8,
      maxQueuedPerKey: 500,
      queueTtlMs: 180_000,
      now: () => clock,
      setTimer: (run, delayMs) => {
        const timer = { at: clock + delayMs, run, cancelled: false };
        timers.push(timer);
        return () => {
          timer.cancelled = true;
        };
      },
      policy: createInboxPolicy({ maxQueuedTurns: 5, supersedeSameSender: true, ...policy }),
      run: (_actor, batch, signal, control) => {
        const done = deferred<ActorTurnResult>();
        const participants = participantsOf(batch);
        const run: DriverRun = {
          batch,
          ids: batch.map((m) => m.id),
          text: renderInboxText(participants),
          participants,
          senders: participants.map((p) => p.senderId),
          signal,
          control: control!,
          done,
          ended: false,
        };
        runs.push(run);
        return done.promise;
      },
      onTurnFinished: (_key, batch, result) => {
        finished.push({ ids: batch.map((m) => m.id), result });
      },
      ...mailbox,
    },
    { onError: (_e, context) => errors.push(context) },
  );

  const say = (senderId: string, text: string, flags: HumanFlags = {}): { mail: Mail; result: PostResult } => {
    n += 1;
    const mail = humanMail(n, senderId, text, flags);
    return { mail, result: box.post(mail) };
  };

  const advance = async (ms: number): Promise<void> => {
    const until = clock + ms;
    for (;;) {
      await tick();
      const due = timers.filter((t) => !t.cancelled && t.at <= until).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      clock = due.at;
      due.cancelled = true;
      due.run();
    }
    clock = until;
    timers = timers.filter((t) => !t.cancelled);
    await tick();
  };

  const release = async (run: DriverRun, result: ActorTurnResult = ok): Promise<void> => {
    run.ended = true;
    run.done.resolve(result);
    await tick();
  };

  /** The turn currently running (at most one per lane in these tests). */
  const current = (): DriverRun | undefined => runs.filter((r) => !r.ended).at(-1);

  const droppedReason = (mail: Mail) => finished.find((f) => f.ids.includes(mail.id) && f.result.status === 'cancelled')?.result.reason;

  return { box, runs, finished, errors, say, advance, release, current, droppedReason, tick, now: () => clock, pendingTimers: () => timers.filter((t) => !t.cancelled).length };
}
