/**
 * #1250: the command presentation of a conversation the Host writes to without an incoming message
 * (IM approval cards, group-rule cards and notices): the Endpoint's real command prefix, computed by
 * the same `MessageDispatcher` prefix resolution the inbound dispatcher uses, and the recipient's
 * display language (their stored preference, else the project language). The card's command is then
 * spelled exactly the way the ingress strips and parses it.
 */
import { adapterFeatureId, isAdapterIndex } from '@zhin.js/adapter';
import { MessageDispatcher, messageLocale, projectLocale, type Message } from '@zhin.js/core/runtime';
import type { Locale, SnapshotReader } from '@zhin.js/plugin-runtime';

export interface ConversationPresentationTarget {
  readonly platform: string;
  /** Endpoint key, or the Endpoint capability id. */
  readonly endpoint: string;
  readonly conversation: Readonly<{ kind: 'private' | 'group'; id: string }>;
  /** The private recipient whose language preference applies. */
  readonly recipientId?: string;
}

export interface ConversationPresentation {
  readonly locale?: Locale;
  readonly commandPrefix?: string;
}

/** Resolves against the committed generation; `undefined` when no generation is readable. */
export function createConversationPresentationResolver(
  snapshots: () => SnapshotReader | undefined,
): (target: ConversationPresentationTarget) => Promise<ConversationPresentation | undefined> {
  return async (target) => {
    const reader = snapshots();
    if (!reader) return undefined;
    let lease: ReturnType<SnapshotReader['acquire']>;
    try {
      lease = reader.acquire();
    } catch {
      return undefined;
    }
    try {
      const snapshot = lease.value;
      const adapters = snapshot.projections.get(adapterFeatureId);
      const id = isAdapterIndex(adapters) ? adapters.resolve(target.platform, target.endpoint) : undefined;
      if (!isAdapterIndex(adapters) || !id) return { locale: projectLocale(snapshot) };
      const endpoint = { id: String(id), adapter: adapters.clientAdapter(id) };
      // The same environment the inbound dispatcher computes for a message in this conversation.
      const probe = {
        conversation: { endpoint, kind: target.conversation.kind, id: target.conversation.id },
        endpointId: target.endpoint,
      } as unknown as Pick<Message, 'conversation' | 'endpointId'>;
      const prefix = new MessageDispatcher().prefixOf(probe, snapshot);
      const locale = await messageLocale(snapshot, { endpoint } as Parameters<typeof messageLocale>[1], target.recipientId);
      return { locale, commandPrefix: prefix };
    } finally {
      lease.release();
    }
  };
}
