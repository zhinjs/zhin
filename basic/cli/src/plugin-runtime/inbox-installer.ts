import type { ImRuntime, RuntimeMessageEvent } from '@zhin.js/core/runtime';
import { formatCompact, getLogger } from '@zhin.js/logger';
import {
  INBOX_TABLE_MESSAGE,
  insertInboxRow,
  type DatabaseHost,
} from '@zhin.js/plugin-runtime';

const logger = getLogger('console-inbox');

/** 已挂收件箱写订阅的 ImRuntime（installResources 按 generation 重跑，订阅只挂一次）。 */
const inboxRecorderInstallations = new WeakSet<ImRuntime>();

/**
 * ImRuntime onMessage → unified_inbox_message 写路径。
 * 订阅去重与 console-api-installer 的消息桥一致（WeakSet 按 ImRuntime 实例）。
 */
export function installInboxMessageRecorder(im: ImRuntime, databaseHost: DatabaseHost): void {
  if (inboxRecorderInstallations.has(im)) return;
  inboxRecorderInstallations.add(im);
  const endpointIds = new Map<string, string>();
  im.onMessage((event) => {
    const row = buildInboxMessageRow(event, (capabilityId) =>
      resolveEndpointId(im, capabilityId, endpointIds));
    void insertInboxRow(databaseHost, INBOX_TABLE_MESSAGE, row).catch((error: unknown) => {
      logger.warn(formatCompact({
        op: 'inbox_message_insert',
        error: error instanceof Error ? error.message : String(error),
      }));
    });
  });
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
  const endpointId = resolveEndpoint(capabilityId) || localName;
  const channel = conversationToInboxChannel(event.conversation);
  return {
    adapter: localName,
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
  im: ImRuntime,
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
    const summary = typeof im.getEndpoint === 'function'
      ? im.getEndpoint(slotName ?? localName, entryName ?? slotName ?? localName)
      : null;
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
