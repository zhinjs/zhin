/**
 * Multi-message ingress evals (#725).
 *
 * `runEvalCase` drives one engine turn per inbound message. This driver
 * feeds several timed messages through the same host Mailbox protocol the
 * IM ingress route uses (ADR 0048 H3, `HostMailbox` in
 * `plugin-runtime/ingress/ingress-route.ts`): an explicit cancel intent calls
 * `mailbox.stop`, everything else calls `mailbox.admit`; `merged` and
 * `rejected` admissions produce no turn, and a `run` admission executes one
 * real agent turn (via `runEvalCase`, scripted model) with the admitted —
 * possibly merged — text, then releases the Mail turn.
 *
 * Time is virtual: message arrival (`at`) and turn duration (`turnMs`) are
 * milliseconds on a deterministic clock that also drives the mailbox queue TTL.
 */
import { evalSenderRoles } from './driver.js';
import { isCancelIntent } from '../../src/turn/cancel-intent.js';
import { HostMailbox } from '../../src/collaboration/host-mailbox.js';
import { DEFAULT_MAILBOX_CONFIG } from '../../src/turn/mailbox-config.js';
import {
  DEFAULT_MAX_QUEUED_TURNS,
  type TurnAdmission,
  type TurnAdmissionFacts,
  type TurnStopResult,
} from '../../src/turn/turn-admission.js';
import { runEvalCase } from './driver.js';

export interface IngressEvalMessage {
  /** Arrival time on the virtual clock (ms). */
  readonly at: number;
  readonly sender: Readonly<{ id: string; roles?: readonly string[]; chatRole?: 'owner' | 'admin' | 'trusted' }>;
  readonly text: string;
  /** Media/quote/forward messages are never merged. Default true. */
  readonly plainText?: boolean;
}

export type IngressTurnStatus = 'completed' | 'cancelled';

export interface IngressEvalTurn {
  readonly sender: string;
  readonly text: string;
  readonly status: IngressTurnStatus;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly facts: TurnAdmissionFacts;
  /** Agent reply for a completed turn. */
  readonly reply?: string;
}

export interface IngressEvalExpectations {
  /** Turns in start order. Omitted fields are not checked. */
  readonly turns?: readonly Readonly<{
    sender: string;
    text?: string;
    status?: IngressTurnStatus;
    mergedMessages?: number;
    supersededPrevious?: boolean;
  }>[];
  /** `sender:text` of every message folded into a queued turn. */
  readonly merged?: readonly string[];
  /** `sender:reason` of every rejected message, in order. */
  readonly rejected?: readonly string[];
  /** `sender:result` of every cancel intent, in order. */
  readonly stops?: readonly string[];
  /** Notices sent to users (`queue_full`, `expired`, stop confirmation), in order. */
  readonly notices?: readonly string[];
}

export interface IngressEvalCase {
  readonly id: string;
  readonly description: string;
  readonly source: string;
  readonly scope?: 'private' | 'group';
  /** How long each running turn takes on the virtual clock. */
  readonly turnMs: number;
  readonly gate?: Partial<Readonly<{ maxQueuedTurns: number; queueTtlMs: number; supersedeSameSender: boolean }>>;
  readonly messages: readonly IngressEvalMessage[];
  readonly expect: IngressEvalExpectations;
}

export function defineIngressEvalCase(definition: IngressEvalCase): IngressEvalCase {
  return definition;
}

export interface IngressEvalRun {
  readonly turns: readonly IngressEvalTurn[];
  readonly merged: readonly string[];
  readonly rejected: readonly string[];
  readonly stops: readonly string[];
  readonly notices: readonly string[];
}

/** Same user-facing notices as the IM ingress route. */
const REJECTION_NOTICE: Partial<Record<string, string>> = {
  queue_full: '前面还有几条消息在处理，请稍后再发。',
  expired: '这条消息排队太久，已跳过，需要的话请重新发送。',
};
const STOP_NOTICE = '好的，已停止当前回复。';

interface Running {
  readonly sender: string;
  readonly admission: Extract<TurnAdmission, { kind: 'run' }>;
  readonly startedAt: number;
  readonly endsAt: number;
}

/** Lets the Mailbox finish the harness hops of earlier calls. */
const flush = async () => {
  for (let index = 0; index < 8; index += 1) await new Promise<void>((resolve) => setImmediate(resolve));
};

