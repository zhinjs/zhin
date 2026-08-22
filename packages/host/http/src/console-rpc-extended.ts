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
 * - request.list：优先 `management.listRequests()`（live endpoint）；否则回退
 *   unified_inbox_request。审批始终走 approveRequest/rejectRequest。
 * - inbox（历史）：`ctx.databaseHost.models`（unified_inbox_message/request/notice，
 *   表不存在或查询失败 → 空数组 + inboxEnabled:false；requestConsumed/noticeConsumed
 *   按行 id update consumed=1，表/model 缺失时报"未接线"）。
 * - 社交/群管：`ctx.withEndpointManagement` 在固定 generation lease 内
 *   消费 `management` 语义端口；平台 SDK 字段归一化由 Adapter 负责。
 */

/** 新 Runtime 统一收件箱表名（SSOT：@zhin.js/plugin-runtime inbox.js）。 */
import {
  assertDemoConsoleRpcAllowed,
  normalizeConsoleRpcType,
} from '@zhin.js/console-protocol';

const TABLE_MESSAGE = 'unified_inbox_message';
const TABLE_REQUEST = 'unified_inbox_request';
const TABLE_NOTICE = 'unified_inbox_notice';

export interface ConsoleRpcExtendedCtx {
  /** full scope 才允许写操作；demo scope 只放行只读 RPC。 */
  fullScope: boolean;
  projectRoot: string;
  /** Plugin Runtime ScheduleHost（basic/cli schedule-host-installer 提供）。 */
  scheduleHost?: unknown;
  /** 在固定 generation lease 内执行一次 Endpoint 管理操作。 */
  withEndpointManagement?: <T>(
    adapter: string,
    endpointKey: string,
    run: (management: EndpointManagementPort) => T | Promise<T>,
  ) => Promise<T | null>;
  /** Plugin Runtime DatabaseHost 的 models 视图。 */
  databaseHost?: { models: { get(name: string): unknown } };
  /** Narrow generation-bound persistent-job port; null when Assistant is disabled. */
  resolveScheduleEngine?: () => ConsoleScheduleEngine | null | undefined;
  /** LoginAssist list/submit/cancel（刷新后仍可消费扫码/滑块待办）。 */
  loginAssist?: {
    listPending(): readonly {
      id: string;
      adapter: string;
      endpointKey: string;
      type: string;
      payload: Record<string, unknown>;
      createdAt: number;
      expiresAt?: number;
    }[];
    submit(id: string, value: string | Record<string, unknown>): boolean;
    cancel(id: string, reason?: string): boolean;
  };
  /** Authenticated Root adapter; mutation DTOs deliberately contain no principal/decision fields. */
  workroomProfileControl?: ConsoleWorkroomProfileControlPort;
  /** Authenticated HTTP principal; never accepted from the RPC body. */
  authenticatedPrincipal?: Readonly<{ principalId: string }>;
  workroomKnowledgeControl?: ConsoleWorkroomKnowledgeControlPort;
}

export interface ConsoleWorkroomProfileControlPort {
  publishPack(command: Readonly<{ operationId: string; pack: unknown }>,
    authenticatedPrincipal: Readonly<{ principalId: string }>): Promise<unknown>;
  publishProfile(command: Readonly<{
    operationId: string;
    projectId: string;
    expectedRegistryRevision: number;
    overlay: unknown;
    activate: boolean;
  }>, authenticatedPrincipal: Readonly<{ principalId: string }>): Promise<unknown>;
  publishRollback(command: Readonly<{
    operationId: string;
    projectId: string;
    expectedRegistryRevision: number;
    restoredFromRevisionId: string;
    overlay: unknown;
    activate: boolean;
  }>, authenticatedPrincipal: Readonly<{ principalId: string }>): Promise<unknown>;
  publishPlanningPolicy(command: Readonly<{
    operationId: string;
    projectId: string;
    profileRevisionId: string;
    revision: number;
    expectedPreviousDigest?: string;
    policy: unknown;
  }>, authenticatedPrincipal: Readonly<{ principalId: string }>): Promise<unknown>;
}

export interface ConsoleWorkroomKnowledgeControlPort {
  read(projectId: string): Promise<unknown>;
  publish(command: Readonly<{
    operationId: string; projectId: string; expectedRevision: number; entries: readonly unknown[];
  }>, authenticatedPrincipal: Readonly<{ principalId: string }>): Promise<unknown>;
  rollback(command: Readonly<{
    operationId: string; projectId: string; expectedRevision: number; restoreRevision: number;
  }>, authenticatedPrincipal: Readonly<{ principalId: string }>): Promise<unknown>;
}

