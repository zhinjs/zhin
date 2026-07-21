/**
 * Extended Console RPC: cron/schedule + endpoint social/inbox surface.
 *
 * 挂在 `dispatchRuntimeConsoleRpc`（console-rpc.ts）之后的第二级 dispatch：
 * 返回 `undefined` 表示不识别该 type，由调用方继续走默认分支；
 * 识别后返回 `{ data }` 或 `{ error }`（requestId 由调用方补齐）。
 *
 * 数据源约定（只读真实数据源，不做内存假数据）：
 * - cron：`ctx.scheduleHost`（Plugin Runtime ScheduleHost，仅 register/list，
 *   无持久化引擎，故 cron:add/remove/pause/resume 报"未接线"）。
 * - inbox：`ctx.databaseHost.models`（unified_inbox_message/request/notice 三张表，
 *   表不存在或查询失败 → 空数组 + inboxEnabled:false）。
 * - 社交/群管：`ctx.resolveEndpoint` 拿 live endpoint 实例，
 *   实例上探测到对应方法才调用，否则报"该平台不支持"。
 */

/** 新 Runtime 统一收件箱表名（与 packages/im/zhin/src/setup/register-inbox.ts 一致）。 */
const TABLE_MESSAGE = 'unified_inbox_message';
const TABLE_REQUEST = 'unified_inbox_request';
const TABLE_NOTICE = 'unified_inbox_notice';

export interface ConsoleRpcExtendedCtx {
  /** full scope 才允许写操作；demo scope 只放行只读 RPC。 */
  fullScope: boolean;
  projectRoot: string;
  /** Plugin Runtime ScheduleHost（basic/cli schedule-host-installer 提供）。 */
  scheduleHost?: unknown;
  /** 经 ImRuntime / AdapterEndpointIndex 解析 live endpoint 实例。 */
  resolveEndpoint?: (adapter: string, endpointId: string) => unknown;
  /** Plugin Runtime DatabaseHost 的 models 视图。 */
  databaseHost?: { models: { get(name: string): unknown } };
  /** Agent Host 持久化调度引擎（@zhin.js/agent getAssistantRuntime().engine），未 init 时返回 null。 */
  resolveScheduleEngine?: () => ConsoleScheduleEngine | null | undefined;
}

export interface ConsoleScheduleEngine {
  addJob(job: Record<string, unknown>): Promise<Record<string, unknown>>;
  removeJob(id: string): Promise<boolean>;
  pauseJob(id: string): Promise<boolean>;
  resumeJob(id: string): Promise<boolean>;
  listJobs(): Promise<Record<string, unknown>[]>;
}

export type ExtendedRpcResult = { data: unknown } | { error: string };

/** demo scope 只读放行清单之外的写操作 type。 */
const WRITE_TYPES = new Set([
  'cron:add',
  'cron:remove',
  'cron:pause',
  'cron:resume',
  'endpoint:requestApprove',
  'endpoint:requestReject',
  'endpoint:requestConsumed',
  'endpoint:noticeConsumed',
  'endpoint:groupKick',
  'endpoint:groupMute',
  'endpoint:groupAdmin',
  'endpoint:deleteFriend',
]);

const CRON_NOT_WIRED =
  '持久化调度未接线：当前 Plugin Runtime ScheduleHost 仅支持插件注册的内存任务（list），' +
  '不支持 add/remove/pause/resume（需要 @zhin.js/agent 持久化调度引擎）';

const CONSUMED_NOT_WIRED =
  '收件箱已读标记未接线：新 Runtime 尚未提供 request/notice 的 consumed 写路径';

interface ScheduleJobRow {
  id: string;
  cron: string;
  description?: string;
}

interface InboxModel {
  select(): {
    where(query: Record<string, unknown>): Promise<Record<string, unknown>[]> | Record<string, unknown>[];
  };
}

type EndpointAny = Record<string, unknown>;

