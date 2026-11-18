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
  /** The plugin whose prompt ended, when the asking operation is known (see {@link tagInteractionOwner}). */
  readonly owner?: string;
}

const INTERACTION_OWNER = Symbol.for('zhin.im.interactionOwner');

/**
 * Records which plugin asked on an interaction error before `ask()` rethrows it, so a command's
 * ended prompt names its owner like a middleware's or handler's does. Only errors
 * {@link interactionEndOf} recognises are tagged. A registered symbol, so a second copy of the
 * module still reads it; an owner already recorded is kept.
 */
export function tagInteractionOwner(error: unknown, owner: string | undefined): void {
  // Only an interaction end is tagged: any other error (a delivery failure, a caller's own error
  // passed through `signal`) is left exactly as it was thrown.
  if (!owner || !(error instanceof Error) || !interactionEndKind(error)
    || Object.prototype.hasOwnProperty.call(error, INTERACTION_OWNER)) return;
  try {
    Object.defineProperty(error, INTERACTION_OWNER, { value: owner, enumerable: false, configurable: true });
  } catch { /* A frozen error just stays without an owner. */ }
}

function interactionOwnerOf(error: Error): string | undefined {
  const owner = (error as unknown as Record<symbol, unknown>)[INTERACTION_OWNER];
  return typeof owner === 'string' && owner ? owner : undefined;
}

/** The expected end an interaction error stands for, or `undefined` for any other error. */
export function interactionEndOf(error: unknown): InteractionEnd | undefined {
  if (!(error instanceof Error)) return undefined;
  const end = interactionEndKind(error);
  if (!end) return undefined;
  const owner = interactionOwnerOf(error);
  return owner ? { ...end, owner } : end;
}

function interactionEndKind(error: Error): InteractionEnd | undefined {
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
