/**
 * Convention entry: discover `adapters/icqq.ts` → defineAdapter.
 */
import { defineAdapter, type AdapterContext } from '@zhin.js/adapter';
import { messageGatewayToken } from '@zhin.js/core/runtime';
import { formatCompact, getLogger } from '@zhin.js/logger';
import {
  databaseHostToken,
  INBOX_TABLE_NOTICE,
  INBOX_TABLE_REQUEST,
  runtimeEventPublisherToken,
  type Token,
} from '@zhin.js/plugin-runtime';
import { IcqqIpcEndpoint, type IcqqInboxHooks } from '../src/endpoint.js';
import { icqqRuntimeStateToken } from '../src/icqq-runtime-state.js';
import {
  resolveIcqqConfig,
  type IcqqAdapterConfig,
} from '../src/protocol.js';

export { IcqqIpcEndpoint } from '../src/endpoint.js';
export type {
  CreateIcqqIpc,
  IcqqEndpointOptions,
  IcqqIpcTransport,
} from '../src/endpoint.js';

const logger = getLogger('icqq');

export default defineAdapter<IcqqAdapterConfig>({
  capabilities: ['inbound', 'outbound'],
  // 统一消息元素通道（UNI-Channel）：端点可消费 base64 / url / upload 媒体
  // （path 由出站物化按 file/base64 模式转换，非声明消费形态）；
  // 卡片/按钮等富交互段无原生承载，降级纯文本。
  segments: {
    outboundMedia: ['base64', 'url', 'upload'],
    interactive: 'text',
  },
  create(context) {
    // Client-library / IPC daemon path — no httpHostToken.
    // Console loginAssist + host-router routes deferred.
    const config = resolveIcqqConfig(context.config);
    // 注册到插件运行时状态（icqq.endpoint list 的"运行中"数据源）
    context.use(icqqRuntimeStateToken).endpoints.set(config.name, {
      name: config.name,
      mode: config.rpc ? 'rpc' : 'ipc',
    });
    const inbox = resolveInboxHooks(context);
    return new IcqqIpcEndpoint({
      id: context.id,
      gateway: context.use(messageGatewayToken),
      config,
      ...(inbox ? { inbox } : {}),
    });
  },
});

/** 资源可选（轻量 Root 无 DatabaseHost / console hub）：缺失时降级为不写收件箱。 */
function tryUse<T>(context: AdapterContext<IcqqAdapterConfig>, token: Token<T>): T | undefined {
  try {
    return context.use(token);
  } catch {
    return undefined;
  }
}

/**
 * 收件箱钩子：写 unified_inbox_request/notice（按 platform_*_id 去重，
 * 推送事件与 GET_SYSTEM_MSG 首拉可能重复同一请求），并经 console hub 广播。
 */
function resolveInboxHooks(context: AdapterContext<IcqqAdapterConfig>): IcqqInboxHooks | undefined {
  const host = tryUse(context, databaseHostToken);
  const publisher = tryUse(context, runtimeEventPublisherToken);
  if (!host && !publisher) return undefined;
  const insertDeduped = async (
    table: string,
    idField: 'platform_request_id' | 'platform_notice_id',
    row: Record<string, unknown>,
  ): Promise<void> => {
    const model = host?.models.get(table);
    if (!model) return;
    try {
      const existing = await model.select().where({
        adapter: row.adapter,
        endpoint_id: row.endpoint_id,
        [idField]: row[idField],
      });
      if (Array.isArray(existing) && existing.length > 0) return;
      await model.insert(row);
    } catch (error) {
      logger.warn(formatCompact({
        op: 'inbox_insert',
        table,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  };
  const publish = publisher;
  return {
    recordRequest: (row) => insertDeduped(INBOX_TABLE_REQUEST, 'platform_request_id', row),
    recordNotice: (row) => insertDeduped(INBOX_TABLE_NOTICE, 'platform_notice_id', row),
    ...(publish
      ? { publish: (type: string, data: unknown): void => publish.publish(type, data) }
      : {}),
  };
}