export async function dispatchExtendedConsoleRpc(
  type: string,
  data: Record<string, unknown> | undefined,
  ctx: ConsoleRpcExtendedCtx,
): Promise<ExtendedRpcResult | undefined> {
  const d = data ?? {};

  if (WRITE_TYPES.has(type) && !ctx.fullScope) {
    return { error: `Demo scope: RPC "${type}" is forbidden` };
  }

  switch (type) {
    case 'schedule:list':
    case 'cron:list':
      return listSchedule(ctx);

    case 'cron:add':
      return addCron(d, ctx);
    case 'cron:remove':
    case 'cron:pause':
    case 'cron:resume':
      return mutateCron(type, d, ctx);

    case 'endpoint:requests':
      return listPendingRequests(d, ctx);
    case 'endpoint:inboxRequests':
      return listInbox(d, ctx, TABLE_REQUEST, 'requests', mapRequestRow);
    case 'endpoint:inboxNotices':
      return listInbox(d, ctx, TABLE_NOTICE, 'notices', mapNoticeRow);
    case 'endpoint:inboxMessages':
      return listInboxMessages(d, ctx);

    case 'endpoint:requestApprove':
    case 'endpoint:requestReject':
      return actOnRequest(type, d, ctx);

    case 'endpoint:requestConsumed':
    case 'endpoint:noticeConsumed':
      return { error: CONSUMED_NOT_WIRED };

    case 'endpoint:friends':
      return listFriends(d, ctx);
    case 'endpoint:groups':
      return listGroups(d, ctx);
    case 'endpoint:channels':
      return listChannels(d, ctx);
    case 'endpoint:groupMembers':
      return listGroupMembers(d, ctx);

    case 'endpoint:groupKick':
      return groupWriteOp(d, ctx, {
        methods: ['removeMember', 'kickMember', 'setGroupKick'],
        buildArgs: (gid, uid) => [gid, uid],
        requireUser: true,
        unsupported: '踢出群成员',
      });
    case 'endpoint:groupMute':
      return groupWriteOp(d, ctx, {
        methods: ['muteMember', 'setGroupBan', 'banMember'],
        buildArgs: (gid, uid, extra) => [gid, uid, extra.duration ?? 600],
        requireUser: true,
        unsupported: '禁言群成员',
      });
    case 'endpoint:groupAdmin':
      return groupWriteOp(d, ctx, {
        methods: ['setModerator', 'setGroupAdmin', 'setAdmin'],
        buildArgs: (gid, uid, extra) => [gid, uid, extra.enable !== false],
        requireUser: true,
        unsupported: '设置群管理员',
      });
    case 'endpoint:deleteFriend':
      return deleteFriend(d, ctx);

    default:
      return undefined;
  }
}

// ---------------------------------------------------------------- cron

