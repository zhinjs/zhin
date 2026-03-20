/**
 * 统一收件箱基建：按用户配置将 消息 / 请求 / 通知 归一化写入内置数据库。
 * 在 zhin.js 主包中基于 database 与 inbox.enabled 自动启用。
 */
import type { Plugin,Message,Request,Notice,NoticeChannel,MessageSender } from '@zhin.js/core';
import type { AppConfig } from '../types.js';

const TABLE_MESSAGE = 'unified_inbox_message';
const TABLE_REQUEST = 'unified_inbox_request';
const TABLE_NOTICE = 'unified_inbox_notice';

const MessageDefinition = {
  id: { type: 'integer' as const, primary: true, autoIncrement: true },
  adapter: { type: 'text' as const, nullable: false },
  bot_id: { type: 'text' as const, nullable: false },
  platform_message_id: { type: 'text' as const, nullable: false },
  channel_id: { type: 'text' as const, nullable: false },
  channel_type: { type: 'text' as const, nullable: false },
  sender_id: { type: 'text' as const, nullable: false },
  sender_name: { type: 'text' as const, nullable: true },
  sender_payload: { type: 'text' as const, nullable: false },
  content: { type: 'text' as const, nullable: false },
  raw: { type: 'text' as const, nullable: true },
  created_at: { type: 'integer' as const, nullable: false },
};

const RequestDefinition = {
  id: { type: 'integer' as const, primary: true, autoIncrement: true },
  adapter: { type: 'text' as const, nullable: false },
  bot_id: { type: 'text' as const, nullable: false },
  platform_request_id: { type: 'text' as const, nullable: false },
  type: { type: 'text' as const, nullable: false },
  sub_type: { type: 'text' as const, nullable: true },
  channel_id: { type: 'text' as const, nullable: false },
  channel_type: { type: 'text' as const, nullable: false },
  sender_id: { type: 'text' as const, nullable: false },
  sender_name: { type: 'text' as const, nullable: true },
  comment: { type: 'text' as const, nullable: true },
  created_at: { type: 'integer' as const, nullable: false },
  resolved: { type: 'integer' as const, nullable: false, default: 0 },
  resolved_at: { type: 'integer' as const, nullable: true },
};

const NoticeDefinition = {
  id: { type: 'integer' as const, primary: true, autoIncrement: true },
  adapter: { type: 'text' as const, nullable: false },
  bot_id: { type: 'text' as const, nullable: false },
  platform_notice_id: { type: 'text' as const, nullable: false },
  type: { type: 'text' as const, nullable: false },
  sub_type: { type: 'text' as const, nullable: true },
  channel_id: { type: 'text' as const, nullable: false },
  channel_type: { type: 'text' as const, nullable: false },
  operator_id: { type: 'text' as const, nullable: true },
  operator_name: { type: 'text' as const, nullable: true },
  target_id: { type: 'text' as const, nullable: true },
  target_name: { type: 'text' as const, nullable: true },
  payload: { type: 'text' as const, nullable: false },
  created_at: { type: 'integer' as const, nullable: false },
};

function safeJson(obj: unknown): string {
  try {
    return JSON.stringify(obj ?? {});
  } catch {
    return '{}';
  }
}

function getModel(plugin: Plugin, name: string): any {
  const db = plugin.inject('database' as keyof Plugin.Contexts) as { models?: Map<string, unknown> } | undefined;
  return db?.models?.get(name) ?? null;
}

function persistMessage(plugin: Plugin, msg: Message): void {
  const Message = getModel(plugin, TABLE_MESSAGE);
  if (!Message) return;
  const adapter = String(msg?.$adapter ?? '');
  const botId = String(msg?.$bot ?? '');
  const channel = msg?.$channel ?? {};
  const sender = msg?.$sender ?? {};
  Message.create({
    adapter,
    bot_id: botId,
    platform_message_id: String(msg?.$id ?? ''),
    channel_id: String(channel?.id ?? ''),
    channel_type: String(channel?.type ?? 'private'),
    sender_id: String(sender?.id ?? ''),
    sender_name: sender?.name != null ? String(sender.name) : null,
    sender_payload: safeJson(sender),
    content: safeJson(msg?.$content ?? []),
    raw: msg?.$raw != null ? String(msg.$raw) : null,
    created_at: typeof msg?.$timestamp === 'number' ? msg.$timestamp : Date.now(),
  }).catch((err: unknown) => {
    plugin.logger.warn('[inbox] persist message failed', (err as Error)?.message);
  });
}

