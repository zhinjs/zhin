import { EndpointDeliveryError, type ConversationRef, type DeliveryReceipt } from '@zhin.js/im-contract';
import type { Locale } from '@zhin.js/plugin-runtime';
import { turnReplyMessages } from '../core/turn-reply-messages.js';
import type { AgentLoopTurnResult } from '../core/agent-core-run.js';
import type { DeliveryOutcome, ReplyPort, ReplyAnswerContext } from '../turn/turn-ingress.js';
import type { AgentOutputElement } from './agent-output.js';

/** Settle the existing physical containers; never replay their planned full reply. */
export async function deliverProgressiveReply(
  progressive: NonNullable<AgentLoopTurnResult['progressive']>,
  output: readonly AgentOutputElement[],
  reply: ReplyPort,
  locale?: Locale,
  answer?: ReplyAnswerContext,
  conversation?: ConversationRef,
): Promise<{ delivery: DeliveryOutcome; confirmedOutput: AgentOutputElement[] }> {
  const { run, snapshot } = progressive;
  const send = (elements: readonly AgentOutputElement[]) => answer ? reply.send(elements, answer) : reply.send(elements);
  const receipt = snapshot ? await run.stream.finish(snapshot) : await run.stream.cancel();
  const confirmedOutput: AgentOutputElement[] = run.stream.confirmed.map(part => ({ type: 'message', segments: [...part.segments] }));
  const messages = receipt.parts?.map(part => part.message ?? null) ?? (receipt.message ? [receipt.message] : []);
  const contexts = run.stream.confirmed.flatMap(part => part.message && part.segments.length
    && part.segments.every(segment => segment.type === 'text')
    ? [{ message: part.message, plannedText: part.segments.map(segment => String((segment.data as Readonly<Record<string, unknown>>).text)).join('') }] : []);
  let delivery = deliveryFromReceipt(receipt, messages, contexts);
  // Reactions and legacy tool media are not in the model's message snapshots. Authorize and send
  // each through the ordinary reply port once, only after the stream has settled successfully.
  const remaining = output.filter(element => element.type !== 'message'
    || element.segments.length > 0 && element.segments.every(segment => segment.type === 'reaction'));
  if (remaining.length && (receipt.status === 'sent' || receipt.status === 'suppressed' && !confirmedOutput.length)) {
    let extra: DeliveryOutcome;
    try { extra = await send(remaining); }
    catch (error) {
      const known = error instanceof EndpointDeliveryError;
      const target = messages.find(message => message !== null)?.conversation ?? conversation;
      const completed = known ? error.parts?.map(part => part.messageId && target
        ? { conversation: target, id: part.messageId } : null) ?? [] : [];
      const allMessages = [...messages, ...completed];
      if (known && error.disposition === 'rejected' && !messages.length && !confirmedOutput.length) {
        return { delivery: { status: 'rejected', code: error.code, messages: allMessages }, confirmedOutput };
      }
      return { delivery: { status: 'failed', code: known ? error.code : 'reply_tail_unknown', retryable: false,
        ...(!known || error.disposition === 'unknown' ? { deliveryUnknown: true as const } : {}),
        messages: allMessages, ...(confirmedOutput.length || allMessages.length ? { deliveryPartial: true as const } : {}) }, confirmedOutput };
    }
    const extraMessages = 'messages' in extra ? extra.messages ?? [] : [];
    messages.push(...extraMessages);
    if (extra.status === 'sent') {
      confirmedOutput.push(...remaining);
      delivery = { status: 'sent', messageId: receipt.message?.id ?? extra.messageId, messages,
        messageContexts: [...contexts, ...extra.messageContexts ?? []] };
    } else {
      delivery = extra.status === 'suppressed' ? { status: 'failed', code: 'reply_tail_suppressed', retryable: false,
        messages, ...(confirmedOutput.length ? { deliveryPartial: true as const } : {}) }
        : extra.status === 'failed' ? { ...extra, messages,
            ...(confirmedOutput.length ? { deliveryPartial: true as const, retryable: false } : {}) }
          : { ...extra, messages };
    }
  }
  if (receipt.failure?.code === 'stream_buffer_limit') {
    // A resource-stop explanation is a separate Host message, never a regenerated model answer.
    const notice: AgentOutputElement[] = [{ type: 'text', content: turnReplyMessages(locale, 'replyLimit') }];
    try {
      const notified = await send(notice);
      if (notified.status === 'sent') {
        confirmedOutput.push(...notice);
        messages.push(...notified.messages ?? []);
      }
    } catch { /* Its ordinary delivery journal retains the separate notification outcome. */ }
  }
  return { delivery, confirmedOutput };
}

function deliveryFromReceipt(
  receipt: DeliveryReceipt,
  messages: (NonNullable<DeliveryReceipt['message']> | null)[],
  contexts: NonNullable<Extract<DeliveryOutcome, { status: 'sent' }>['messageContexts']>,
): DeliveryOutcome {
  if (receipt.status === 'sent') return { status: 'sent', messageId: receipt.message?.id, messages, messageContexts: contexts };
  if (receipt.status === 'suppressed') return { status: 'suppressed' };
  if (receipt.status === 'failed') return { status: 'failed', code: receipt.failure?.code ?? 'reply_stream_failed', retryable: false,
    messages, ...(receipt.failure?.deliveryUnknown ? { deliveryUnknown: true as const } : {}),
    ...(messages.length ? { deliveryPartial: true as const } : {}) };
  return { status: receipt.status, code: receipt.failure?.code ?? 'reply_stream_stopped', messages };
}