export interface ConsoleScheduleEngine {
  addJob(job: Record<string, unknown>): Promise<Record<string, unknown>>;
  removeJob(id: string): Promise<boolean>;
  pauseJob(id: string): Promise<boolean>;
  resumeJob(id: string): Promise<boolean>;
  listJobs(): Promise<Record<string, unknown>[]>;
}

export type ExtendedRpcResult = { data: unknown } | { error: string };

const CRON_NOT_WIRED =
  '持久化调度未接线：当前 Plugin Runtime ScheduleHost 仅支持插件注册的内存任务（list），' +
  '不支持 add/remove/pause/resume（需要 @zhin.js/agent 持久化调度引擎）';

const CONSUMED_NOT_WIRED =
  '收件箱已读标记未接线：unified_inbox_request/notice 表未注册或 DatabaseHost 未启动';

interface ScheduleJobRow {
  id: string;
  cron: string;
  description?: string;
}

interface InboxSelection {
  where(query: Record<string, unknown>): InboxSelection;
  /** 可选：DB 侧排序下推（wrapModel 链具备该能力，轻量 fake 可缺失）。 */
  orderBy?(field: string, direction?: 'ASC' | 'DESC'): InboxSelection;
  /** 可选：DB 侧 limit 下推。 */
  limit?(count: number): InboxSelection;
  then<TResult1 = Record<string, unknown>[], TResult2 = never>(
    onfulfilled?: ((value: Record<string, unknown>[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2>;
}

interface InboxModel {
  select(): InboxSelection;
  update?(patch: Record<string, unknown>): {
    where(query: Record<string, unknown>): Promise<unknown> | unknown;
  };
}

interface EndpointManagementPort {
  listFriends?(): Promise<readonly { user_id: number | string; nickname: string; remark: string }[]>;
  listGroups?(): Promise<readonly { group_id: number | string; name: string }[]>;
  listChannels?(): Promise<readonly {
    id: string;
    name?: string;
    parent?: { type: string; id: string; name?: string };
  }[]>;
  listGroupMembers?(groupId: string): Promise<readonly unknown[]>;
  listRequests?(): Promise<readonly {
    platform_request_id: string;
    type: string;
    scene_type?: string | null;
    scene_id: string;
    sub_type?: string | null;
    actor_id: string;
    actor_name?: string | null;
    comment?: string | null;
    created_at: number;
  }[]>;
  approveRequest?(requestId: string, remark?: string): Promise<void>;
  rejectRequest?(requestId: string, reason?: string): Promise<void>;
  kickGroupMember?(groupId: string, userId: string): Promise<void>;
  muteGroupMember?(groupId: string, userId: string, durationSeconds: number): Promise<void>;
  setGroupAdmin?(groupId: string, userId: string, enabled: boolean): Promise<void>;
  deleteFriend?(userId: string): Promise<void>;
}

export async function dispatchExtendedConsoleRpc(
  type: string,
  data: Record<string, unknown> | undefined,
  ctx: ConsoleRpcExtendedCtx,
): Promise<ExtendedRpcResult | undefined> {
  const d = data ?? {};
  type = normalizeConsoleRpcType(type);

  if (!ctx.fullScope) {
    const denied = assertDemoConsoleRpcAllowed(type);
    if (denied) return { error: denied };
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

    case 'request.list':
      return listPendingRequests(d, ctx);
    case 'inbox.requests':
      return listInbox(d, ctx, TABLE_REQUEST, 'requests', mapRequestRow);
    case 'inbox.notices':
      return listInbox(d, ctx, TABLE_NOTICE, 'notices', mapNoticeRow);
    case 'inbox.messages':
      return listInboxMessages(d, ctx);

    case 'request.approve':
    case 'request.reject':
      return actOnRequest(type, d, ctx);

    case 'login.list':
      return listLoginPending(ctx);
    case 'login.submit':
      return submitLogin(d, ctx);
    case 'login.cancel':
      return cancelLogin(d, ctx);

    case 'request.consumed':
      return markInboxConsumed(d, ctx, TABLE_REQUEST);
    case 'notice.consumed':
      return markInboxConsumed(d, ctx, TABLE_NOTICE);

    case 'endpoint.friends':
      return listFriends(d, ctx);
    case 'endpoint.groups':
      return listGroups(d, ctx);
    case 'endpoint.channels':
      return listChannels(d, ctx);
    case 'endpoint.group_members':
      return listGroupMembers(d, ctx);

    case 'endpoint.group_kick':
      return groupWriteOp(d, ctx, {
        method: 'kickGroupMember',
        buildArgs: (gid, uid) => [gid, uid],
        requireUser: true,
        unsupported: '踢出群成员',
      });
    case 'endpoint.group_mute':
      return groupWriteOp(d, ctx, {
        method: 'muteGroupMember',
        buildArgs: (gid, uid, extra) => [gid, uid, extra.duration ?? 600],
        requireUser: true,
        unsupported: '禁言群成员',
      });
    case 'endpoint.group_admin':
      return groupWriteOp(d, ctx, {
        method: 'setGroupAdmin',
        buildArgs: (gid, uid, extra) => [gid, uid, extra.enable !== false],
        requireUser: true,
        unsupported: '设置群管理员',
      });
    case 'endpoint.delete_friend':
      return deleteFriend(d, ctx);

    case 'workroom.profile.pack.publish':
    case 'workroom.profile.publish':
    case 'workroom.profile.rollback':
    case 'workroom.profile.policy.publish':
      return mutateWorkroomProfile(type, d, ctx);

    case 'workroom.knowledge.get':
    case 'workroom.knowledge.publish':
    case 'workroom.knowledge.rollback':
      return mutateWorkroomKnowledge(type, d, ctx);

    default:
      return undefined;
  }
}

async function mutateWorkroomProfile(
  type: 'workroom.profile.pack.publish' | 'workroom.profile.publish'
    | 'workroom.profile.rollback' | 'workroom.profile.policy.publish',
  data: Record<string, unknown>,
  ctx: ConsoleRpcExtendedCtx,
): Promise<ExtendedRpcResult> {
  const control = ctx.workroomProfileControl;
  if (!control) return { error: 'Workroom Profile authority control is unavailable' };
  for (const forbidden of [
    'authenticatedPrincipalId', 'principalId', 'decision', 'governance', 'approval', 'authority',
  ]) {
    if (forbidden in data) return { error: `Console Workroom Profile request cannot carry ${forbidden}` };
  }
  const principal = ctx.authenticatedPrincipal;
  if (!principal) return { error: 'Workroom Profile control requires an authenticated principal' };
  try {
    const operationId = requiredRpcText(data.operationId, 'operationId');
    if (type === 'workroom.profile.pack.publish') {
      return { data: await control.publishPack(Object.freeze({ operationId, pack: requiredRpcValue(data.pack, 'pack') }), principal) };
    }
    const projectId = requiredRpcText(data.projectId, 'projectId');
    if (type === 'workroom.profile.policy.publish') {
      const expectedPreviousDigest = optionalRpcText(data.expectedPreviousDigest, 'expectedPreviousDigest');
      return { data: await control.publishPlanningPolicy(Object.freeze({
        operationId,
        projectId,
        profileRevisionId: requiredRpcText(data.profileRevisionId, 'profileRevisionId'),
        revision: requiredRpcInteger(data.revision, 'revision'),
        ...(expectedPreviousDigest ? { expectedPreviousDigest } : {}),
        policy: requiredRpcValue(data.policy, 'policy'),
      }), principal) };
    }
    const common = {
      operationId,
      projectId,
      expectedRegistryRevision: requiredRpcInteger(data.expectedRegistryRevision, 'expectedRegistryRevision', -1),
      overlay: requiredRpcValue(data.overlay, 'overlay'),
      activate: requiredRpcBoolean(data.activate, 'activate'),
    };
    return type === 'workroom.profile.rollback'
      ? { data: await control.publishRollback(Object.freeze({
          ...common,
          restoredFromRevisionId: requiredRpcText(data.restoredFromRevisionId, 'restoredFromRevisionId'),
        }), principal) }
      : { data: await control.publishProfile(Object.freeze(common), principal) };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

async function mutateWorkroomKnowledge(
  type: 'workroom.knowledge.get' | 'workroom.knowledge.publish' | 'workroom.knowledge.rollback',
  data: Record<string, unknown>,
  ctx: ConsoleRpcExtendedCtx,
): Promise<ExtendedRpcResult> {
  const control = ctx.workroomKnowledgeControl;
  if (!control) return { error: 'Workroom Knowledge control is unavailable' };
  for (const forbidden of [
    'authenticatedPrincipalId', 'principalId', 'ownerPrincipalId', 'source', 'decision',
    'governance', 'approval', 'authority', 'body', 'content',
  ]) {
    if (forbidden in data) return { error: `Console Workroom Knowledge request cannot carry ${forbidden}` };
  }
  try {
    const projectId = requiredRpcText(data.projectId, 'projectId');
    if (type === 'workroom.knowledge.get') return { data: await control.read(projectId) };
    const principal = ctx.authenticatedPrincipal;
    if (!principal) return { error: 'Workroom Knowledge mutation requires an authenticated principal' };
    const common = {
      operationId: requiredRpcText(data.operationId, 'operationId'), projectId,
      expectedRevision: requiredRpcInteger(data.expectedRevision, 'expectedRevision', -1),
    };
    if (type === 'workroom.knowledge.rollback') {
      return { data: await control.rollback(Object.freeze({
        ...common, restoreRevision: requiredRpcInteger(data.restoreRevision, 'restoreRevision', 0),
      }), principal) };
    }
    if (!Array.isArray(data.entries)) throw new Error('entries is invalid');
    return { data: await control.publish(Object.freeze({ ...common, entries: structuredClone(data.entries) }), principal) };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

function requiredRpcValue(value: unknown, name: string): unknown {
  if (value === undefined || value === null) throw new Error(`${name} is required`);
  return structuredClone(value);
}

function requiredRpcText(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
    throw new Error(`${name} is invalid`);
  }
  return value;
}

function optionalRpcText(value: unknown, name: string): string | undefined {
  return value === undefined ? undefined : requiredRpcText(value, name);
}

function requiredRpcInteger(value: unknown, name: string, minimum = 1): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) throw new Error(`${name} is invalid`);
  return Number(value);
}

function requiredRpcBoolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${name} is invalid`);
  return value;
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
        // console cron 页渲染字段（由 schedule host 提供时透传）
        expression: (job as { expression?: string }).expression ?? job.cron,
        running: (job as { running?: boolean }).running ?? true,
        ...((job as { plugin?: string }).plugin ? { plugin: (job as { plugin?: string }).plugin } : {}),
        ...((job as { nextExecution?: number }).nextExecution
          ? { nextExecution: (job as { nextExecution?: number }).nextExecution } : {}),
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
      createdAt: (job as { createdAt?: number }).createdAt,
      nextExecution: (job.state as { nextRunAtMs?: number } | undefined)?.nextRunAtMs,
      ...((job.notify as { target?: unknown } | undefined)?.target
        ? { context: { target: (job.notify as { target?: unknown }).target } } : {}),
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
  options?: {
    /** DB 侧排序下推（模型不支持时由调用方内存排序兜底）。 */
    orderBy?: { field: string; direction?: 'ASC' | 'DESC' };
    /** DB 侧 limit 下推（模型不支持时由调用方内存分页兜底）。 */
    limit?: number;
  },
): Promise<{ rows: Record<string, unknown>[]; enabled: boolean }> {
  const model = getInboxModel(ctx, table);
  if (!model) return { rows: [], enabled: false };
  try {
    let selection: InboxSelection = model.select().where(where);
    if (options?.orderBy && typeof selection.orderBy === 'function') {
      selection = selection.orderBy(options.orderBy.field, options.orderBy.direction ?? 'DESC');
    }
    if (options?.limit != null && typeof selection.limit === 'function') {
      selection = selection.limit(options.limit);
    }
    const rows = await selection;
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
  const endpointKey = strField(d, '$endpoint', 'endpointKey', 'endpoint');
  if (!adapter || !endpointKey) return { error: '$adapter and $endpoint required' };
  const limit = Math.min(numField(d, 30, '$limit', 'limit'), 100);
  const offset = Math.max(0, numField(d, 0, '$offset', 'offset'));
  const { rows, enabled } = await readInboxRows(ctx, table, {
    adapter,
    endpoint_id: endpointKey,
  }, {
    // sort/limit 下推到 DB 侧（内存 sort/slice 保留，作为无下推能力模型的兜底）
    orderBy: { field: 'created_at', direction: 'DESC' },
    limit: offset + limit,
  });
  const sorted = rows
    .slice()
    .sort((a, b) => Number(b.created_at ?? 0) - Number(a.created_at ?? 0))
    .slice(offset, offset + limit)
    .map(mapRow);
  return { data: { [key]: sorted, inboxEnabled: enabled } };
}

/** request.list —— 优先 live EndpointManagement.listRequests；否则回退 unified_inbox_request。 */
async function listPendingRequests(
  d: Record<string, unknown>,
  ctx: ConsoleRpcExtendedCtx,
): Promise<ExtendedRpcResult> {
  const adapter = strField(d, '$adapter', 'adapter');
  const endpointKey = strField(d, '$endpoint', 'endpointKey', 'endpoint');
  if (!adapter || !endpointKey) return { error: '$adapter and $endpoint required' };

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

async function listInboxMessages(
  d: Record<string, unknown>,
  ctx: ConsoleRpcExtendedCtx,
): Promise<ExtendedRpcResult> {
  const adapter = strField(d, '$adapter', 'adapter');
  const endpointKey = strField(d, '$endpoint', 'endpointKey', 'endpoint');
  const channelId = strField(d, '$channel_id', 'channelId', 'channel_id');
  const channelType = strField(d, '$channel_type', 'channelType', 'channel_type');
  if (!adapter || !endpointKey || !channelId || !channelType) {
    return { error: '$adapter, $endpoint, $channel_id, $channel_type required' };
  }
  const limit = Math.min(numField(d, 50, '$limit', 'limit'), 100);
  const beforeTs = optionalNum(d, '$before_ts', 'beforeTs', 'before_ts');
  const beforeId = optionalNum(d, '$before_id', 'beforeId', 'before_id');
  const parent = normalizeParent(d.$parent ?? d.parent);

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
  const actorId = row.actor_id;
  const actorName = row.actor_name ?? undefined;
  const sceneId = row.scene_id;
  const sceneType = row.scene_type ?? undefined;
  return {
    id: row.id,
    platform_request_id: row.platform_request_id,
    // console endpoint-detail 期望的 camelCase/扁平别名（SSE 推送路径同款形状）
    platformRequestId: row.platform_request_id,
    type: row.type,
    scene_type: sceneType,
    scene_id: sceneId,
    channel_id: sceneId,
    channel_type: sceneType,
    channel: { id: sceneId, type: sceneType },
    sub_type: row.sub_type ?? undefined,
    actor: { id: actorId, name: actorName },
    sender: { id: actorId, name: actorName },
    sender_id: actorId,
    sender_name: actorName,
    comment: row.comment ?? undefined,
    created_at: row.created_at,
    timestamp: row.created_at,
    resolved: row.resolved,
    resolved_at: row.resolved_at ?? undefined,
  };
}

function mapNoticeRow(row: Record<string, unknown>): Record<string, unknown> {
  const actorId = row.actor_id ?? undefined;
  const actorName = row.actor_name ?? undefined;
  const sceneId = row.scene_id;
  const sceneType = row.scene_type ?? undefined;
  return {
    id: row.id,
    platform_notice_id: row.platform_notice_id,
    type: row.type,
    scene_type: sceneType,
    scene_id: sceneId,
    channel_id: sceneId,
    channel_type: sceneType,
    sub_type: row.sub_type ?? undefined,
    actor_id: actorId,
    actor_name: actorName,
    // console endpoint-detail 期望的操作人字段别名
    operator_id: actorId,
    operator_name: actorName,
    target_id: row.target_id ?? undefined,
    target_name: row.target_name ?? undefined,
    payload: row.payload,
    created_at: row.created_at,
    timestamp: row.created_at,
  };
}

// ---------------------------------------------------------------- consumed 标记

/**
 * request.consumed / notice.consumed —— 按行 id 置 consumed=1。
 * 表未注册（或 model 无 update）时保持"未接线"报错。
 */
async function markInboxConsumed(
  d: Record<string, unknown>,
  ctx: ConsoleRpcExtendedCtx,
  table: string,
): Promise<ExtendedRpcResult> {
  const ids = numArrayField(d, '$row_ids', 'row_ids', 'rowIds', '$ids', 'ids');
  // console UI 单条已读发 data:{id}，归一为数组
  if (ids.length === 0) {
    const single = Number(d.id ?? d.$id);
    if (Number.isFinite(single) && single > 0) ids.push(single);
  }
  if (ids.length === 0) return { error: '$row_ids required' };
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

async function actOnRequest(
  type: 'request.approve' | 'request.reject',
  d: Record<string, unknown>,
  ctx: ConsoleRpcExtendedCtx,
): Promise<ExtendedRpcResult> {
  const adapter = strField(d, '$adapter', 'adapter');
  const endpointKey = strField(d, '$endpoint', 'endpointKey', 'endpoint');
  const requestId = strField(d, '$id', 'id', 'platformRequestId', 'platform_request_id', 'requestId');
  if (!adapter || !endpointKey || !requestId) {
    return { error: '$adapter, $endpoint, $id required' };
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
      ? strField(d, '$remark', 'remark')
      : strField(d, '$reason', 'reason');
    await method.call(management, requestId, extra || undefined);
    return { data: { success: true } };
  });
}

function listLoginPending(ctx: ConsoleRpcExtendedCtx): ExtendedRpcResult {
  const assist = ctx.loginAssist;
  if (!assist) return { error: '登录辅助未接线（LoginAssist 未挂载）' };
  const tasks = assist.listPending().map((task) => ({
    id: task.id,
    adapter: task.adapter,
    endpointKey: task.endpointKey,
    type: task.type,
    payload: task.payload,
    createdAt: task.createdAt,
    expiresAt: task.expiresAt,
  }));
  return { data: { tasks, count: tasks.length } };
}

function submitLogin(
  d: Record<string, unknown>,
  ctx: ConsoleRpcExtendedCtx,
): ExtendedRpcResult {
  const assist = ctx.loginAssist;
  if (!assist) return { error: '登录辅助未接线（LoginAssist 未挂载）' };
  const id = strField(d, '$id', 'id', 'taskId');
  if (!id) return { error: '$id required' };
  const raw = d.$value ?? d.value ?? d.ticket ?? d.code ?? '';
  const value = typeof raw === 'string' || (raw && typeof raw === 'object')
    ? raw as string | Record<string, unknown>
    : String(raw ?? '');
  const ok = assist.submit(id, value);
  if (!ok) return { error: `login task not found: ${id}` };
  return { data: { success: true } };
}

function cancelLogin(
  d: Record<string, unknown>,
  ctx: ConsoleRpcExtendedCtx,
): ExtendedRpcResult {
  const assist = ctx.loginAssist;
  if (!assist) return { error: '登录辅助未接线（LoginAssist 未挂载）' };
  const id = strField(d, '$id', 'id', 'taskId');
  if (!id) return { error: '$id required' };
  const reason = strField(d, '$reason', 'reason') || 'cancelled';
  const ok = assist.cancel(id, reason);
  if (!ok) return { error: `login task not found: ${id}` };
  return { data: { success: true } };
}

// ---------------------------------------------------------------- 社交读取

async function listFriends(
  d: Record<string, unknown>,
  ctx: ConsoleRpcExtendedCtx,
): Promise<ExtendedRpcResult> {
  const endpoint = requireEndpointAddress(d);
  if ('error' in endpoint) return endpoint;
  return withLiveEndpoint(ctx, endpoint.adapter, endpoint.endpointKey, async (management) => {
    if (management.listFriends) {
      const friends = [...await management.listFriends()];
      return { data: { friends, count: friends.length } };
    }
    return { error: `当前适配器（${endpoint.adapter}）不支持好友列表` };
  });
}

async function listGroups(
  d: Record<string, unknown>,
  ctx: ConsoleRpcExtendedCtx,
): Promise<ExtendedRpcResult> {
  const endpoint = requireEndpointAddress(d);
  if ('error' in endpoint) return endpoint;
  return withLiveEndpoint(ctx, endpoint.adapter, endpoint.endpointKey, async (management) => {
    if (management.listGroups) {
      const groups = [...await management.listGroups()];
      return { data: { groups, count: groups.length } };
    }
    return { error: `当前适配器（${endpoint.adapter}）不支持群列表` };
  });
}

async function listChannels(
  d: Record<string, unknown>,
  ctx: ConsoleRpcExtendedCtx,
): Promise<ExtendedRpcResult> {
  const endpoint = requireEndpointAddress(d);
  if ('error' in endpoint) return endpoint;
  return withLiveEndpoint(ctx, endpoint.adapter, endpoint.endpointKey, async (management) => {
    if (management.listChannels) {
      const channels = [...await management.listChannels()];
      return { data: { channels, count: channels.length } };
    }
    return { error: `当前适配器（${endpoint.adapter}）不支持频道列表` };
  });
}

async function listGroupMembers(
  d: Record<string, unknown>,
  ctx: ConsoleRpcExtendedCtx,
): Promise<ExtendedRpcResult> {
  const adapter = strField(d, '$adapter', 'adapter');
  const endpointKey = strField(d, '$endpoint', 'endpointKey', 'endpoint');
  const groupId = strField(d, '$group_id', 'groupId', 'group_id');
  if (!adapter || !endpointKey || !groupId) {
    return { error: '$adapter, $endpoint, $group_id required' };
  }
  return withLiveEndpoint(ctx, adapter, endpointKey, async (management) => {
    const method = management.listGroupMembers;
    if (!method) {
      return { error: `当前适配器（${adapter}）不支持群成员列表` };
    }
    const members = [...await method(groupId)];
    return { data: { members, count: members.length } };
  });
}

// ---------------------------------------------------------------- 群管/好友写操作

interface GroupWriteSpec {
  method: 'kickGroupMember' | 'muteGroupMember' | 'setGroupAdmin';
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
  const endpointKey = strField(d, '$endpoint', 'endpointKey', 'endpoint');
  const groupId = strField(d, '$group_id', 'groupId', 'group_id');
  const userId = strField(d, '$user_id', 'userId', 'user_id');
  if (!adapter || !endpointKey || !groupId) {
    return { error: '$adapter, $endpoint, $group_id required' };
  }
  if (spec.requireUser && !userId) {
    return { error: '$user_id required' };
  }
  return withLiveEndpoint(ctx, adapter, endpointKey, async (management) => {
    const method = management[spec.method];
    if (!method) {
      return { error: `当前适配器（${adapter}）不支持${spec.unsupported}` };
    }
    const durationRaw = d.$duration ?? d.duration;
    const enableRaw = d.$enable ?? d.enable;
    const args = spec.buildArgs(groupId, userId, {
      duration: typeof durationRaw === 'number' && Number.isFinite(durationRaw)
        ? durationRaw
        : undefined,
      enable: typeof enableRaw === 'boolean' ? enableRaw : undefined,
    });
    await (method as (...args: unknown[]) => Promise<void>).call(management, ...args);
    return { data: { success: true } };
  });
}

async function deleteFriend(
  d: Record<string, unknown>,
  ctx: ConsoleRpcExtendedCtx,
): Promise<ExtendedRpcResult> {
  const adapter = strField(d, '$adapter', 'adapter');
  const endpointKey = strField(d, '$endpoint', 'endpointKey', 'endpoint');
  const userId = strField(d, '$user_id', 'userId', 'user_id');
  if (!adapter || !endpointKey || !userId) {
    return { error: '$adapter, $endpoint, $user_id required' };
  }
  return withLiveEndpoint(ctx, adapter, endpointKey, async (management) => {
    const method = management.deleteFriend;
    if (!method) {
      return { error: '当前适配器暂不支持删除好友' };
    }
    await method(userId);
    return { data: { success: true } };
  });
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

/** 数字数组字段（$row_ids 等）：取首个数组值，收敛为有限数字。 */
function numArrayField(d: Record<string, unknown>, ...keys: string[]): number[] {
  for (const key of keys) {
    const value = d[key];
    if (!Array.isArray(value)) continue;
    return value
      .map((item) => Number(item))
      .filter((item) => Number.isFinite(item));
  }
  return [];
}

async function withLiveEndpoint(
  ctx: ConsoleRpcExtendedCtx,
  adapter: string,
  endpointKey: string,
  run: (management: EndpointManagementPort) => ExtendedRpcResult | Promise<ExtendedRpcResult>,
): Promise<ExtendedRpcResult> {
  if (!ctx.withEndpointManagement) {
    return { error: 'Endpoint registry is not configured' };
  }
  try {
    return await ctx.withEndpointManagement(adapter, endpointKey, run)
      ?? { error: 'endpoint not found' };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

function requireEndpointAddress(
  d: Record<string, unknown>,
): { adapter: string; endpointKey: string } | { error: string } {
  const adapter = strField(d, '$adapter', 'adapter');
  const endpointKey = strField(d, '$endpoint', 'endpointKey', 'endpoint');
  if (!adapter || !endpointKey) return { error: '$adapter and $endpoint required' };
  return { adapter, endpointKey };
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
