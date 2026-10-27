// `@zhin.js/agent` 是可选 peer：这里只做类型导入，运行时不依赖它（错误按 `name` 识别）。
import type { AiAnnouncements, AnnouncementRecord, AnnouncementStatus, AnnouncementTransition } from '@zhin.js/agent';
import { PluginConsoleRpcError, type PluginConsoleRpcInput, type PluginConsoleRpcJson, type PluginConsoleRpcMethod, type PluginConsoleRpcStatus } from '@zhin.js/plugin-runtime';
import { formatCompact, getLogger } from '@zhin.js/logger';
import type { AnnouncementDispatcher, AnnouncementDispatchResult } from '../agent/turn/announcement-dispatch.js';
import { OPS_APPROVE_PERMISSION } from './tool-approvals.js';

/**
 * 公告 Console RPC（ADR 0037 §1.2 / §5，切片 B）。本期只做 Host RPC，Console 页面另行实现。
 *
 * 读（`control:read`）：
 * - `plugin.root.announcements`：`{ platform, sceneId, status? }` → 该会话的公告（新的在前）。
 * - `plugin.root.announcement`：`{ id }` → 单条。
 * 写（动作；全部带 `expectedRevision`，不符返回 `conflict` 且不覆盖）。起草 / 编辑 / 提交要 `control:write`；
 * 审批类（approve / reject / resend）要 `ops:approve`（ADR 0037 §3，切片 E），只有 `control:write` 不够：
 * - `announcement-create`：`{ platform, sceneId, content, endpoint? }` → 新草稿。
 * - `announcement-edit`：`{ id, expectedRevision, content }` → 改正文，任何非终态都回到 `draft`。
 * - `announcement-submit`：`draft` → `pending`。
 * - `announcement-approve`：`pending` → `approved`，**随即发送**（摘要复核 → 控制面 → 会话画像 → 硬闸，
 *   以这次批准作硬闸批准、不弹第二张卡）；返回发送后的状态（`sent` / `failed`）。
 * - `announcement-reject`：`{ id, expectedRevision, reason? }`，`pending` → `rejected`。
 * - `announcement-resend`：`failed` → `pending`；之后需再 `announcement-approve` 一次才会发送。
 *
 * 读用 `control:read`。`ops:approve` 与硬闸审批卡的结算共用同一权限点。
 * Console RPC 目前拿不到调用者身份，审批人记为 `console`（与 `session-ops-set` 同约定）。
 * 每次迁移由存储写一行 `kind=announcement` 审计。
 */

export const ANNOUNCEMENTS_READ_PERMISSION = 'control:read';
export const ANNOUNCEMENTS_WRITE_PERMISSION = 'control:write';
/** approve / reject / resend（ADR 0037 §3：审批人 = Console 权限，与 `control:write` 分开）。 */
export const ANNOUNCEMENTS_APPROVE_PERMISSION = OPS_APPROVE_PERMISSION;
export const ANNOUNCEMENTS_CONSOLE_ACTOR_ID = 'console';
const SCENE_ID_PATTERN = /^(group|channel):.+/u;
const STATUSES: readonly AnnouncementStatus[] = ['draft', 'pending', 'approved', 'sent', 'rejected', 'expired', 'failed'];

const logger = getLogger('console');

export type AnnouncementsSource = () => AiAnnouncements | undefined;
export type AnnouncementDispatcherSource = () => AnnouncementDispatcher | undefined;

function invalid(message: string): never {
  throw new PluginConsoleRpcError('invalid_input', message);
}

function requireStore(source: AnnouncementsSource): AiAnnouncements {
  const store = source();
  if (!store) throw new PluginConsoleRpcError('unavailable', '机器人还没启动 AI，暂时无法读写公告');
  return store;
}

function onlyFields(input: PluginConsoleRpcInput, fields: readonly string[]): void {
  for (const key of Object.keys(input)) if (!fields.includes(key)) invalid(`不支持的字段：${key}`);
}

