import type { ConsoleRpcExtendedCtx, EndpointManagementPort, ExtendedRpcResult, InboxModel, InboxSelection } from './contracts.js';
import {
  boundedIntegerField, boolField, errorMessage, numArrayField, numField, optionalNum,
  strField, withLiveEndpoint,
} from './rpc-values.js';
import { channelFromStoredRow, normalizeParent } from './endpoint-rpc.js';

export const TABLE_MESSAGE = 'unified_inbox_message';
export const TABLE_REQUEST = 'unified_inbox_request';
export const TABLE_NOTICE = 'unified_inbox_notice';
const MAX_INBOX_OFFSET = 10_000;
const CONSUMED_NOT_WIRED =
  '收件箱已读标记未接线：unified_inbox_request/notice 表未注册或 DatabaseHost 未启动';

function getInboxModel(ctx: ConsoleRpcExtendedCtx, table: string): InboxModel | undefined {
  const model = ctx.databaseHost?.models?.get(table) as InboxModel | undefined;
  if (!model || typeof model.select !== 'function') return undefined;
  return model;
}

async function readInboxRows(
  ctx: ConsoleRpcExtendedCtx,
  table: string,
  where: Record<string, unknown>,
  options?: {
    /** DB 侧排序下推（模型不支持时由调用方内存排序兜底）。 */
    orderBy?: { field: string; direction?: 'ASC' | 'DESC' };
    /** DB 侧 limit 下推（模型不支持时由调用方内存分页兜底）。 */
    limit?: number;
    /** DB 侧 offset 下推（模型不支持时由调用方内存分页兜底）。 */
    offset?: number;
  },
): Promise<{ rows: Record<string, unknown>[]; enabled: boolean; offsetApplied: boolean }> {
  const model = getInboxModel(ctx, table);
  if (!model) return { rows: [], enabled: false, offsetApplied: false };
  try {
    let selection: InboxSelection = model.select().where(where);
    let orderApplied = options?.orderBy == null;
    if (options?.orderBy && typeof selection.orderBy === 'function') {
      selection = selection.orderBy(options.orderBy.field, options.orderBy.direction ?? 'DESC');
      orderApplied = true;
    }
    const offset = options?.offset ?? 0;
    const offsetSelection = orderApplied ? selection.offset : undefined;
    const canApplyOffset = typeof offsetSelection === 'function';
    const offsetApplied = offset === 0 || canApplyOffset;
    if (offset > 0 && canApplyOffset) {
      selection = offsetSelection.call(selection, offset);
    }
    if (options?.limit != null && orderApplied && typeof selection.limit === 'function') {
      selection = selection.limit(options.limit + (offsetApplied ? 0 : offset));
    }
    const rows = await selection;
    return { rows: Array.isArray(rows) ? rows : [], enabled: true, offsetApplied };
  } catch {
    // 表未创建 / 方言未启动等场景降级为空，不向上抛。
    return { rows: [], enabled: false, offsetApplied: false };
  }
}

export async function listInbox(
  d: Record<string, unknown>,
  ctx: ConsoleRpcExtendedCtx,
  table: string,
  key: 'requests' | 'notices',
  mapRow: (row: Record<string, unknown>) => Record<string, unknown>,
): Promise<ExtendedRpcResult> {
  const adapter = strField(d, 'adapter');
  const endpointKey = strField(d, 'endpointKey');
  if (!adapter || !endpointKey) return { error: 'adapter and endpointKey are required' };
  const limit = boundedIntegerField(d, 30, 1, 100, 'limit');
  const offset = boundedIntegerField(d, 0, 0, MAX_INBOX_OFFSET, 'offset');
  const unreadOnly = table === TABLE_NOTICE
    && boolField(d, false, 'unreadOnly');
  const { rows, enabled, offsetApplied } = await readInboxRows(ctx, table, {
    adapter,
    endpoint_id: endpointKey,
    ...(unreadOnly ? { consumed: 0 } : {}),
  }, {
    // sort/limit 下推到 DB 侧（内存 sort/slice 保留，作为无下推能力模型的兜底）
    orderBy: { field: 'created_at', direction: 'DESC' },
    limit,
    offset,
  });
  const sorted = rows
    .slice()
    .sort((a, b) => Number(b.created_at ?? 0) - Number(a.created_at ?? 0))
    .slice(offsetApplied ? 0 : offset, (offsetApplied ? 0 : offset) + limit)
    .map(mapRow);
  return { data: { [key]: sorted, inboxEnabled: enabled } };
}

