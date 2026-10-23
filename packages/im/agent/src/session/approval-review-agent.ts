import type {
  ApprovalHistoryEntry,
  ApprovalJudgmentPort,
  ApprovalReviewDecision,
} from '../decision/approval-judgment.js';
import {
  approvalOutcomeToDecision,
  isApprovalPortAvailable,
  requestApprovalOutcome,
  type ApprovalDecision,
  type ApprovalOutcome,
  type ApprovalOutcomePort,
  type ApprovalPort,
  type ApprovalRequestInput,
} from './approval-port.js';

export type { ApprovalReviewDecision } from '../decision/approval-judgment.js';

export interface ApprovalReviewAgentOptions {
  readonly judgment: ApprovalJudgmentPort;
  readonly timeoutMs?: number;
}

/** Tool-less, fail-closed reviewer used by approvalMode=auto. */
export class ApprovalReviewAgent {
  readonly #judgment: ApprovalJudgmentPort;
  readonly #timeoutMs: number;
  readonly #memory: ApprovalHistoryEntry[] = [];

  constructor(options: ApprovalReviewAgentOptions) {
    this.#judgment = options.judgment;
    this.#timeoutMs = options.timeoutMs ?? 30_000;
  }

  async review(
    input: ApprovalRequestInput,
    judgment: ApprovalJudgmentPort = this.#judgment,
  ): Promise<ApprovalReviewDecision> {
    const timeoutMs = Math.min(input.timeoutMs ?? this.#timeoutMs, this.#timeoutMs);
    const controller = new AbortController();
    const abort = () => controller.abort(input.signal.reason);
    const timer = setTimeout(() => controller.abort(new Error('Approval review timed out')), timeoutMs);
    input.signal.addEventListener('abort', abort, { once: true });
    try {
      input.signal.throwIfAborted();
      const result = await settleBeforeAbort(
        judgment.judge({ request: input, priorDecisions: this.#history(input), signal: controller.signal }),
        controller.signal,
        { decision: 'reject' as const, reason: 'Approval review cancelled' },
      );
      return !controller.signal.aborted && (result.decision === 'approve' || result.decision === 'ask')
        ? result.decision
        : 'reject';
    } catch {
      return 'reject';
    } finally {
      clearTimeout(timer);
      input.signal.removeEventListener('abort', abort);
    }
  }

  recall(input: ApprovalRequestInput): boolean | undefined {
    if (!input.scopeKey) return undefined;
    let match: ApprovalHistoryEntry | undefined;
    for (let index = this.#memory.length - 1; index >= 0; index -= 1) {
      const entry = this.#memory[index];
      if (entry?.toolName === input.toolName
        && entry.scopeKey === input.scopeKey
        && this.#covers(entry, input)) {
        match = entry;
        break;
      }
    }
    if (!match) return undefined;
    return match.decision !== 'reject';
  }

  remember(
    input: ApprovalRequestInput,
    decision: ApprovalDecision,
    source: ApprovalHistoryEntry['source'] = 'human',
  ): void {
    if (decision !== 'approve-once'
      && (!input.sessionKey || !input.requesterId || !input.scopeKey)) return;
    this.#memory.push(Object.freeze({
      sessionKey: input.sessionKey,
      requesterId: input.requesterId,
      toolName: input.toolName,
      scopeKey: input.scopeKey,
      question: input.question,
      decision,
      source,
    }));
    if (this.#memory.length > 256) this.#memory.splice(0, this.#memory.length - 256);
  }

  #history(input: ApprovalRequestInput): readonly ApprovalHistoryEntry[] {
    return this.#memory.filter(entry =>
      (input.sessionKey != null && entry.sessionKey === input.sessionKey)
    ).slice(-12);
  }

  #covers(entry: ApprovalHistoryEntry, input: ApprovalRequestInput): boolean {
    if (entry.decision === 'approve-session') {
      return entry.sessionKey != null && entry.sessionKey === input.sessionKey;
    }
    if (entry.decision === 'approve-always') {
      return entry.sessionKey === input.sessionKey && entry.requesterId === input.requesterId;
    }
    if (entry.decision === 'reject') {
      return entry.source === 'human'
        && entry.sessionKey === input.sessionKey && entry.requesterId === input.requesterId;
    }
    return false;
  }
}

