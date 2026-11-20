/**
 * #1250: the command presentation of a conversation the Host writes to without an incoming message
 * (IM approval cards, group-rule cards and notices): the Endpoint's real command prefix and the
 * recipient's display language (their stored preference, else the project language). The prefix comes
 * from the IM runtime's own outbound command environment (the Root resource `ImRuntime.install`
 * provides for outbound templates): the same `MessageDispatcher` — `ImRuntimeOptions.commandPrefix`
 * override included — that inbound command dispatch strips with, so the card's command is spelled
 * exactly the way the ingress parses it.
 */
import { adapterFeatureId, isAdapterIndex } from '@zhin.js/adapter';
import { messageLocale, projectLocale } from '@zhin.js/core/runtime';
import type { ConversationRef } from '@zhin.js/im-contract';
import { createToken, type Locale, type RuntimeSnapshot, type SnapshotReader } from '@zhin.js/plugin-runtime';

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

/** The IM runtime's outbound command environment (core `outboundCommandEnvironmentToken`, not exported). */
type OutboundCommandEnvironment = (
  input: Readonly<{ conversation: ConversationRef; endpointId?: string; locale: Locale }>,
  snapshot: RuntimeSnapshot,
) => Readonly<{ prefix: string; menu?: string }>;
const outboundCommandEnvironmentId = createToken<OutboundCommandEnvironment>('zhin.im.outbound-command-environment').id;

function commandEnvironment(snapshot: RuntimeSnapshot): OutboundCommandEnvironment | undefined {
  // Root scope only, as the outbound renderer reads it: a Plugin binding the same id changes nothing.
  const value = snapshot.resources.get(snapshot.root)?.get(outboundCommandEnvironmentId);
  return typeof value === 'function' ? value as OutboundCommandEnvironment : undefined;
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
      const locale = await messageLocale(snapshot, { endpoint } as Parameters<typeof messageLocale>[1], target.recipientId);
      const environment = commandEnvironment(snapshot);
      if (!environment) return { locale };
      // An inbound message carries the Endpoint's live name as `endpointId`; a capability id is not
      // one, so then only that capability's configured endpoint id is matched, as for inbound.
      const prefix = environment({
        conversation: { endpoint, kind: target.conversation.kind, id: target.conversation.id } as ConversationRef,
        ...(target.endpoint !== endpoint.id ? { endpointId: target.endpoint } : {}),
        locale,
      }, snapshot).prefix;
      return { locale, commandPrefix: prefix };
    } finally {
      lease.release();
    }
  };
}