/** request.list —— 优先 live EndpointManagement.listRequests；否则回退 unified_inbox_request。 */
export async function listPendingRequests(
  d: Record<string, unknown>,
  ctx: ConsoleRpcExtendedCtx,
): Promise<ExtendedRpcResult> {
  const adapter = strField(d, 'adapter');
  const endpointKey = strField(d, 'endpointKey');
  if (!adapter || !endpointKey) return { error: 'adapter and endpointKey are required' };

  if (ctx.withEndpointManagement) {
    try {
      const live = await ctx.withEndpointManagement(adapter, endpointKey, async (management) => {
        if (!management.listRequests) return undefined;
        const pending = await management.listRequests();
        const requests = pending.map((row) => mapRequestRow({
          platform_request_id: row.platform_request_id,
          type: row.type,
          scene_type: row.scene_type ?? null,
          scene_id: row.scene_id,
          sub_type: row.sub_type ?? null,
          actor_id: row.actor_id,
          actor_name: row.actor_name ?? null,
          comment: row.comment ?? null,
          created_at: row.created_at,
          resolved: 0,
        }));
        return { data: { requests, inboxEnabled: false, source: 'endpoint' } };
      });
      if (live) return live;
    } catch (error) {
      return { error: errorMessage(error) };
    }
  }

  const { rows, enabled } = await readInboxRows(ctx, TABLE_REQUEST, {
    adapter,
    endpoint_id: endpointKey,
  }, {
    orderBy: { field: 'created_at', direction: 'ASC' },
  });
  const requests = rows
    .filter((row) => Number(row.resolved ?? 0) === 0)
    .sort((a, b) => Number(a.created_at ?? 0) - Number(b.created_at ?? 0))
    .map(mapRequestRow);
  return { data: { requests, inboxEnabled: enabled, source: 'inbox' } };
}

export async function listInboxMessages(
  d: Record<string, unknown>,
  ctx: ConsoleRpcExtendedCtx,
): Promise<ExtendedRpcResult> {
  const adapter = strField(d, 'adapter');
  const endpointKey = strField(d, 'endpointKey');
  const channelId = strField(d, 'channelId');
  const channelType = strField(d, 'channelType');
  if (!adapter || !endpointKey || !channelId || !channelType) {
    return { error: 'adapter, endpointKey, channelId, and channelType are required' };
  }
  const limit = boundedIntegerField(d, 50, 1, 100, 'limit');
  const beforeTs = optionalNum(d, 'beforeTs');
  const beforeId = optionalNum(d, 'beforeId');
  const parent = normalizeParent(d.parent);

  const where: Record<string, unknown> = {
    adapter,
    endpoint_id: endpointKey,
    channel_id: channelId,
    channel_type: channelType,
  };
  if (parent) {
    where.channel_parent_type = parent.type;
    where.channel_parent_id = parent.id;
  }
  const { rows, enabled } = await readInboxRows(ctx, TABLE_MESSAGE, where, {
    // before_ts/before_id 过滤保留在内存（涉及双字段比较），排序下推 DB 侧
    orderBy: { field: 'created_at', direction: 'DESC' },
  });
  const messages = rows
    .filter((row) => (beforeTs == null || Number(row.created_at ?? 0) < beforeTs)
      && (beforeId == null || Number(row.id ?? 0) < beforeId))
    .sort((a, b) => Number(b.created_at ?? 0) - Number(a.created_at ?? 0))
    .slice(0, limit)
    .map(mapMessageRow);
  return { data: { messages, inboxEnabled: enabled } };
}

/**
 * Cross-endpoint recent inbox used by paired Mobile Console clients.
 * Unlike endpoint-detail `inbox.messages`, every row carries its complete
 * routable address so selecting a conversation can safely call
 * `endpoint.send_message` through the Device Protocol write allowlist.
 */
export async function listRecentInboxMessages(
  d: Record<string, unknown>,
  ctx: ConsoleRpcExtendedCtx,
): Promise<ExtendedRpcResult> {
  const limit = boundedIntegerField(d, 50, 1, 100, 'limit');
  const [messagePage, requestPage] = await Promise.all([
    readInboxRows(ctx, TABLE_MESSAGE, {}, {
      orderBy: {field: 'created_at', direction: 'DESC'}, limit,
    }),
    readInboxRows(ctx, TABLE_REQUEST, {resolved: 0}, {
      orderBy: {field: 'created_at', direction: 'DESC'}, limit,
    }),
  ]);
  const messages = messagePage.rows
    .slice()
    .sort((left, right) => Number(right.created_at ?? 0) - Number(left.created_at ?? 0))
    .slice(0, limit)
    .map(row => ({
      ...mapMessageRow(row),
      adapter: String(row.adapter ?? ''),
      endpointKey: String(row.endpoint_id ?? ''),
    }));
  const requests = requestPage.rows
    .filter(row => Number(row.resolved ?? 0) === 0)
    .slice()
    .sort((left, right) => Number(right.created_at ?? 0) - Number(left.created_at ?? 0))
    .slice(0, limit)
    .map(row => ({
      ...mapRequestRow(row),
      adapter: String(row.adapter ?? ''),
      endpointKey: String(row.endpoint_id ?? ''),
    }));
  return {data: {messages, requests, inboxEnabled: messagePage.enabled || requestPage.enabled}};
}

