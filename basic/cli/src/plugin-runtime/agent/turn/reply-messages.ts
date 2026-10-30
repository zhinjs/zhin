import { splitOutputMessages, type AgentOutputElement, type DeliveryOutcome } from '@zhin.js/agent';

/** A short, human-feeling pause before each follow-up message, longer for longer text. */
export function followUpPauseMs(text: string): number {
  return Math.min(1_500, 400 + text.length * 30);
}

/**
 * Sends the Agent output as the chat messages the model split it into, in order.
 * The first sent message is the reply's receipt; a failure after a delivered
 * message is reported as non-retryable so earlier messages are never resent.
 */
export async function sendOutputMessages(
  output: readonly AgentOutputElement[],
  port: Readonly<{
    send(message: readonly AgentOutputElement[]): Promise<DeliveryOutcome>;
    render(message: readonly AgentOutputElement[]): string;
    pause?(ms: number): Promise<void>;
  }>,
): Promise<DeliveryOutcome> {
  const pause = port.pause ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
  let first: DeliveryOutcome | undefined;
  const messages: NonNullable<Extract<DeliveryOutcome, { status: 'sent' }>['messages']>[number][] = [];
  const messageContexts: NonNullable<Extract<DeliveryOutcome, { status: 'sent' }>['messageContexts']>[number][] = [];
  for (const message of splitOutputMessages(output)) {
    if (first?.status === 'sent') await pause(followUpPauseMs(port.render(message)));
    let outcome: DeliveryOutcome;
    try {
      outcome = await port.send(message);
    } catch (error) {
      if (first?.status !== 'sent') throw error;
      // The port may fail before reaching transport; earlier bubbles are still delivered.
      return { status: 'failed', code: 'partial_delivery', retryable: false, ...(messages.length ? { messages } : {}) };
    }
    if ('messages' in outcome) messages.push(...outcome.messages ?? []);
    if (outcome.status === 'suppressed') continue;
    if (outcome.status !== 'sent' && first?.status === 'sent') {
      return { status: 'failed', code: 'partial_delivery', retryable: false, ...(messages.length ? { messages } : {}) };
    }
    if (outcome.status !== 'sent') return outcome;
    first ??= outcome;
    messageContexts.push(...outcome.messageContexts ?? []);
  }
  return first?.status === 'sent' && (messageContexts.length || messages.length)
    ? { ...first, ...(messages.length ? { messages } : {}), ...(messageContexts.length ? { messageContexts } : {}) }
    : first ?? { status: 'suppressed' };
}