function persistRequest(plugin: Plugin, req: Request): void {
  const Request = getModel(plugin, TABLE_REQUEST);
  if (!Request) return;
  const adapter = String(req?.$adapter ?? '');
  const botId = String(req?.$bot ?? '');
  const channel = req?.$channel ?? {};
  const sender = req?.$sender ?? {};
  Request.create({
    adapter,
    bot_id: botId,
    platform_request_id: String(req?.$id ?? ''),
    type: String(req?.$type ?? ''),
    sub_type: req?.$subType != null ? String(req.$subType) : null,
    channel_id: String(channel?.id ?? ''),
    channel_type: String(channel?.type ?? 'private'),
    sender_id: String(sender?.id ?? ''),
    sender_name: sender?.name != null ? String(sender.name) : null,
    comment: req?.$comment != null ? String(req.$comment) : null,
    created_at: typeof req?.$timestamp === 'number' ? req.$timestamp : Date.now(),
    resolved: 0,
    resolved_at: null,
  }).catch((err: unknown) => {
    plugin.logger.warn('[inbox] persist request failed', (err as Error)?.message);
  });
}

function persistNotice(plugin: Plugin, notice: Notice): void {
  const Notice = getModel(plugin, TABLE_NOTICE);
  if (!Notice) return;
  const adapter = String(notice?.$adapter ?? '');
  const botId = String(notice?.$bot ?? '');
  const channel = notice?.$channel ?? {} as NoticeChannel;
  const operator = notice?.$operator ?? {} as MessageSender;
  const target = notice?.$target ?? {} as MessageSender;
  const payload: Record<string, unknown> = {};
  try {
    for (const k of Object.keys(notice || {})) {
      if (k.startsWith('$') || k === 'adapter' || k === 'bot') continue;
      payload[k] = notice[k as keyof Notice];
    }
  } catch {
    // ignore
  }
  Notice.create({
    adapter,
    bot_id: botId,
    platform_notice_id: String(notice?.$id ?? ''),
    type: String(notice?.$type ?? ''),
    sub_type: notice?.$subType != null ? String(notice.$subType) : null,
    channel_id: String(channel?.id ?? ''),
    channel_type: String(channel?.type ?? 'private'),
    operator_id: operator?.id != null ? String(operator.id) : null,
    operator_name: operator?.name != null ? String(operator.name) : null,
    target_id: target?.id != null ? String(target.id) : null,
    target_name: target?.name != null ? String(target.name) : null,
    payload: safeJson(payload),
    created_at: typeof notice?.$timestamp === 'number' ? notice.$timestamp : Date.now(),
  }).catch((err: unknown) => {
    plugin.logger.warn('[inbox] persist notice failed', (err as Error)?.message);
  });
}

/**
 * 注册收件箱表结构并订阅 request.receive / notice.receive。
 * 需在 provide(DatabaseFeature) 之后、且 appConfig.inbox?.enabled 为 true 时调用。
 */
export function registerUnifiedInbox(plugin: Plugin, appConfig: AppConfig): void {
  const enabled = !!appConfig?.inbox?.enabled;
  if (!enabled) return;
  if (!appConfig.database) {
    plugin.logger.warn('[inbox] inbox.enabled is true but database is not configured; inbox disabled');
    return;
  }

  const defineModel = (plugin as unknown as { defineModel?: (name: string, def: unknown) => void }).defineModel;
  if (typeof defineModel !== 'function') {
    plugin.logger.warn('[inbox] defineModel not available; inbox disabled');
    return;
  }

  defineModel(TABLE_MESSAGE, MessageDefinition);
  defineModel(TABLE_REQUEST, RequestDefinition);
  defineModel(TABLE_NOTICE, NoticeDefinition);
  plugin.logger.info('[inbox] models registered: %s, %s, %s', TABLE_MESSAGE, TABLE_REQUEST, TABLE_NOTICE);

  plugin.root.on('request.receive', (req: any) => persistRequest(plugin, req));
  plugin.root.on('notice.receive', (notice: any) => persistNotice(plugin, notice));
  plugin.logger.info('[inbox] subscribed to request.receive, notice.receive');
}

/**
 * 订阅各适配器的 message.receive，将消息写入收件箱。
 * 应在 connectBots / loadPlugins 之后调用，以便 root.adapters 已就绪。
 */
export function registerUnifiedInboxMessageListeners(plugin: Plugin, appConfig: AppConfig): void {
  const enabled = !!appConfig?.inbox?.enabled;
  if (!enabled || !appConfig.database) return;

  plugin.on('message.receive', (msg) => persistMessage(plugin, msg));
  plugin.logger.info('[inbox] subscribed to message.receive (per adapter)');
}