export function mapRequestRow(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: row.id,
    platformRequestId: row.platform_request_id,
    type: row.type,
    subType: row.sub_type ?? undefined,
    actor: actorFromStoredRow(row, 'actor'),
    comment: row.comment ?? undefined,
    channel: {
      id: String(row.scene_id ?? ''),
      type: String(row.scene_type ?? ''),
    },
    timestamp: row.created_at,
    resolved: Boolean(row.resolved),
    resolvedAt: row.resolved_at ?? undefined,
  };
}

export function mapNoticeRow(row: Record<string, unknown>): Record<string, unknown> {
  const actorId = row.actor_id ?? undefined;
  const actorName = row.actor_name ?? undefined;
  const sceneId = String(row.scene_id ?? '');
  const sceneType = row.scene_type == null ? undefined : String(row.scene_type);
  return {
    id: row.id,
    platformNoticeId: row.platform_notice_id,
    noticeType: row.type,
    channel: { id: sceneId, type: sceneType ?? '' },
    subType: row.sub_type ?? undefined,
    ...(actorId == null ? {} : {operator: {id: String(actorId), ...(actorName == null ? {} : {name: String(actorName)})}}),
    ...(row.target_id == null ? {} : {target: {
      id: String(row.target_id),
      ...(row.target_name == null ? {} : {name: String(row.target_name)}),
    }}),
    payload: row.payload,
    timestamp: row.created_at,
    consumed: Boolean(row.consumed),
    consumedAt: row.consumed_at ?? undefined,
  };
}

function mapMessageRow(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: row.id,
    platformMessageId: row.platform_message_id,
    sender: actorFromStoredRow(row, 'sender'),
    content: row.content,
    raw: row.raw,
    timestamp: row.created_at,
    channel: channelFromStoredRow(row),
  };
}

function actorFromStoredRow(
  row: Record<string, unknown>,
  field: 'actor' | 'sender',
): {id: string; name?: string} {
  const id = String(row[`${field}_id`] ?? '');
  const name = row[`${field}_name`];
  return name == null ? {id} : {id, name: String(name)};
}

// ---------------------------------------------------------------- consumed 标记

/**
 * request.consumed / notice.consumed —— 按行 id 置 consumed=1。
 * 表未注册（或 model 无 update）时保持"未接线"报错。
 */
export async function markInboxConsumed(
  d: Record<string, unknown>,
  ctx: ConsoleRpcExtendedCtx,
  table: string,
): Promise<ExtendedRpcResult> {
  const ids = numArrayField(d, 'rowIds');
  if (ids.length === 0) return { error: 'rowIds is required' };
  const model = getInboxModel(ctx, table);
  if (!model || typeof model.update !== 'function') return { error: CONSUMED_NOT_WIRED };
  const now = Date.now();
  try {
    for (const id of ids) {
      await model.update({ consumed: 1, consumed_at: now }).where({ id });
    }
    return { data: { success: true, updated: ids.length } };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

// ---------------------------------------------------------------- 请求审批

export async function actOnRequest(
  type: 'request.approve' | 'request.reject',
  d: Record<string, unknown>,
  ctx: ConsoleRpcExtendedCtx,
): Promise<ExtendedRpcResult> {
  const adapter = strField(d, 'adapter');
  const endpointKey = strField(d, 'endpointKey');
  const requestId = strField(d, 'platformRequestId');
  if (!adapter || !endpointKey || !requestId) {
    return { error: 'adapter, endpointKey, and platformRequestId are required' };
  }
  return withLiveEndpoint(ctx, adapter, endpointKey, async (management) => {
    const approve = type === 'request.approve';
    const method = approve ? management.approveRequest : management.rejectRequest;
    if (!method) {
      return {
        error: `请求审批未接线：当前平台（${adapter}）endpoint 不支持 ${approve ? 'approveRequest' : 'rejectRequest'}，` +
          '且新 Runtime 尚未挂载 pending request 注册表',
      };
    }
    const extra = approve
      ? strField(d, 'remark')
      : strField(d, 'reason');
    await method.call(management, requestId, extra || undefined);
    const model = getInboxModel(ctx, TABLE_REQUEST);
    if (model && typeof model.update === 'function') {
      await model.update({resolved: 1, resolved_at: Date.now()}).where({
        adapter, endpoint_id: endpointKey, platform_request_id: requestId,
      });
    }
    return { data: { success: true } };
  });
}
