import type {
  ApprovalHistoryEntry,
  ApprovalJudgmentPort,
  ApprovalReviewDecision,
} from '../decision/approval-judgment.js';
import type {
  ApprovalDecision,
  ApprovalDecisionPort,
  ApprovalPort,
  ApprovalRequestInput,
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
): ApprovalPort {
  return Object.freeze({
    available: true,
    async requestApproval(input: ApprovalRequestInput) {
      const timeoutMs = input.timeoutMs ?? 30_000;
      const controller = new AbortController();
      const abort = () => controller.abort(input.signal.reason);
      const timer = setTimeout(() => controller.abort(new Error('Approval timed out')), timeoutMs);
      input.signal.addEventListener('abort', abort, { once: true });
      const scopedInput = { ...input, timeoutMs, signal: controller.signal };
      try {
        input.signal.throwIfAborted();
        const recalled = reviewer.recall(scopedInput);
        if (recalled !== undefined) return recalled;
        const decision = await reviewer.review(scopedInput, judgment);
        if (decision === 'approve') {
          reviewer.remember(scopedInput, 'approve-once', 'reviewer');
          return true;
        }
        if (decision === 'ask' && isApprovalPortAvailable(ask)) {
          const humanDecision = await settleDecisionBeforeAbort(
            requestDecision(ask, scopedInput),
            controller.signal,
          );
          reviewer.remember(scopedInput, humanDecision, 'human');
          return humanDecision !== 'reject';
        }
        reviewer.remember(scopedInput, 'reject', 'reviewer');
        return false;
      } catch {
        return false;
      } finally {
        clearTimeout(timer);
        input.signal.removeEventListener('abort', abort);
      }
    },
  });
}

export function createBypassApprovalPort(): ApprovalPort {
  return Object.freeze({
    available: true,
    requestApproval: async () => true,
  });
}

function isApprovalPortAvailable(port: ApprovalPort | undefined): port is ApprovalPort {
  return Boolean(port && port.available !== false);
}

function requestDecision(
  port: ApprovalPort,
  input: ApprovalRequestInput,
): Promise<ApprovalDecision> {
  const decisionPort = port as Partial<ApprovalDecisionPort>;
  if (typeof decisionPort.requestApprovalDecision === 'function') {
    return decisionPort.requestApprovalDecision(input);
  }
  return port.requestApproval(input).then(approved => approved ? 'approve-once' : 'reject');
}

function settleDecisionBeforeAbort(
  result: Promise<ApprovalDecision>,
  signal: AbortSignal,
): Promise<ApprovalDecision> {
  return settleBeforeAbort(result, signal, 'reject');
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
