/**
 * ADR 0048 H3 — a ZhinAgent turn (`processTurn` / `processStream`) as a Mail
 * turn of the agent's host Mailbox. Same-session turns are serialized,
 * superseded or merged by the inbox policy exactly as IM ingress turns are;
 * the old `InboundTurnQueue` is gone.
 */
import { resolveIMSessionIdFromMessage } from '@zhin.js/core';
import type { HostMailbox } from '../collaboration/host-mailbox.js';
import { runInMailTurn } from '../collaboration/mail-turn-context.js';
import type { ZhinAgentEventEmitter } from '../event/event-emitter.js';
import type { Message } from '../resource-hub/types.js';
import type { TurnAdmissionRejectReason } from './turn-admission.js';

/** The mailbox refused the turn (queue full, expired, stopped, or the mailbox closed). */
export class MailboxTurnRejectedError extends Error {
  override readonly name = 'MailboxTurnRejectedError';
  constructor(readonly reason: TurnAdmissionRejectReason, sessionKey: string) {
    super(`turn not admitted (${reason}): ${sessionKey}`);
  }
}

export interface RunAsMailTurnOptions<T> {
  readonly content: string;
  readonly signal?: AbortSignal;
  readonly emitter?: ZhinAgentEventEmitter;
  /** Runs the turn with the (possibly merged) text; `signal` aborts on supersede / stop. */
  readonly run: (content: string, signal: AbortSignal) => Promise<T>;
  /** The message was merged into another sender's pending turn, which answers it. */
  readonly merged: () => T;
}

export async function runAsMailTurn<T>(
  mailbox: HostMailbox,
  commMessage: Message,
  options: RunAsMailTurnOptions<T>,
): Promise<T> {
  options.signal?.throwIfAborted();
  const sessionKey = resolveIMSessionIdFromMessage(commMessage);
  const senderId = commMessage.sender?.id ? String(commMessage.sender.id) : 'anonymous';
  const busy = mailbox.runningSender(sessionKey) !== undefined || mailbox.queuedMails(sessionKey) > 0;
  const emit = (event: 'ai.activity.queued.start' | 'ai.activity.queued.clear'): void => {
    if (!options.emitter) return;
    options.emitter.emit(event, options.emitter.createPayload(sessionKey, commMessage, 'text', {
      hookContext: { activityFeedbackEligible: true },
    }));
  };
  if (busy) emit('ai.activity.queued.start');
  let admission;
  try {
    admission = await mailbox.admit({
      sessionKey,
      senderId,
      text: options.content,
      plainText: true,
      ...(commMessage.sender?.name ? { senderName: commMessage.sender.name } : {}),
    });
  } finally {
    if (busy) emit('ai.activity.queued.clear');
  }
  if (admission.kind === 'merged') return options.merged();
  if (admission.kind === 'rejected') throw new MailboxTurnRejectedError(admission.reason, sessionKey);
  const turn = admission;
  const signal = options.signal ? AbortSignal.any([options.signal, turn.signal]) : turn.signal;
  let status: 'completed' | 'failed' | 'cancelled' = 'completed';
  try {
    return await runInMailTurn({ mailbox, mail: turn.mail, batch: turn.batch }, () =>
      options.run(turn.batch.length > 1 ? turn.text : options.content, signal));
  } catch (error) {
    status = signal.aborted ? 'cancelled' : 'failed';
    if (turn.signal.aborted && turn.signal.reason instanceof Error) throw turn.signal.reason;
    throw error;
  } finally {
    turn.release(status);
  }
}
