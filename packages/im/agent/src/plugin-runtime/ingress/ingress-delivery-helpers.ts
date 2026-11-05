import type { Locale } from '@zhin.js/plugin-runtime';
import {
  createBypassApprovalPort,
  REACTION_SEGMENT_TYPE,
  type AgentOutputElement,
  type ApprovalPort,
} from '../../index.js';
import { noteTurnTrace } from '../../trace/index.js';
import {
  isActingTurnEvent,
  type TurnAdmission,
  type TurnStaleVerdict,
} from '../../turn/index.js';
import type { DecisionAudit } from './decision-audit.js';
import { ingressMessages as t } from './ingress-messages.js';
import type { observeAgentTurnTrace } from './ports.js';

/** The emoji of a reaction-only message from the structured reply, if this message is one. */
export function reactionOf(output: readonly AgentOutputElement[]): string | undefined {
  if (output.length !== 1) return undefined;
  const element = output[0]!;
  if (element.type !== 'message' || element.segments.length !== 1) return undefined;
  const segment = element.segments[0]!;
  if (segment.type !== REACTION_SEGMENT_TYPE) return undefined;
  const emoji = (segment.data as { emoji?: unknown }).emoji;
  return typeof emoji === 'string' && emoji ? emoji : undefined;
}

export function admissionRejectionNotice(
  reason: 'queue_full' | 'expired' | 'stopped',
  locale?: Locale,
): string | undefined {
  if (reason !== 'stopped') return t(locale, reason);
  return undefined;
}

/** ADR 0038 §4 / §6: a stale reply that was dropped, or sent anyway because the turn acted or the sender was dropped once. */
export function auditStaleReply(
  audit: DecisionAudit,
  verdict: Exclude<TurnStaleVerdict, { kind: 'fresh' }>,
): void {
  if (verdict.kind === 'discard') {
    audit({ kind: 'outbound', outcome: 'skip', reasonCode: 'merge_reply_stale_discarded', payload: { senders: verdict.senders } });
  } else {
    audit({ kind: 'outbound', outcome: 'allow', reasonCode: 'merge_reply_stale_sent', payload: { senders: verdict.senders, reason: verdict.reason } });
  }
}

/**
 * Records how the turn was admitted on its TurnTrace once the trace exists,
 * and tells the gate when the turn acts (ADR 0038 §4: such replies are never dropped).
 */
export function observeWithAdmission(
  observe: ReturnType<typeof observeAgentTurnTrace>,
  turnId: string,
  admission: Extract<TurnAdmission, { kind: 'run' }> | undefined,
): ReturnType<typeof observeAgentTurnTrace> {
  if (!admission) return observe;
  const facts = admission.facts;
  const noteFacts = facts.queuedMs > 0 || facts.mergedMessages > 1 || facts.supersededPrevious;
  let noted = !noteFacts;
  return (event) => {
    if (isActingTurnEvent(event)) admission.markActed();
    if (!noted) {
      noted = true;
      noteTurnTrace(turnId, {
        kind: 'admission',
        queued_ms: facts.queuedMs,
        merged_messages: facts.mergedMessages,
        superseded_previous: facts.supersededPrevious,
        ...(facts.mergeWindow ? { merged_senders: facts.mergeWindow.senders.length } : {}),
      });
    }
    observe(event);
  };
}

export function resolveApprovalPort(input: Readonly<{
  mode: 'ask' | 'auto' | 'bypass';
  ask: ApprovalPort;
  auto: ApprovalPort;
}>): ApprovalPort {
  if (input.mode === 'auto') return input.auto;
  if (input.mode === 'bypass') return createBypassApprovalPort(input.ask);
  return input.ask;
}

/** A danmaku turn cannot ask anyone: every approval request is unavailable. */
export const NO_APPROVAL_PORT: ApprovalPort = Object.freeze({
  available: false,
  requestApproval: async () => false,
});
