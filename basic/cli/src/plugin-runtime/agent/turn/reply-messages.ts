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
  for (const message of splitOutputMessages(output)) {
    if (first?.status === 'sent') await pause(followUpPauseMs(port.render(message)));
    const outcome = await port.send(message);
    if (outcome.status === 'suppressed') continue;
    if (outcome.status !== 'sent' && first?.status === 'sent') {
      return { status: 'failed', code: 'partial_delivery', retryable: false };
    }
    if (outcome.status !== 'sent') return outcome;
    first ??= outcome;
  }
  return first ?? { status: 'suppressed' };
}
