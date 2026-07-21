import type { DatabaseHost } from './database-host.js';
import { createToken } from './token.js';

/**
 * 统一收件箱（console endpoint-detail 消息历史/请求/通知视图）表定义与写入辅助。
 *
 * 列结构对齐 packages/im/zhin/src/setup/register-inbox.ts（legacy 读路径 SSOT），
 * request/notice 额外补 consumed/consumed_at 列（对齐 legacy host-api
 * endpoint-persistence 的 console_bot_requests/notices consumed 标记方式），
 * 供 console-rpc-extended 的 endpoint:requestConsumed/noticeConsumed 写路径使用。
 */
export const INBOX_TABLE_MESSAGE = 'unified_inbox_message';
export const INBOX_TABLE_REQUEST = 'unified_inbox_request';
export const INBOX_TABLE_NOTICE = 'unified_inbox_notice';

export const INBOX_MESSAGE_DEFINITION: Record<string, unknown> = {
  id: { type: 'integer', primary: true, autoIncrement: true },
  adapter: { type: 'text', nullable: false },
  endpoint_id: { type: 'text', nullable: false },
  platform_message_id: { type: 'text', nullable: false },
  channel_id: { type: 'text', nullable: false },
  channel_type: { type: 'text', nullable: false },
  channel_name: { type: 'text', nullable: true },
  channel_parent_type: { type: 'text', nullable: true },
  channel_parent_id: { type: 'text', nullable: true },
  sender_id: { type: 'text', nullable: false },
  sender_name: { type: 'text', nullable: true },
  sender_payload: { type: 'text', nullable: false },
  content: { type: 'text', nullable: false },
  raw: { type: 'text', nullable: true },
  created_at: { type: 'integer', nullable: false },
};

export const INBOX_REQUEST_DEFINITION: Record<string, unknown> = {
  id: { type: 'integer', primary: true, autoIncrement: true },
  adapter: { type: 'text', nullable: false },
  endpoint_id: { type: 'text', nullable: false },
  platform_request_id: { type: 'text', nullable: false },
  type: { type: 'text', nullable: false },
  scene_type: { type: 'text', nullable: true },
  scene_id: { type: 'text', nullable: false },
  sub_type: { type: 'text', nullable: true },
  actor_id: { type: 'text', nullable: false },
  actor_name: { type: 'text', nullable: true },
  comment: { type: 'text', nullable: true },
  created_at: { type: 'integer', nullable: false },
  resolved: { type: 'integer', nullable: false, default: 0 },
  resolved_at: { type: 'integer', nullable: true },
  consumed: { type: 'integer', nullable: false, default: 0 },
  consumed_at: { type: 'integer', nullable: true },
};

export const INBOX_NOTICE_DEFINITION: Record<string, unknown> = {
  id: { type: 'integer', primary: true, autoIncrement: true },
  adapter: { type: 'text', nullable: false },
  endpoint_id: { type: 'text', nullable: false },
  platform_notice_id: { type: 'text', nullable: false },
  type: { type: 'text', nullable: false },
  scene_type: { type: 'text', nullable: true },
  scene_id: { type: 'text', nullable: false },
  sub_type: { type: 'text', nullable: true },
  actor_id: { type: 'text', nullable: true },
  actor_name: { type: 'text', nullable: true },
  target_id: { type: 'text', nullable: true },
  target_name: { type: 'text', nullable: true },
  payload: { type: 'text', nullable: false },
  created_at: { type: 'integer', nullable: false },
  consumed: { type: 'integer', nullable: false, default: 0 },
  consumed_at: { type: 'integer', nullable: true },
};

export const INBOX_TABLE_DEFINITIONS: Readonly<Record<string, Record<string, unknown>>> =
  Object.freeze({
    [INBOX_TABLE_MESSAGE]: INBOX_MESSAGE_DEFINITION,
    [INBOX_TABLE_REQUEST]: INBOX_REQUEST_DEFINITION,
    [INBOX_TABLE_NOTICE]: INBOX_NOTICE_DEFINITION,
  });

/**
 * 在 DatabaseHost 上注册三张收件箱表（幂等：已定义或已启动的 host 跳过）。
 * 必须在 host.start() 之前调用（define 在 started 后会抛错）。
 */
export function defineInboxTables(
  host: Pick<DatabaseHost, 'define' | 'tables' | 'started'>,
): void {
  if (host.started) return;
  const existing = new Set(host.tables());
  for (const [name, definition] of Object.entries(INBOX_TABLE_DEFINITIONS)) {
    if (!existing.has(name)) host.define(name, definition);
  }
}

/**
 * 写一行收件箱记录；表未注册（或 host 未启动导致 model 缺失）时返回 false。
 * 写失败向上抛，由调用方决定降级策略。
 */
export async function insertInboxRow(
  host: Pick<DatabaseHost, 'models'>,
  table: string,
  row: Record<string, unknown>,
): Promise<boolean> {
  const model = host.models.get(table);
  if (!model) return false;
  await model.insert(row);
  return true;
}

/** Console SSE 事件 fan-out 的最小结构（@zhin.js/host-http ConsoleEventHub 满足该形状）。 */
export interface RuntimeEventPublisher {
  publish(type: string, data: unknown): void;
}

/**
 * Root 级事件发布口（console hub）。basic/cli console-api-installer 提供；
 * 适配器等插件经 CapabilityContext.use 解析后 publish endpoint:request/notice 等事件。
 */
export const runtimeEventPublisherToken = createToken<RuntimeEventPublisher>(
  'zhin.runtime.event-publisher',
  'Runtime event publisher (console SSE hub fan-out)',
);
