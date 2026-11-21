import { MemoryConversationEventStore } from '../../../packages/im/im-contract/src/conversation-store.js';
import { ConversationRuntime } from '../../../packages/im/core/src/plugin-runtime/im/conversation-runtime.js';

/**
 * #1250 (ADR 0067 D8): feed one inbound payload an adapter handed to `receive` through the IM
 * runtime's recorder, as for an adapter that declares `messaging.inboundTextAuthoredBySender`,
 * and report whether "original inbound text" evidence was written for it.
 */
export async function recordsInboundTextEvidence(payload: unknown): Promise<boolean> {
  const input = payload as {
    readonly message: { readonly conversation: unknown; readonly id: string };
    readonly sender?: { readonly id: string; readonly name?: string };
  };
  const store = new MemoryConversationEventStore();
  const runtime = new ConversationRuntime(store);
  await runtime.recordIncoming(payload as never, input.sender as never, { textAuthoredBySender: true });
  const stored = await store.getMessage(input.message as never);
  if (!stored) throw new Error('inbound payload was not recorded');
  return typeof (stored as { inboundTextDigest?: unknown }).inboundTextDigest === 'string';
}
