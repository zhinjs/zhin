/**
 * #1250 `interaction-timeout-reported-as-internal-error`: a prompt that timed out, was cancelled,
 * interrupted by a new message or superseded by a newer prompt ends the asking command, handler or
 * middleware normally. The inbound runtime records it as `interaction_timeout` /
 * `interaction_cancelled` (INFO, no failure banner, not counted as a failure), never as
 * `internal_error`. Errors are matched by `name` so a second copy of the module still matches.
 */
import { formatCompact, getLogger } from '@zhin.js/logger';
import type { MessageOutcomeCandidate, MessageOutcomeStage } from './message-outcome.js';

const logger = getLogger('im.inbound');

export type InteractionEndReason = 'timeout' | 'cancelled' | 'interrupted' | 'superseded';

export interface InteractionEnd {
  readonly outcome: 'interaction_timeout' | 'interaction_cancelled';
  readonly reason: InteractionEndReason;
}

/** The expected end an interaction error stands for, or `undefined` for any other error. */
export function interactionEndOf(error: unknown): InteractionEnd | undefined {
  if (!(error instanceof Error)) return undefined;
  switch (error.name) {
    case 'UserInteractionTimeoutError':
      return { outcome: 'interaction_timeout', reason: 'timeout' };
    case 'UserInteractionCancelledError':
      return { outcome: 'interaction_cancelled',
        reason: (error as { reason?: unknown }).reason === 'interrupted' ? 'interrupted' : 'cancelled' };
    case 'UserInteractionSupersededError':
      return { outcome: 'interaction_cancelled', reason: 'superseded' };
    default:
      return undefined;
  }
}

/** The outcome candidate of an ended interaction, logged once at INFO. */
export function interactionEndCandidate(
  end: InteractionEnd,
  stage: MessageOutcomeStage,
  owner?: string,
): MessageOutcomeCandidate {
  logger.info(formatCompact({ op: 'interaction_ended', outcome: end.outcome, reason: end.reason, stage, owner }));
  return { outcome: end.outcome, reason: end.reason, stage, ...(owner ? { owner } : {}) };
}
