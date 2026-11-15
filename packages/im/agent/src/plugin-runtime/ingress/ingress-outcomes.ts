/**
 * ADR 0061 P2: outcome candidates of the Agent ingress (gates, admission, model turn). The
 * candidates go to the message's Core ledger through `reportInboundOutcome`; Core settles them.
 */
import type { MessageOutcomeCandidate } from '@zhin.js/core/runtime';
import { chatFailureKindOf } from '../../outbound/chat-failure.js';
import type { TurnOutcome } from '../../turn/turn-ingress.js';
import { completedOutput } from './content.js';
import { TriggerTimeoutError } from './unified-mailbox-spine.js';

const TIMEOUT_KINDS: ReadonlySet<string> = new Set(['timeout', 'no_response']);

/** A completed turn: `replied`, or `model_silent` when it produced no output element. */
export function turnSuccessOutcome(outcome: TurnOutcome, turnId: string, merged: boolean): MessageOutcomeCandidate {
  let elements = 0;
  try { elements = completedOutput(outcome).length; } catch { elements = 0; }
  return elements === 0
    ? { outcome: 'model_silent', reason: 'empty_output', stage: 'model', turnId }
    : { outcome: 'replied', reason: merged ? 'agent_merged' : 'agent', stage: 'model', turnId };
}

/** A failed or replaced turn (ADR 0061 §1.2 / §1.3); `ChatFailureKind` maps timeouts to `model_timeout`. */
export function turnFailureOutcome(error: unknown, aborted: boolean, turnId: string): MessageOutcomeCandidate {
  if (aborted) return { outcome: 'superseded', reason: 'model_superseded', stage: 'model', turnId };
  if (error instanceof TriggerTimeoutError) return { outcome: 'model_timeout', reason: 'turn_timeout', stage: 'model', turnId };
  const message = error instanceof Error ? error.message : String(error);
  const budget = /^Agent turn exceeded budget: (.+)$/u.exec(message);
  if (budget) return { outcome: 'budget_exhausted', reason: `budget_exceeded:${budget[1]}`, stage: 'model', turnId };
  const kind = chatFailureKindOf(message);
  if (TIMEOUT_KINDS.has(kind)) {
    return { outcome: 'model_timeout', reason: kind === 'timeout' ? 'request_timeout' : 'no_response', stage: 'model', turnId, detail: message };
  }
  return { outcome: 'model_error', reason: kind, stage: 'model', turnId, detail: message };
}
