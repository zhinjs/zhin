import type { RuntimeMessageEvent } from '@zhin.js/core/runtime';
import { formatCompact, getLogger } from '@zhin.js/logger';
import {
  encodeStorageIdentity,
  INBOX_TABLE_MESSAGE,
  insertInboxRow,
  type DatabaseHost,
} from '@zhin.js/plugin-runtime';

const logger = getLogger('console-inbox');

export interface InboxRuntimePort {
  readonly endpoints: {
    get(adapter: string, endpointKey: string): { readonly name: string } | null;
  };
}

/** Converts IM messages to durable inbox rows while owning endpoint identity caching. */
export class InboxMessageRecorder {
  readonly #im: InboxRuntimePort;
  readonly #databaseHost: DatabaseHost;
  readonly #endpointIds = new Map<string, string>();

  constructor(im: InboxRuntimePort, databaseHost: DatabaseHost) {
    this.#im = im;
    this.#databaseHost = databaseHost;
  }

  record(event: RuntimeMessageEvent): void {
    const row = buildInboxMessageRow(event, (capabilityId) =>
      resolveEndpointId(this.#im, capabilityId, this.#endpointIds));
    void insertInboxRow(this.#databaseHost, INBOX_TABLE_MESSAGE, row).catch((error: unknown) => {
      logger.warn(formatCompact({
        op: 'inbox_message_insert',
        error: error instanceof Error ? error.message : String(error),
      }));
    });
  }
}

/**
 * RuntimeMessageEvent → unified_inbox_message 行。
 * - adapter comes from the canonical EndpointRef, never from an opaque id suffix;
 * - endpoint_id is the directory's display/config name, separate from persisted canonical fields;
 * - 出站（direction=outbound）sender 记为 endpoint 自己；
 * - conversation → channel 字段（kind/is 与 parent，parent.kind 'group' → group，
 *   'channel' → guild，对齐 legacy target 的 temp/channel 前缀语义）。
 */
export function buildInboxMessageRow(
  event: RuntimeMessageEvent,
  resolveEndpoint: (capabilityId: string) => string,
): Record<string, unknown> {
  const capabilityId = String(event.conversation.endpoint.id);
  const endpointId = resolveEndpoint(capabilityId) || '';
  const channel = conversationToInboxChannel(event.conversation);
  return {
    direction: event.direction,
    endpoint_capability_id: encodeStorageIdentity(event.conversation.endpoint.id),
    endpoint_adapter_id: encodeStorageIdentity(event.conversation.endpoint.adapter),
    thread_id: event.conversation.threadId === undefined ? null : encodeStorageIdentity(event.conversation.threadId),
    query_version: 1,
    adapter: event.conversation.endpoint.adapter,
    endpoint_id: endpointId,
    platform_message_id: event.messageId != null && event.messageId !== ''
      ? String(event.messageId)
      : `local:${event.timestamp}`,
    channel_id: channel.channelId,
    channel_type: channel.channelType,
    channel_name: null,
    channel_parent_type: channel.parentType,
    channel_parent_id: channel.parentId,
    sender_id: event.direction === 'outbound'
      ? endpointId
      : (event.sender?.id ?? ''),
    sender_name: event.direction === 'outbound'
      ? null
      : (event.sender?.name ?? null),
    sender_payload: '{}',
    content: event.contentPreview,
    raw: JSON.stringify({
      $console: 'zhin.message-observation/1',
      direction: event.direction,
      conversation: event.conversation,
      ...(event.rendering ? { rendering: event.rendering } : {}),
    }),
    created_at: event.timestamp,
  };
}

/** Resolve by the complete stable identity; a UUID suffix is not an account's name. */
function resolveEndpointId(
  im: InboxRuntimePort,
  capabilityId: string,
  cache: Map<string, string>,
): string {
  const cached = cache.get(capabilityId);
  if (cached !== undefined) return cached;
  try {
    const summary = im.endpoints.get(capabilityId, capabilityId);
    if (summary?.name) {
      cache.set(capabilityId, summary.name);
      return summary.name;
    }
  } catch {
    // Observation is best effort; a later event may resolve a not-yet-visible account.
  }
  return '';
}

export interface InboxChannelParts {
  readonly channelType: string;
  readonly channelId: string;
  readonly parentType: 'group' | 'guild' | null;
  readonly parentId: string | null;
}

/** ConversationRef → channel 字段（parent.kind 'group' → group，'channel' → guild）。 */
export function conversationToInboxChannel(
  conversation: RuntimeMessageEvent['conversation'],
): InboxChannelParts {
  return {
    channelType: conversation.kind,
    channelId: conversation.id,
    parentType: conversation.parent ? (conversation.parent.kind === 'group' ? 'group' : 'guild') : null,
    parentId: conversation.parent?.id ?? null,
  };
}