function requireId(input: PluginConsoleRpcInput): string {
  const id = input.id;
  if (typeof id !== 'string' || !id.trim() || id.length > 64) invalid('需要公告 id');
  return id;
}

function requireRevision(input: PluginConsoleRpcInput): number {
  const value = input.expectedRevision;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) invalid('需要 expectedRevision（先读出当前 revision）');
  return value;
}

function requireScene(input: PluginConsoleRpcInput): { platform: string; sceneId: string } {
  const { platform, sceneId } = input as { platform?: unknown; sceneId?: unknown };
  if (typeof platform !== 'string' || !platform.trim() || platform.length > 64) invalid('platform 必填');
  if (typeof sceneId !== 'string' || !SCENE_ID_PATTERN.test(sceneId) || sceneId.length > 256) invalid('sceneId 形如 group:123（<scope>:<sceneId>）');
  return { platform, sceneId };
}

export function announcementJson(record: AnnouncementRecord): PluginConsoleRpcJson {
  return {
    id: record.id,
    platform: record.platform,
    sceneId: record.sceneId,
    endpoint: record.endpoint,
    content: record.content,
    contentHash: record.contentHash,
    approvedHash: record.approvedHash,
    status: record.status,
    createdBy: record.createdBy,
    createdVia: record.createdVia,
    approvedBy: record.approvedBy,
    approvedAt: record.approvedAt,
    submittedAt: record.submittedAt,
    sentAt: record.sentAt,
    revision: record.revision,
    error: record.error,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  } as unknown as PluginConsoleRpcJson;
}

function transitionJson(transition: AnnouncementTransition, dispatched?: AnnouncementDispatchResult): PluginConsoleRpcJson {
  const record = dispatched && dispatched.record ? dispatched.record : transition.record;
  return {
    announcement: announcementJson(record),
    from: transition.from,
    to: transition.to,
    reasonCode: transition.reasonCode,
    ...(dispatched ? { send: { result: dispatched.kind, ...(dispatched.kind === 'failed' ? { reason: dispatched.reason } : {}) } } : {}),
  } as unknown as PluginConsoleRpcJson;
}

function mapError(error: unknown): never {
  if (error instanceof PluginConsoleRpcError) throw error;
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : String(error);
  if (name === 'AnnouncementRevisionConflictError') throw new PluginConsoleRpcError('conflict', '公告已被修改，请刷新后再试（revision 不一致，未覆盖）');
  if (name === 'AnnouncementNotFoundError') throw new PluginConsoleRpcError('not_found', '找不到这条公告');
  if (name === 'AnnouncementStateError') throw new PluginConsoleRpcError('conflict', `当前状态不能执行这个操作：${message}`);
  if (name === 'AnnouncementValidationError') throw new PluginConsoleRpcError('invalid_input', `公告内容不正确：${message}`);
  if (name === 'AnnouncementUnavailableError') throw new PluginConsoleRpcError('unavailable', '暂时读不到公告存储，未生效，请稍后再试');
  logger.warn(formatCompact({ op: 'announcement_rpc_failed', error: message }));
  throw new PluginConsoleRpcError('unavailable', '公告操作失败，未生效，请稍后再试');
}

async function guarded<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    mapError(error);
  }
}

export function announcementQueries(source: AnnouncementsSource): Record<string, PluginConsoleRpcStatus> {
  return {
    announcements: {
      requiredPermissions: [ANNOUNCEMENTS_READ_PERMISSION],
      handler: async (input) => {
        onlyFields(input, ['platform', 'sceneId', 'status']);
        const scene = requireScene(input);
        const status = input.status;
        if (status !== undefined && (typeof status !== 'string' || !STATUSES.includes(status as AnnouncementStatus))) invalid('status 不正确');
        const store = requireStore(source);
        const rows = await guarded(() => store.list({ ...scene, ...(status ? { status: status as AnnouncementStatus } : {}) }));
        return { announcements: rows.map(announcementJson), persistent: store.persistent } as unknown as PluginConsoleRpcJson;
      },
    },
    announcement: {
      requiredPermissions: [ANNOUNCEMENTS_READ_PERMISSION],
      handler: async (input) => {
        onlyFields(input, ['id']);
        const id = requireId(input);
        const record = await guarded(() => requireStore(source).get(id));
        if (!record) throw new PluginConsoleRpcError('not_found', '找不到这条公告');
        return announcementJson(record);
      },
    },
  };
}