export function createAutoApprovalPort(
  reviewer: ApprovalReviewAgent,
  ask?: ApprovalPort,
  judgment?: ApprovalJudgmentPort,
): ApprovalOutcomePort {
  const port: ApprovalOutcomePort = {
    available: true,
    async requestApprovalOutcome(input: ApprovalRequestInput): Promise<ApprovalOutcome> {
      try {
        input.signal.throwIfAborted();
        if (input.humanOnly) {
          return isApprovalPortAvailable(ask)
            ? await settleWithinTimeout(requestApprovalOutcome(ask, input), input)
            : { status: 'unavailable', reason: 'this tool requires fresh human approval' };
        }
        const recalled = reviewer.recall(input);
        if (recalled !== undefined) {
          return recalled
            ? { status: 'approved', decision: 'approve-once' }
            : { status: 'denied', by: 'remembered' };
        }
        // The reviewer bounds its own judgment; a human escalation is bounded only
        // by an explicit request timeout, otherwise by the approval surface itself.
        const decision = await reviewer.review(input, judgment);
        if (decision === 'approve') {
          reviewer.remember(input, 'approve-once', 'reviewer');
          return { status: 'approved', decision: 'approve-once' };
        }
        if (decision === 'ask') {
          if (!isApprovalPortAvailable(ask)) {
            return { status: 'unavailable', reason: 'the reviewer escalated to a human, but nobody can be asked here' };
          }
          const outcome = await settleWithinTimeout(requestApprovalOutcome(ask, input), input);
          // Only an explicit human answer is remembered; a timeout is not a "no".
          if (outcome.status === 'approved' || (outcome.status === 'denied' && outcome.by === 'user')) {
            reviewer.remember(input, approvalOutcomeToDecision(outcome), 'human');
          }
          return outcome;
        }
        reviewer.remember(input, 'reject', 'reviewer');
        return { status: 'denied', by: 'reviewer' };
      } catch {
        return { status: 'unavailable', reason: 'approval review failed' };
      }
    },
    async requestApproval(input: ApprovalRequestInput) {
      return (await port.requestApprovalOutcome(input)).status === 'approved';
    },
  };
  return Object.freeze(port);
}

export function createBypassApprovalPort(ask?: ApprovalPort): ApprovalOutcomePort {
  const port: ApprovalOutcomePort = {
    available: true,
    async requestApprovalOutcome(input) {
      if (input.signal.aborted) return { status: 'unavailable', reason: 'approval request cancelled' };
      if (input.humanOnly) return isApprovalPortAvailable(ask)
        ? requestApprovalOutcome(ask, input)
        : { status: 'unavailable', reason: 'this tool requires fresh human approval' };
      return { status: 'approved', decision: 'approve-once' };
    },
    requestApproval: async input => (await port.requestApprovalOutcome(input)).status === 'approved',
  };
  return Object.freeze(port);
}


async function settleBeforeAbort<T>(
  result: Promise<T>,
  signal: AbortSignal,
  cancelled: T,
): Promise<T> {
  return await new Promise<T>((resolve) => {
    let settled = false;
    const finish = (value: T) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', deny);
      resolve(value);
    };
    const deny = () => finish(cancelled);
    signal.addEventListener('abort', deny, { once: true });
    // Always attach rejection handling, including when cancellation won the race.
    void result.then(value => finish(value), () => finish(cancelled));
    if (signal.aborted) deny();
  });
}

/** Bound a human escalation by the caller's explicit timeout; cancellation stays fail-closed. */
async function settleWithinTimeout(
  result: Promise<ApprovalOutcome>,
  input: ApprovalRequestInput,
): Promise<ApprovalOutcome> {
  const cancelled: ApprovalOutcome = { status: 'unavailable', reason: 'the turn was cancelled' };
  const timedOut: ApprovalOutcome = { status: 'timed_out' };
  return await new Promise<ApprovalOutcome>((resolve) => {
    let settled = false;
    const timer = input.timeoutMs === undefined
      ? undefined
      : setTimeout(() => finish(timedOut), input.timeoutMs);
    const onAbort = () => finish(cancelled);
    function finish(value: ApprovalOutcome) {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      input.signal.removeEventListener('abort', onAbort);
      resolve(value);
    }
    input.signal.addEventListener('abort', onAbort, { once: true });
    void result.then(finish, () => finish({ status: 'unavailable', reason: 'the approval prompt failed' }));
    if (input.signal.aborted) onAbort();
  });
}
