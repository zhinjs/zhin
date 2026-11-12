// `@zhin.js/agent` 是可选 peer：这里只做类型导入，运行时不依赖它（错误按 `name` 识别）。
import type { AiSessionEvents, SessionEventRecord, SessionEventStatus, SessionEventTransition } from '@zhin.js/agent';
import { PluginConsoleRpcError, type PluginConsoleRpcInput, type PluginConsoleRpcJson, type PluginConsoleRpcMethod, type PluginConsoleRpcStatus } from '@zhin.js/plugin-runtime';
import { formatCompact, getLogger } from '@zhin.js/logger';

/**
 * 会话日程 Console RPC（ADR 0037 §2 / §5，切片 D）。本期只做 Host RPC，Console 页面另行实现。
 *
 * 读（`control:read`）：
 * - `plugin.root.session-events`：`{ platform, sceneId, status? }` → 该会话的事件（按事件时间升序）。
 * - `plugin.root.session-event`：`{ id }` → 单条。
 * 写（`control:write`，动作；修改 / 取消必须带 `expectedRevision`，不符返回 `conflict` 且不覆盖）：
 * - `session-event-create`：`{ platform, sceneId, title, at, remindBefore?, template?, endpoint? }` → 新事件（`scheduled`）。
 * - `session-event-update`：`{ id, expectedRevision, title?, at?, remindBefore?, template? }`；改时间会重新排期。
 * - `session-event-cancel`：`{ id, expectedRevision }` → `cancelled`（终态，不再提醒）。
 *
 * 修改 / 取消（包括模型建的事件）只在这里；模型工具 `session_event_create` 只能为当前会话创建。
 * Console RPC 目前拿不到调用者身份，操作人记为 `console`（与公告 / `session-ops-set` 同约定）。
 * 每次迁移由存储写一行 `kind=schedule` 审计。
 */

export const SESSION_EVENTS_READ_PERMISSION = 'control:read';
export const SESSION_EVENTS_WRITE_PERMISSION = 'control:write';
export const SESSION_EVENTS_CONSOLE_ACTOR_ID = 'console';
const SCENE_ID_PATTERN = /^(group|channel):.+/u;
const STATUSES: readonly SessionEventStatus[] = ['scheduled', 'done', 'cancelled'];

const logger = getLogger('console');

export type SessionEventsSource = () => AiSessionEvents | undefined;

function invalid(message: string): never {
  throw new PluginConsoleRpcError('invalid_input', message);
}

function requireStore(source: SessionEventsSource): AiSessionEvents {
  const store = source();
  if (!store) throw new PluginConsoleRpcError('unavailable', '机器人还没启动 AI，暂时无法读写会话日程');
  return store;
}

function onlyFields(input: PluginConsoleRpcInput, fields: readonly string[]): void {
  for (const key of Object.keys(input)) if (!fields.includes(key)) invalid(`不支持的字段：${key}`);
}

function requireId(input: PluginConsoleRpcInput): string {
  const id = input.id;
  if (typeof id !== 'string' || !id.trim() || id.length > 64) invalid('需要事件 id');
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

function optionalAt(input: PluginConsoleRpcInput): number | undefined {
  if (input.at === undefined) return undefined;
  if (typeof input.at !== 'number' || !Number.isSafeInteger(input.at)) invalid('at 是毫秒时间戳');
  return input.at;
}

function optionalRemindBefore(input: PluginConsoleRpcInput): number[] | undefined {
  if (input.remindBefore === undefined) return undefined;
  if (!Array.isArray(input.remindBefore) || input.remindBefore.some((item) => typeof item !== 'number')) invalid('remindBefore 是毫秒偏移数组');
  return input.remindBefore as number[];
}

function optionalTemplate(input: PluginConsoleRpcInput): string | null | undefined {
  if (input.template === undefined) return undefined;
  if (input.template !== null && typeof input.template !== 'string') invalid('template 必须是文本');
  return input.template as string | null;
}

export function sessionEventJson(record: SessionEventRecord): PluginConsoleRpcJson {
  return {
    id: record.id,
    platform: record.platform,
    sceneId: record.sceneId,
    endpoint: record.endpoint,
    title: record.title,
    at: record.at,
    remindBefore: [...record.remindBefore],
    template: record.template,
    status: record.status,
    fired: [...record.fired],
    createdBy: record.createdBy,
    createdVia: record.createdVia,
    revision: record.revision,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  } as unknown as PluginConsoleRpcJson;
}

function transitionJson(transition: SessionEventTransition): PluginConsoleRpcJson {
  return {
    event: sessionEventJson(transition.record),
    from: transition.from,
    to: transition.to,
    reasonCode: transition.reasonCode,
  } as unknown as PluginConsoleRpcJson;
}

function mapError(error: unknown): never {
  if (error instanceof PluginConsoleRpcError) throw error;
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : String(error);
  if (name === 'SessionEventRevisionConflictError') throw new PluginConsoleRpcError('conflict', '事件已被修改，请刷新后再试（revision 不一致，未覆盖）');
  if (name === 'SessionEventNotFoundError') throw new PluginConsoleRpcError('not_found', '找不到这个事件');
  if (name === 'SessionEventStateError') throw new PluginConsoleRpcError('conflict', `当前状态不能执行这个操作：${message}`);
  if (name === 'SessionEventValidationError') throw new PluginConsoleRpcError('invalid_input', `事件内容不正确：${message}`);
  if (name === 'SessionEventUnavailableError') throw new PluginConsoleRpcError('unavailable', '暂时读不到会话日程存储，未生效，请稍后再试');
  logger.warn(formatCompact({ op: 'session_event_rpc_failed', error: message }));
  throw new PluginConsoleRpcError('unavailable', '会话日程操作失败，未生效，请稍后再试');
}

async function guarded<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    mapError(error);
  }
}