function listSchedule(ctx: ConsoleScheduleListCtx): Promise<ExtendedRpcResult> | ExtendedRpcResult {
  const host = ctx.scheduleHost as { list?: () => unknown } | undefined;
  if (!host || typeof host.list !== 'function') {
    return { error: '调度服务未配置（scheduleHost 未挂载）' };
  }
  try {
    const raw = host.list();
    const memory: ScheduleJobRow[] = (Array.isArray(raw) ? raw : [])
      .filter((job): job is ScheduleJobRow =>
        !!job && typeof job === 'object'
        && typeof (job as ScheduleJobRow).id === 'string'
        && typeof (job as ScheduleJobRow).cron === 'string')
      .map((job) => ({
        id: job.id,
        cron: job.cron,
        ...(typeof job.description === 'string' ? { description: job.description } : {}),
      }));
    return listPersistentJobs(ctx).then((persistent) => ({ data: { memory, persistent } }));
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

type ConsoleScheduleListCtx = ConsoleRpcExtendedCtx;

/** 持久化任务（Agent Host ScheduleJobEngine）→ 前端 PersistentCron 形状。 */
async function listPersistentJobs(ctx: ConsoleRpcExtendedCtx): Promise<Record<string, unknown>[]> {
  const engine = ctx.resolveScheduleEngine?.();
  if (!engine) return [];
  try {
    const jobs = await engine.listJobs();
    return jobs.map((job) => ({
      id: job.id,
      label: job.label ?? job.id,
      cronExpression: (job.schedule as { cron?: string } | undefined)?.cron ?? '',
      prompt: (job.action as { prompt?: string } | undefined)?.prompt ?? '',
      enabled: job.enabled !== false,
      source: job.source ?? 'manual',
      lastExecutedAt: (job.state as { lastExecutedAt?: number } | undefined)?.lastExecutedAt,
      lastStatus: (job.state as { lastStatus?: string } | undefined)?.lastStatus,
    }));
  } catch {
    return [];
  }
}

async function addCron(
  d: Record<string, unknown>,
  ctx: ConsoleRpcExtendedCtx,
): Promise<ExtendedRpcResult> {
  const engine = ctx.resolveScheduleEngine?.();
  if (!engine) return { error: CRON_NOT_WIRED };
  const cronExpression = String(d.cronExpression ?? '').trim();
  const prompt = String(d.prompt ?? '').trim();
  if (!cronExpression) return { error: 'cronExpression is required' };
  if (!prompt) return { error: 'prompt is required' };
  const label = typeof d.label === 'string' && d.label.trim() ? d.label.trim() : undefined;
  const context = (d.context ?? {}) as Record<string, unknown>;
  const target = context.target ?? context.channel;
  const job = {
    id: `console-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    ...(label ? { label } : {}),
    enabled: true,
    schedule: { kind: 'solar', cron: cronExpression },
    action: { kind: 'agent', prompt },
    notify: target
      ? { channel: 'im', target }
      : { channel: 'silent' },
    source: 'manual',
  };
  try {
    const created = await engine.addJob(job);
    return { data: { job: created, success: true } };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

async function mutateCron(
  type: 'cron:remove' | 'cron:pause' | 'cron:resume',
  d: Record<string, unknown>,
  ctx: ConsoleRpcExtendedCtx,
): Promise<ExtendedRpcResult> {
  const engine = ctx.resolveScheduleEngine?.();
  if (!engine) return { error: CRON_NOT_WIRED };
  const id = String(d.id ?? '').trim();
  if (!id) return { error: 'id is required' };
  try {
    const ok = type === 'cron:remove'
      ? await engine.removeJob(id)
      : type === 'cron:pause'
        ? await engine.pauseJob(id)
        : await engine.resumeJob(id);
    return ok ? { data: { success: true } } : { error: `任务不存在: ${id}` };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

// ---------------------------------------------------------------- inbox

function getInboxModel(ctx: ConsoleRpcExtendedCtx, table: string): InboxModel | undefined {
  const model = ctx.databaseHost?.models?.get(table) as InboxModel | undefined;
  if (!model || typeof model.select !== 'function') return undefined;
  return model;
}

async function readInboxRows(
  ctx: ConsoleRpcExtendedCtx,
  table: string,
  where: Record<string, unknown>,
): Promise<{ rows: Record<string, unknown>[]; enabled: boolean }> {
  const model = getInboxModel(ctx, table);
  if (!model) return { rows: [], enabled: false };
  try {
    const rows = await model.select().where(where);
    return { rows: Array.isArray(rows) ? rows : [], enabled: true };
  } catch {
    // 表未创建 / 方言未启动等场景降级为空，不向上抛。
    return { rows: [], enabled: false };
  }
}

async function listInbox(
  d: Record<string, unknown>,
  ctx: ConsoleRpcExtendedCtx,
  table: string,
  key: 'requests' | 'notices',
  mapRow: (row: Record<string, unknown>) => Record<string, unknown>,
): Promise<ExtendedRpcResult> {
  const adapter = strField(d, '$adapter', 'adapter');
  const endpointId = strField(d, '$endpoint', 'endpointId', 'endpoint');
  if (!adapter || !endpointId) return { error: '$adapter and $endpoint required' };
  const limit = Math.min(numField(d, 30, '$limit', 'limit'), 100);
  const offset = Math.max(0, numField(d, 0, '$offset', 'offset'));
  const { rows, enabled } = await readInboxRows(ctx, table, {
    adapter,
    endpoint_id: endpointId,
  });
  const sorted = rows
    .slice()
    .sort((a, b) => Number(b.created_at ?? 0) - Number(a.created_at ?? 0))
    .slice(offset, offset + limit)
    .map(mapRow);
  return { data: { [key]: sorted, inboxEnabled: enabled } };
}

/** endpoint:requests —— 未处理的好友/群请求（unified_inbox_request 中 resolved=0）。 */
async function listPendingRequests(
  d: Record<string, unknown>,
  ctx: ConsoleRpcExtendedCtx,
): Promise<ExtendedRpcResult> {
  const adapter = strField(d, '$adapter', 'adapter');
  const endpointId = strField(d, '$endpoint', 'endpointId', 'endpoint');
  if (!adapter || !endpointId) return { error: '$adapter and $endpoint required' };
  const { rows, enabled } = await readInboxRows(ctx, TABLE_REQUEST, {
    adapter,
    endpoint_id: endpointId,
  });
  const requests = rows
    .filter((row) => Number(row.resolved ?? 0) === 0)
    .sort((a, b) => Number(a.created_at ?? 0) - Number(b.created_at ?? 0))
    .map(mapRequestRow);
  return { data: { requests, inboxEnabled: enabled } };
}

async function listInboxMessages(
  d: Record<string, unknown>,
  ctx: ConsoleRpcExtendedCtx,
): Promise<ExtendedRpcResult> {
  const adapter = strField(d, '$adapter', 'adapter');
  const endpointId = strField(d, '$endpoint', 'endpointId', 'endpoint');
  const channelId = strField(d, '$channel_id', 'channelId', 'channel_id');
  const channelType = strField(d, '$channel_type', 'channelType', 'channel_type');
  if (!adapter || !endpointId || !channelId || !channelType) {
    return { error: '$adapter, $endpoint, $channel_id, $channel_type required' };
  }
  const limit = Math.min(numField(d, 50, '$limit', 'limit'), 100);
  const beforeTs = optionalNum(d, '$before_ts', 'beforeTs', 'before_ts');
  const beforeId = optionalNum(d, '$before_id', 'beforeId', 'before_id');
  const parent = normalizeParent(d.$parent ?? d.parent);

  const where: Record<string, unknown> = {
    adapter,
    endpoint_id: endpointId,
    channel_id: channelId,
    channel_type: channelType,
  };
  if (parent) {
    where.channel_parent_type = parent.type;
    where.channel_parent_id = parent.id;
  }
  const { rows, enabled } = await readInboxRows(ctx, TABLE_MESSAGE, where);
  const messages = rows
    .filter((row) => (beforeTs == null || Number(row.created_at ?? 0) < beforeTs)
      && (beforeId == null || Number(row.id ?? 0) < beforeId))
    .sort((a, b) => Number(b.created_at ?? 0) - Number(a.created_at ?? 0))
    .slice(0, limit)
    .map((row) => ({
      id: row.id,
      platform_message_id: row.platform_message_id,
      sender_id: row.sender_id,
      sender_name: row.sender_name,
      content: row.content,
      raw: row.raw,
      created_at: row.created_at,
      channel: channelFromStoredRow(row),
      parent: parentFromStoredRow(row),
    }));
  return { data: { messages, inboxEnabled: enabled } };
}

function mapRequestRow(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: row.id,
    platform_request_id: row.platform_request_id,
    type: row.type,
    scene_type: row.scene_type ?? undefined,
    scene_id: row.scene_id,
    sub_type: row.sub_type ?? undefined,
    actor: { id: row.actor_id, name: row.actor_name ?? undefined },
    comment: row.comment ?? undefined,
    created_at: row.created_at,
    resolved: row.resolved,
    resolved_at: row.resolved_at ?? undefined,
  };
}

function mapNoticeRow(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: row.id,
    platform_notice_id: row.platform_notice_id,
    type: row.type,
    scene_type: row.scene_type ?? undefined,
    scene_id: row.scene_id,
    sub_type: row.sub_type ?? undefined,
    actor_id: row.actor_id ?? undefined,
    actor_name: row.actor_name ?? undefined,
    target_id: row.target_id ?? undefined,
    target_name: row.target_name ?? undefined,
    payload: row.payload,
    created_at: row.created_at,
  };
}

// ---------------------------------------------------------------- 请求审批

async function actOnRequest(
  type: 'endpoint:requestApprove' | 'endpoint:requestReject',
  d: Record<string, unknown>,
  ctx: ConsoleRpcExtendedCtx,
): Promise<ExtendedRpcResult> {
  const adapter = strField(d, '$adapter', 'adapter');
  const endpointId = strField(d, '$endpoint', 'endpointId', 'endpoint');
  const requestId = strField(d, '$id', 'id', 'platformRequestId', 'platform_request_id');
  if (!adapter || !endpointId || !requestId) {
    return { error: '$adapter, $endpoint, $id required' };
  }
  const resolved = resolveLiveEndpoint(ctx, adapter, endpointId);
  if ('error' in resolved) return resolved;
  const endpoint = resolved.endpoint;
  const approve = type === 'endpoint:requestApprove';
  const methodNames = approve
    ? ['approveRequest', 'approve_request', '$approveRequest']
    : ['rejectRequest', 'reject_request', '$rejectRequest'];
  const method = pickMethod(endpoint, methodNames);
  if (!method) {
    return {
      error: `请求审批未接线：当前平台（${adapter}）endpoint 不支持 ${methodNames[0]}，` +
        '且新 Runtime 尚未挂载 pending request 注册表',
    };
  }
  try {
    const extra = approve
      ? strField(d, '$remark', 'remark')
      : strField(d, '$reason', 'reason');
    await method.call(endpoint, requestId, extra || undefined);
    return { data: { success: true } };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

// ---------------------------------------------------------------- 社交读取

async function listFriends(
  d: Record<string, unknown>,
  ctx: ConsoleRpcExtendedCtx,
): Promise<ExtendedRpcResult> {
  const resolved = requireEndpoint(d, ctx);
  if ('error' in resolved) return resolved;
  const { endpoint, adapter } = resolved;
  try {
    const map = (endpoint.friends ?? endpoint.fl) as Map<unknown, Record<string, unknown>> | undefined;
    if (map && typeof map.values === 'function') {
      const friends = Array.from(map.values()).map((f) => ({
        user_id: Number(f.user_id),
        nickname: String(f.nickname ?? ''),
        remark: String(f.remark ?? ''),
      }));
      return { data: { friends, count: friends.length } };
    }
    const getFriendList = pickMethod(endpoint, ['getFriendList', 'getFriends', 'listFriends']);
    if (getFriendList) {
      const raw = await getFriendList.call(endpoint);
      const friends = unwrapList(raw).map((row) => ({
        user_id: Number(row.user_id ?? row.userId ?? row.id ?? 0),
        nickname: String(row.nickname ?? row.name ?? row.user_id ?? ''),
        remark: String(row.remark ?? ''),
      }));
      return { data: { friends, count: friends.length } };
    }
    return { error: `当前适配器（${adapter}）不支持好友列表` };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

async function listGroups(
  d: Record<string, unknown>,
  ctx: ConsoleRpcExtendedCtx,
): Promise<ExtendedRpcResult> {
  const resolved = requireEndpoint(d, ctx);
  if ('error' in resolved) return resolved;
  const { endpoint, adapter } = resolved;
  try {
    const map = (endpoint.groups ?? endpoint.gl) as Map<unknown, Record<string, unknown>> | undefined;
    if (map && typeof map.values === 'function') {
      const groups = Array.from(map.values()).map((g) => ({
        group_id: Number(g.group_id),
        name: String(g.group_name ?? g.name ?? g.group_id ?? ''),
      }));
      return { data: { groups, count: groups.length } };
    }
    const getGroupList = pickMethod(endpoint, ['getGroupList', 'getGroups', 'listGroups']);
    if (getGroupList) {
      const raw = await getGroupList.call(endpoint);
      const groups = unwrapList(raw).map((row) => ({
        group_id: Number(row.group_id ?? row.groupId ?? row.id ?? 0),
        name: String(row.name ?? row.group_name ?? row.group_id ?? ''),
      }));
      return { data: { groups, count: groups.length } };
    }
    return { error: `当前适配器（${adapter}）不支持群列表` };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

async function listChannels(
  d: Record<string, unknown>,
  ctx: ConsoleRpcExtendedCtx,
): Promise<ExtendedRpcResult> {
  const resolved = requireEndpoint(d, ctx);
  if ('error' in resolved) return resolved;
  const { endpoint, adapter } = resolved;
  try {
    const channels: Array<{
      id: string;
      name?: string;
      parent?: { type: string; id: string; name?: string };
    }> = [];
    const getGuildChannelList = pickMethod(endpoint, ['getGuildChannelList']);
    if (getGuildChannelList) {
      const list = await getGuildChannelList.call(endpoint) as Array<Record<string, unknown>>;
      for (const item of Array.isArray(list) ? list : []) {
        const parent = normalizeParent(item.parent);
        channels.push({
          id: String(item.id ?? ''),
          ...(item.name != null ? { name: String(item.name) } : {}),
          ...(parent ? { parent } : {}),
        });
      }
      return { data: { channels, count: channels.length } };
    }
    const getGuilds = pickMethod(endpoint, ['getGuilds', 'listGuilds']);
    const getChannels = pickMethod(endpoint, ['getChannels', 'listChannels']);
    if (getGuilds && getChannels) {
      const guilds = unwrapList(await getGuilds.call(endpoint));
      for (const g of guilds) {
        const gid = String(g.id ?? g.guild_id ?? '');
        if (!gid) continue;
        const guildName = String(g.name ?? g.guild_name ?? gid);
        const chs = unwrapList(await getChannels.call(endpoint, gid));
        for (const c of chs) {
          channels.push({
            id: String(c.id ?? c.channel_id ?? ''),
            name: String(c.name ?? c.channel_name ?? c.id ?? ''),
            parent: { type: 'guild', id: gid, name: guildName },
          });
        }
      }
      return { data: { channels, count: channels.length } };
    }
    return { error: `当前适配器（${adapter}）不支持频道列表` };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

async function listGroupMembers(
  d: Record<string, unknown>,
  ctx: ConsoleRpcExtendedCtx,
): Promise<ExtendedRpcResult> {
  const adapter = strField(d, '$adapter', 'adapter');
  const endpointId = strField(d, '$endpoint', 'endpointId', 'endpoint');
  const groupId = strField(d, '$group_id', 'groupId', 'group_id');
  if (!adapter || !endpointId || !groupId) {
    return { error: '$adapter, $endpoint, $group_id required' };
  }
  const resolved = resolveLiveEndpoint(ctx, adapter, endpointId);
  if ('error' in resolved) return resolved;
  const { endpoint } = resolved;
  try {
    const method = pickMethod(endpoint, ['getGroupMemberList', 'listMembers', 'getMemberList']);
    if (!method) {
      return { error: `当前适配器（${adapter}）不支持群成员列表` };
    }
    const raw = await method.call(endpoint, groupId);
    if (Array.isArray(raw)) {
      return { data: { members: raw, count: raw.length } };
    }
    // Map（icqq 风格 gml）→ values 数组
    if (raw && typeof (raw as Map<unknown, unknown>).values === 'function') {
      const members = Array.from((raw as Map<unknown, unknown>).values());
      return { data: { members, count: members.length } };
    }
    return { data: raw ?? { members: [], count: 0 } };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

// ---------------------------------------------------------------- 群管/好友写操作

interface GroupWriteSpec {
  methods: string[];
  buildArgs(groupId: string, userId: string, extra: { duration?: number; enable?: boolean }): unknown[];
  requireUser: boolean;
  /** 中文操作名，用于"该平台不支持 xxx"。 */
  unsupported: string;
}

async function groupWriteOp(
  d: Record<string, unknown>,
  ctx: ConsoleRpcExtendedCtx,
  spec: GroupWriteSpec,
): Promise<ExtendedRpcResult> {
  const adapter = strField(d, '$adapter', 'adapter');
  const endpointId = strField(d, '$endpoint', 'endpointId', 'endpoint');
  const groupId = strField(d, '$group_id', 'groupId', 'group_id');
  const userId = strField(d, '$user_id', 'userId', 'user_id');
  if (!adapter || !endpointId || !groupId) {
    return { error: '$adapter, $endpoint, $group_id required' };
  }
  if (spec.requireUser && !userId) {
    return { error: '$user_id required' };
  }
  const resolved = resolveLiveEndpoint(ctx, adapter, endpointId);
  if ('error' in resolved) return resolved;
  const { endpoint } = resolved;
  const method = pickMethod(endpoint, spec.methods);
  if (!method) {
    return { error: `当前适配器（${adapter}）不支持${spec.unsupported}` };
  }
  try {
    const durationRaw = d.$duration ?? d.duration;
    const enableRaw = d.$enable ?? d.enable;
    const args = spec.buildArgs(groupId, userId, {
      duration: typeof durationRaw === 'number' && Number.isFinite(durationRaw)
        ? durationRaw
        : undefined,
      enable: typeof enableRaw === 'boolean' ? enableRaw : undefined,
    });
    await method.call(endpoint, ...args);
    return { data: { success: true } };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

async function deleteFriend(
  d: Record<string, unknown>,
  ctx: ConsoleRpcExtendedCtx,
): Promise<ExtendedRpcResult> {
  const adapter = strField(d, '$adapter', 'adapter');
  const endpointId = strField(d, '$endpoint', 'endpointId', 'endpoint');
  const userId = strField(d, '$user_id', 'userId', 'user_id');
  if (!adapter || !endpointId || !userId) {
    return { error: '$adapter, $endpoint, $user_id required' };
  }
  const resolved = resolveLiveEndpoint(ctx, adapter, endpointId);
  if ('error' in resolved) return resolved;
  const { endpoint } = resolved;
  const method = pickMethod(endpoint, ['deleteFriend', 'delete_friend']);
  if (!method) {
    return { error: '当前适配器暂不支持删除好友' };
  }
  try {
    const numeric = Number(userId);
    await method.call(endpoint, Number.isFinite(numeric) && userId.trim() !== '' ? numeric : userId);
    return { data: { success: true } };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

// ---------------------------------------------------------------- helpers

function strField(d: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = d[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

function numField(d: Record<string, unknown>, fallback: number, ...keys: string[]): number {
  for (const key of keys) {
    const parsed = Number(d[key]);
    if (d[key] != null && Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function optionalNum(d: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    if (d[key] == null) continue;
    const parsed = Number(d[key]);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function pickMethod(
  endpoint: EndpointAny,
  names: readonly string[],
): ((...args: unknown[]) => unknown) | undefined {
  for (const name of names) {
    const fn = endpoint[name];
    if (typeof fn === 'function') return fn as (...args: unknown[]) => unknown;
  }
  return undefined;
}

type ResolveOk = { endpoint: EndpointAny; adapter: string; endpointId: string };

function resolveLiveEndpoint(
  ctx: ConsoleRpcExtendedCtx,
  adapter: string,
  endpointId: string,
): ResolveOk | { error: string } {
  if (!ctx.resolveEndpoint) {
    return { error: 'Endpoint registry is not configured' };
  }
  const endpoint = ctx.resolveEndpoint(adapter, endpointId);
  if (!endpoint || typeof endpoint !== 'object') {
    return { error: 'endpoint not found' };
  }
  return { endpoint: endpoint as EndpointAny, adapter, endpointId };
}

function requireEndpoint(
  d: Record<string, unknown>,
  ctx: ConsoleRpcExtendedCtx,
): ResolveOk | { error: string } {
  const adapter = strField(d, '$adapter', 'adapter');
  const endpointId = strField(d, '$endpoint', 'endpointId', 'endpoint');
  if (!adapter || !endpointId) return { error: '$adapter and $endpoint required' };
  return resolveLiveEndpoint(ctx, adapter, endpointId);
}

/** 兼容数组 / `{ data: [...] }` / `{ list: [...] }` 的列表返回。 */
function unwrapList(raw: unknown): Record<string, unknown>[] {
  const arr = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object'
      ? ((raw as Record<string, unknown>).data ?? (raw as Record<string, unknown>).list)
      : undefined;
  return (Array.isArray(arr) ? arr : []).filter(
    (item): item is Record<string, unknown> => !!item && typeof item === 'object',
  );
}

function normalizeParent(raw: unknown): { type: 'group' | 'guild'; id: string; name?: string } | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const parent = raw as { type?: unknown; id?: unknown; name?: unknown };
  const id = typeof parent.id === 'string' && parent.id.trim() ? parent.id.trim() : undefined;
  if (!id) return undefined;
  let type: 'group' | 'guild' | undefined;
  if (parent.type === 'group' || parent.type === 'guild') type = parent.type;
  else if (parent.type === 'channel') type = 'guild';
  if (!type) return undefined;
  const name = typeof parent.name === 'string' && parent.name.trim() ? parent.name.trim() : undefined;
  return name ? { type, id, name } : { type, id };
}

function channelFromStoredRow(row: Record<string, unknown>): Record<string, unknown> {
  const parent = parentFromStoredRow(row);
  return {
    id: String(row.channel_id ?? ''),
    type: String(row.channel_type ?? ''),
    ...(row.channel_name != null ? { name: String(row.channel_name) } : {}),
    ...(parent ? { parent } : {}),
  };
}

function parentFromStoredRow(
  row: Record<string, unknown>,
): { type: 'group' | 'guild'; id: string; name?: string } | undefined {
  return normalizeParent({
    type: row.channel_parent_type,
    id: row.channel_parent_id,
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
