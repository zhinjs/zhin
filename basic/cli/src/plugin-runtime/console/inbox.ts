import type { RuntimeMessageEvent } from '@zhin.js/core/runtime';
import { formatCompact, getLogger } from '@zhin.js/logger';
import {
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
 * - adapter 取 CapabilityId 的 localName（endpoint 槽名，与 console $adapter 一致）；
 * - endpoint_id 取 live endpoint 名（如 icqq uin，与 console $endpoint 一致）；
 * - 出站（direction=outbound）sender 记为 endpoint 自己；
 * - conversation → channel 字段（kind/is 与 parent，parent.kind 'group' → group，
 *   'channel' → guild，对齐 legacy target 的 temp/channel 前缀语义）。
 */
export function buildInboxMessageRow(
  event: RuntimeMessageEvent,
  resolveEndpoint: (capabilityId: string) => string,
): Record<string, unknown> {
  const capabilityId = String(event.conversation.endpoint.id);
  const localName = capabilityId.split('\0').pop() ?? capabilityId;
  const [adapterName] = localName.split('~');
  const endpointId = resolveEndpoint(capabilityId) || localName;
  const channel = conversationToInboxChannel(event.conversation);
  return {
    adapter: adapterName || localName,
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
    raw: null,
    created_at: event.timestamp,
  };
}

/** capabilityId → live endpoint 名（uin 等）；仅命中时写缓存，解析失败回退 localName（不写缓存，待下次重试）。 */
function resolveEndpointId(
  im: InboxRuntimePort,
  capabilityId: string,
  cache: Map<string, string>,
): string {
  const cached = cache.get(capabilityId);
  if (cached !== undefined) return cached;
  const localName = capabilityId.split('\0').pop() ?? capabilityId;
  // 展开 id 形如 `icqq~8596238`（slot~entry）：adapter 段取 slot localName，endpoint 段取 entry name
  const [slotName, entryName] = localName.split('~');
  let resolved = entryName ?? localName;
  try {
    const summary = im.endpoints.get(
      slotName ?? localName,
      entryName ?? slotName ?? localName,
    );
    if (summary?.name) {
      resolved = summary.name;
      cache.set(capabilityId, resolved);
    }
  } catch {
    // endpoint 尚未上线 / AdapterIndex 未就绪 → 回退 localName（不写缓存，下次消息再解析）
  }
  return resolved;
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
