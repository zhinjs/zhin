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
  const endpointNames = new Map<string, string>();
  im.onMessage((event) => {
    const row = buildInboxMessageRow(event, (capabilityId) =>
      resolveEndpointName(im, capabilityId, endpointNames));
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
 * - target 前缀解析 channel：`temp:gid:uid` → private + group parent，
 *   `channel:guild:cid` → channel + guild parent。
 */
export function buildInboxMessageRow(
  event: RuntimeMessageEvent,
  resolveEndpoint: (capabilityId: string) => string,
): Record<string, unknown> {
  const capabilityId = String(event.adapter);
  const localName = capabilityId.split('\0').pop() ?? capabilityId;
  const endpointName = resolveEndpoint(capabilityId) || localName;
  const channel = parseInboxTarget(event.target, event.channelType);
  return {
    adapter: localName,
    endpoint_id: endpointName,
    platform_message_id: event.messageId != null && event.messageId !== ''
      ? String(event.messageId)
      : `local:${event.timestamp}`,
    channel_id: channel.channelId,
    channel_type: channel.channelType,
    channel_name: null,
    channel_parent_type: channel.parentType,
    channel_parent_id: channel.parentId,
    sender_id: event.direction === 'outbound'
      ? endpointName
      : String(event.sender ?? ''),
    sender_name: null,
    sender_payload: '{}',
    content: event.contentPreview,
    raw: null,
    created_at: event.timestamp,
  };
}

/** capabilityId → live endpoint 名（uin 等），按实例缓存；解析失败回退 localName。 */
function resolveEndpointName(
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
    if (summary?.name) resolved = summary.name;
  } catch {
    // endpoint 尚未上线 / AdapterIndex 未就绪 → 回退 localName
  }
  cache.set(capabilityId, resolved);
  return resolved;
}

export interface InboxChannelParts {
  readonly channelType: string;
  readonly channelId: string;
  readonly parentType: 'group' | 'guild' | null;
  readonly parentId: string | null;
}

/** `group:xx` / `private:xx` / `temp:gid:uid` / `channel:guild:cid` → channel 字段。 */
export function parseInboxTarget(target: string, channelTypeHint?: string): InboxChannelParts {
  const parts = target.split(':');
  const prefix = parts[0] ?? '';
  if (prefix === 'temp' && parts.length >= 3) {
    return {
      channelType: 'private',
      channelId: parts.slice(2).join(':'),
      parentType: 'group',
      parentId: parts[1] ?? null,
    };
  }
  if (prefix === 'channel' && parts.length >= 3) {
    return {
      channelType: 'channel',
      channelId: parts.slice(2).join(':'),
      parentType: 'guild',
      parentId: parts[1] ?? null,
    };
  }
  if ((prefix === 'group' || prefix === 'private') && parts.length >= 2) {
    return {
      channelType: prefix,
      channelId: parts.slice(1).join(':'),
      parentType: null,
      parentId: null,
    };
  }
  return {
    channelType: channelTypeHint ?? 'private',
    channelId: target,
    parentType: null,
    parentId: null,
  };
}
