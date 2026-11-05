import type { CoreReplyStream, ReplyStreamSnapshot } from '@zhin.js/core/runtime';
import type { AgentOutputElement } from '../outbound/agent-output.js';
import type { DeliveryOutcome } from '../turn/turn-ingress.js';
import type { ReplyStreamRun } from './reply-stream-run.js';

/** One immutable answer; retries stay inside its own candidate, follow-ups allocate another id. */
export interface ReplyAnswerPhase {
  readonly id: string;
  readonly run?: ReplyStreamRun;
  readonly snapshot?: ReplyStreamSnapshot;
  readonly output: readonly AgentOutputElement[];
  readonly reply: string;
}

export interface ReplyPhaseFacts {
  readonly delivery: DeliveryOutcome;
  readonly confirmedOutput: AgentOutputElement[];
  readonly messageId?: string;
  readonly messageIds?: readonly (string | null)[];
  readonly contextRefs?: readonly string[];
  readonly conversationSequence?: number;
  readonly conversationSequences?: readonly (number | null)[];
  readonly conversationKey?: string;
  readonly stopped?: true;
}

/** Turn-owned delivery owner; the model loop never replays a completed phase. */
export interface ReplyPhaseLifecycle {
  open(): { readonly id: string; readonly stream?: CoreReplyStream };
  settle(phase: ReplyAnswerPhase): Promise<ReplyPhaseFacts>;
}