export function sessionEventQueries(source: SessionEventsSource): Record<string, PluginConsoleRpcStatus> {
  return {
    'session-events': {
      requiredPermissions: [SESSION_EVENTS_READ_PERMISSION],
      handler: async (input) => {
        onlyFields(input, ['platform', 'sceneId', 'status']);
        const scene = requireScene(input);
        const status = input.status;
        if (status !== undefined && (typeof status !== 'string' || !STATUSES.includes(status as SessionEventStatus))) invalid('status 不正确');
        const store = requireStore(source);
        const rows = await guarded(() => store.list({ ...scene, ...(status ? { status: status as SessionEventStatus } : {}) }));
        return { events: rows.map(sessionEventJson), persistent: store.persistent } as unknown as PluginConsoleRpcJson;
      },
    },
    'session-event': {
      requiredPermissions: [SESSION_EVENTS_READ_PERMISSION],
      handler: async (input) => {
        onlyFields(input, ['id']);
        const id = requireId(input);
        const record = await guarded(() => requireStore(source).get(id));
        if (!record) throw new PluginConsoleRpcError('not_found', '找不到这个事件');
        return sessionEventJson(record);
      },
    },
  };
}

export function sessionEventActions(source: SessionEventsSource): Record<string, PluginConsoleRpcMethod> {
  const write = (handler: PluginConsoleRpcMethod['handler']): PluginConsoleRpcMethod => ({
    requiredPermissions: [SESSION_EVENTS_WRITE_PERMISSION],
    handler,
  });
  const actorId = SESSION_EVENTS_CONSOLE_ACTOR_ID;
  return {
    'session-event-create': write(async (input) => {
      onlyFields(input, ['platform', 'sceneId', 'title', 'at', 'remindBefore', 'template', 'endpoint']);
      const scene = requireScene(input);
      if (typeof input.title !== 'string') invalid('title 必填');
      const at = optionalAt(input);
      if (at === undefined) invalid('at 必填（毫秒时间戳）');
      const remindBefore = optionalRemindBefore(input);
      const template = optionalTemplate(input);
      if (input.endpoint !== undefined && (typeof input.endpoint !== 'string' || input.endpoint.length > 128)) invalid('endpoint 不正确');
      const store = requireStore(source);
      return transitionJson(await guarded(() => store.create({
        ...scene,
        title: input.title as string,
        at,
        ...(remindBefore ? { remindBefore } : {}),
        ...(template !== undefined ? { template } : {}),
        createdBy: actorId,
        createdVia: 'console',
        ...(typeof input.endpoint === 'string' ? { endpoint: input.endpoint } : {}),
      })));
    }),
    'session-event-update': write(async (input) => {
      onlyFields(input, ['id', 'expectedRevision', 'title', 'at', 'remindBefore', 'template']);
      const id = requireId(input);
      const expectedRevision = requireRevision(input);
      if (input.title !== undefined && typeof input.title !== 'string') invalid('title 必须是文本');
      const at = optionalAt(input);
      const remindBefore = optionalRemindBefore(input);
      const template = optionalTemplate(input);
      const store = requireStore(source);
      return transitionJson(await guarded(() => store.update({
        id,
        expectedRevision,
        actorId,
        ...(typeof input.title === 'string' ? { title: input.title } : {}),
        ...(at !== undefined ? { at } : {}),
        ...(remindBefore ? { remindBefore } : {}),
        ...(template !== undefined ? { template } : {}),
      })));
    }),
    'session-event-cancel': write(async (input) => {
      onlyFields(input, ['id', 'expectedRevision']);
      const id = requireId(input);
      const expectedRevision = requireRevision(input);
      const store = requireStore(source);
      return transitionJson(await guarded(() => store.cancel({ id, expectedRevision, actorId })));
    }),
  };
}