export async function runIngressEvalCase(definition: IngressEvalCase): Promise<IngressEvalRun> {
  let now = 0;
  const gate = new HostMailbox({
    config: {
      ...DEFAULT_MAILBOX_CONFIG,
      groupMode: (definition.gate?.supersedeSameSender ?? true) ? 'supersede' : 'fifo',
      ttlMs: definition.gate?.queueTtlMs ?? 0,
      maxQueuedTurns: definition.gate?.maxQueuedTurns ?? DEFAULT_MAX_QUEUED_TURNS,
      merge: { ...DEFAULT_MAILBOX_CONFIG.merge, enabled: false },
    },
    now: () => now,
  });
  const sessionKey = `eval:${definition.scope ?? 'group'}:${definition.id}`;
  const turns: IngressEvalTurn[] = [];
  const merged: string[] = [];
  const rejected: string[] = [];
  const stops: string[] = [];
  const notices: string[] = [];
  const roles = new Map(definition.messages.map((message) => [message.sender.id, evalSenderRoles(message.sender)]));
  let running: Running | undefined;
  let turnIndex = 0;

  const finish = async (status: IngressTurnStatus) => {
    const current = running!;
    running = undefined;
    let reply: string | undefined;
    if (status === 'completed') {
      reply = await runAgentTurn(definition, current.sender, roles.get(current.sender) ?? ['user'], current.admission.text, ++turnIndex);
      current.admission.markDelivered();
    }
    turns.push({
      sender: current.sender,
      text: current.admission.text,
      status,
      startedAt: current.startedAt,
      endedAt: now,
      facts: current.admission.facts,
      ...(reply !== undefined ? { reply } : {}),
    });
    current.admission.release(status);
    await flush();
  };

  const start = (sender: string, admission: Extract<TurnAdmission, { kind: 'run' }>) => {
    running = { sender, admission, startedAt: now, endsAt: now + definition.turnMs };
  };

  const handle = (admission: TurnAdmission, message: IngressEvalMessage) => {
    const sender = message.sender.id;
    if (admission.kind === 'merged') merged.push(`${sender}:${message.text}`);
    else if (admission.kind === 'rejected') {
      rejected.push(`${sender}:${admission.reason}`);
      const notice = REJECTION_NOTICE[admission.reason];
      if (notice) notices.push(notice);
    } else start(sender, admission);
  };

  const messages = [...definition.messages].sort((a, b) => a.at - b.at);
  let next = 0;
  while (next < messages.length || running) {
    // A running turn the mailbox aborted (superseded or stopped) ends now.
    if (running?.admission.signal.aborted) {
      await finish('cancelled');
      continue;
    }
    const arrival = messages[next];
    if (running && (!arrival || running.endsAt <= arrival.at)) {
      now = running.endsAt;
      await finish('completed');
      continue;
    }
    if (!arrival) break;
    now = arrival.at;
    next += 1;
    const sender = arrival.sender.id;
    const isMaster = evalSenderRoles(arrival.sender).includes('owner');
    if (isCancelIntent(arrival.text)) {
      await flush();
      const result: TurnStopResult = await gate.stop(sessionKey, sender, isMaster);
      stops.push(`${sender}:${result}`);
      if (result === 'stopped') {
        notices.push(STOP_NOTICE);
        await flush();
        continue;
      }
      // Nothing of the sender's to stop: an ordinary message, like the route.
    }
    // Queued admissions settle later, when the mailbox pumps them.
    void gate.admit({ sessionKey, senderId: sender, text: arrival.text, plainText: arrival.plainText ?? true })
      .then((admission) => handle(admission, arrival));
    await flush();
  }
  await gate.close();
  return { turns, merged, rejected, stops, notices };
}

async function runAgentTurn(
  definition: IngressEvalCase,
  sender: string,
  roles: readonly string[],
  text: string,
  index: number,
): Promise<string> {
  const run = await runEvalCase({
    id: `${definition.id}-turn-${index}`,
    description: definition.description,
    source: definition.source,
    inbound: { text, scope: definition.scope ?? 'group', sender: { id: sender, roles } },
    script: [{ text: `收到 ${sender}：${text}` }],
    expect: {},
  });
  const input = JSON.stringify(run.modelRequests[0] ?? '');
  if (!input.includes(JSON.stringify(text).slice(1, -1))) {
    throw new Error(`agent turn for ${sender} did not receive the admitted text "${text}"`);
  }
  return run.outbound.join('');
}

/** Readable mismatches between a run and the case's expectations. */
export function evaluateIngressExpectations(definition: IngressEvalCase, run: IngressEvalRun): string[] {
  const failures: string[] = [];
  const expect = definition.expect;
  const same = (label: string, actual: readonly string[], wanted: readonly string[] | undefined) => {
    if (wanted && actual.join('|') !== wanted.join('|')) {
      failures.push(`[${label}] expected [${wanted.join(', ')}], got [${actual.join(', ')}]`);
    }
  };
  if (expect.turns) {
    if (run.turns.length !== expect.turns.length) {
      failures.push(`[turns] expected ${expect.turns.length} turn(s), got ${run.turns.length}: ${describeTurns(run.turns)}`);
    }
    expect.turns.forEach((wanted, index) => {
      const actual = run.turns[index];
      if (!actual) return;
      const mismatch = (field: string, a: unknown, w: unknown) => {
        if (w !== undefined && a !== w) failures.push(`[turns[${index}].${field}] expected ${JSON.stringify(w)}, got ${JSON.stringify(a)}`);
      };
      mismatch('sender', actual.sender, wanted.sender);
      mismatch('text', actual.text, wanted.text);
      mismatch('status', actual.status, wanted.status);
      mismatch('mergedMessages', actual.facts.mergedMessages, wanted.mergedMessages);
      mismatch('supersededPrevious', actual.facts.supersededPrevious, wanted.supersededPrevious);
    });
  }
  same('merged', run.merged, expect.merged);
  same('rejected', run.rejected, expect.rejected);
  same('stops', run.stops, expect.stops);
  same('notices', run.notices, expect.notices);
  return failures;
}

function describeTurns(turns: readonly IngressEvalTurn[]): string {
  return turns.map((turn) => `${turn.sender}@${turn.startedAt}-${turn.endedAt} ${turn.status} "${turn.text}"`).join('; ');
}
