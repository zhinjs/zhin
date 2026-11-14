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
  type TurnAdmissionRejectReason,
  type TurnStaleVerdict,
} from '../../turn/index.js';
import type { DecisionAudit } from './decision-audit.js';
import { ingressMessages as t } from './unified-mailbox-spine.js';
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
  reason: TurnAdmissionRejectReason,
  locale?: Locale,
): string | undefined {
  // `stopped` has its own notice; `not_addressed` is never shown.
  if (reason === 'queue_full' || reason === 'expired') return t(locale, reason);
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
 * and tells the mailbox when the turn acts (ADR 0038 §4: such replies are never dropped).
 */
/** The inbound message that started a turn, as {@link observeWithAdmission} records it (#1250). */
export interface TurnTriggerFacts {
  readonly text: string;
  readonly senderId?: string;
  readonly senderName?: string;
  readonly conversation?: Readonly<{ kind: string; id: string }>;
  readonly messageId?: string;
  /** Epoch milliseconds the runtime received the message. */
  readonly receivedAt?: number;
}

export function observeWithAdmission(
  observe: ReturnType<typeof observeAgentTurnTrace>,
  turnId: string,
  admission: Extract<TurnAdmission, { kind: 'run' }> | undefined,
  trigger?: TurnTriggerFacts,
): ReturnType<typeof observeAgentTurnTrace> {
  if (!admission && !trigger) return observe;
  const facts = admission?.facts;
  let noted = false;
  return (event) => {
    if (isActingTurnEvent(event)) admission?.markActed();
    if (!noted) {
      noted = true;
      if (trigger) {
        noteTurnTrace(turnId, {
          kind: 'trigger',
          text: trigger.text,
          ...(trigger.senderId ? { sender_id: trigger.senderId } : {}),
          ...(trigger.senderName ? { sender_name: trigger.senderName } : {}),
          ...(trigger.conversation ? { conversation: `${trigger.conversation.kind}:${trigger.conversation.id}` } : {}),
          ...(trigger.messageId ? { message_id: trigger.messageId } : {}),
          ...(trigger.receivedAt !== undefined ? { received_at: trigger.receivedAt } : {}),
          ...(facts ? { merged_messages: facts.mergedMessages, queued_ms: facts.queuedMs } : {}),
        });
      }
      if (facts && (facts.queuedMs > 0 || facts.mergedMessages > 1 || facts.supersededPrevious)) {
        noteTurnTrace(turnId, {
          kind: 'admission',
          queued_ms: facts.queuedMs,
          merged_messages: facts.mergedMessages,
          superseded_previous: facts.supersededPrevious,
          ...(facts.mergeWindow ? { merged_senders: facts.mergeWindow.senders.length } : {}),
        });
      }
    }
    observe(event);
  };
}

export function resolveApprovalPort(input: Readonly<{
  mode: 'ask' | 'auto' | 'bypass';
  ask: ApprovalPort;
  auto: ApprovalPort;
  /**
   * #1250: the turn's initiator is the global master. `bypass` then hands `intent` confirmations
   * (high-risk actions after external content) to `ask`, which confirms them with the master once.
   * `auto` is unchanged: its reviewer decides.
   */
  masterInitiator?: boolean;
}>): ApprovalPort {
  if (input.mode === 'auto') return input.auto;
  if (input.mode === 'bypass') return createBypassApprovalPort(input.ask, input.masterInitiator ? { confirmIntent: true } : {});
  return input.ask;
}

/** A danmaku turn cannot ask anyone: every approval request is unavailable. */
export const NO_APPROVAL_PORT: ApprovalPort = Object.freeze({
  available: false,
  requestApproval: async () => false,
});