export function announcementActions(source: AnnouncementsSource, dispatcher: AnnouncementDispatcherSource): Record<string, PluginConsoleRpcMethod> {
  const write = (handler: PluginConsoleRpcMethod['handler']): PluginConsoleRpcMethod => ({
    requiredPermissions: [ANNOUNCEMENTS_WRITE_PERMISSION],
    handler,
  });
  const approve = (handler: PluginConsoleRpcMethod['handler']): PluginConsoleRpcMethod => ({
    requiredPermissions: [ANNOUNCEMENTS_APPROVE_PERMISSION],
    handler,
  });
  const actorId = ANNOUNCEMENTS_CONSOLE_ACTOR_ID;
  return {
    'announcement-create': write(async (input) => {
      onlyFields(input, ['platform', 'sceneId', 'content', 'endpoint']);
      const scene = requireScene(input);
      if (typeof input.content !== 'string') invalid('content 必填');
      if (input.endpoint !== undefined && (typeof input.endpoint !== 'string' || input.endpoint.length > 128)) invalid('endpoint 不正确');
      const store = requireStore(source);
      const transition = await guarded(() => store.create({
        ...scene,
        content: input.content as string,
        createdBy: actorId,
        createdVia: 'console',
        ...(typeof input.endpoint === 'string' ? { endpoint: input.endpoint } : {}),
      }));
      return transitionJson(transition);
    }),
    'announcement-edit': write(async (input) => {
      onlyFields(input, ['id', 'expectedRevision', 'content']);
      const id = requireId(input);
      const expectedRevision = requireRevision(input);
      if (typeof input.content !== 'string') invalid('content 必填');
      const store = requireStore(source);
      return transitionJson(await guarded(() => store.edit({ id, expectedRevision, actorId, content: input.content as string })));
    }),
    'announcement-submit': write(async (input) => {
      onlyFields(input, ['id', 'expectedRevision']);
      const id = requireId(input);
      const expectedRevision = requireRevision(input);
      const store = requireStore(source);
      return transitionJson(await guarded(() => store.submit({ id, expectedRevision, actorId })));
    }),
    'announcement-approve': approve(async (input) => {
      onlyFields(input, ['id', 'expectedRevision']);
      const id = requireId(input);
      const expectedRevision = requireRevision(input);
      const store = requireStore(source);
      const engine = dispatcher();
      // 没有发送引擎时不批准：避免留下一条「已批准却没人发」的公告。
      if (!engine) throw new PluginConsoleRpcError('unavailable', '发送通道还没就绪，暂时不能批准公告');
      const transition = await guarded(() => store.approve({ id, expectedRevision, actorId }));
      const dispatched = await guarded(() => engine.dispatch(transition.record.id));
      return transitionJson(transition, dispatched);
    }),
    'announcement-reject': approve(async (input) => {
      onlyFields(input, ['id', 'expectedRevision', 'reason']);
      const id = requireId(input);
      const expectedRevision = requireRevision(input);
      if (input.reason !== undefined && typeof input.reason !== 'string') invalid('reason 必须是文本');
      const store = requireStore(source);
      return transitionJson(await guarded(() => store.reject({ id, expectedRevision, actorId, ...(typeof input.reason === 'string' ? { reason: input.reason } : {}) })));
    }),
    'announcement-resend': approve(async (input) => {
      onlyFields(input, ['id', 'expectedRevision']);
      const id = requireId(input);
      const expectedRevision = requireRevision(input);
      const store = requireStore(source);
      return transitionJson(await guarded(() => store.resend({ id, expectedRevision, actorId })));
    }),
  };
}
