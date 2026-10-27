// `@zhin.js/agent` 是可选 peer：这里只做类型导入，运行时不依赖它（错误按 `name` 识别）。
import { randomUUID } from 'node:crypto';
import type { AiControlPlane, ControlChange, ControlFlagsPatch, ControlSnapshot, DecisionEventLog } from '@zhin.js/agent';
import { PluginConsoleRpcError, type PluginConsoleRpcInput, type PluginConsoleRpcJson, type PluginConsoleRpcMethod, type PluginConsoleRpcStatus } from '@zhin.js/plugin-runtime';
import { formatCompact, getLogger } from '@zhin.js/logger';

/**
 * 控制面 Console RPC（ADR 0036 切片 D）：
 *
 * - `plugin.root.control`（`control:read`）：读四开关的实例默认、会话覆盖、`revision` 与生效顺序。
 * - `plugin.root.control-set`（`control:write`，动作）：改开关；必须带 `expectedRevision`，不符返回 `conflict`
 *   且不覆盖。每个实际变化的范围写一行 `kind=control_change`、`actor=operator`，`payload` 记前后值。
 *
 * 这是唯一的写入口：**模型没有任何工具能读写这些开关**。
 */

export const CONTROL_READ_PERMISSION = 'control:read';
export const CONTROL_WRITE_PERMISSION = 'control:write';
/** 审计 `actor_id`：Console 令牌不带个人身份，统一记为 Console 操作。 */
export const CONTROL_CONSOLE_ACTOR_ID = 'console';
/** ADR 0036 §2 生效顺序（展示用）。 */
export const CONTROL_PRECEDENCE = ['emergency_stop', 'muted:instance', 'muted:session', 'read_only', 'mention_only'] as const;

const SWITCHES = ['emergency_stop', 'muted', 'read_only', 'mention_only'] as const;
const MAX_SESSIONS_PER_SET = 50;

const logger = getLogger('console');

export type ControlPlaneSource = () => AiControlPlane | undefined;
export type ControlAuditSource = () => DecisionEventLog | undefined;

function invalid(message: string): never {
  throw new PluginConsoleRpcError('invalid_input', message);
}

function requirePlane(source: ControlPlaneSource): AiControlPlane {
  const plane = source();
  if (!plane) throw new PluginConsoleRpcError('unavailable', '机器人还没启动 AI，暂时无法读写控制开关');
  return plane;
}

export function controlSnapshotJson(snapshot: ControlSnapshot): PluginConsoleRpcJson {
  return {
    revision: snapshot.revision,
    instance: { ...snapshot.instance },
    sessions: snapshot.sessions.map((entry) => ({ platform: entry.platform, sceneId: entry.sceneId, flags: { ...entry.flags } })),
    updatedAt: snapshot.updatedAt,
    updatedBy: snapshot.updatedBy,
    persistent: snapshot.persistent,
    available: snapshot.available,
    precedence: [...CONTROL_PRECEDENCE],
  } as unknown as PluginConsoleRpcJson;
}

function parseFlags(value: unknown, label: string): ControlFlagsPatch {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`${label} 必须是对象`);
  const out: Record<string, boolean> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (!(SWITCHES as readonly string[]).includes(key)) invalid(`${label} 里有未知开关：${key}`);
    if (typeof item !== 'boolean') invalid(`${label}.${key} 必须是 true / false`);
    out[key] = item;
  }
  return out as ControlFlagsPatch;
}

/** 解析 `control-set` 入参；只接受 `expectedRevision` / `instance` / `sessions`。 */
export function parseControlSetInput(input: PluginConsoleRpcInput): {
  expectedRevision: number;
  instance?: ControlFlagsPatch;
  sessions?: Array<{ platform: string; sceneId: string; flags: ControlFlagsPatch }>;
} {
  for (const key of Object.keys(input)) {
    if (!['expectedRevision', 'instance', 'sessions'].includes(key)) invalid(`不支持的字段：${key}`);
  }
  const expectedRevision = input.expectedRevision;
  if (typeof expectedRevision !== 'number' || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    invalid('需要 expectedRevision（先用 control 读出当前 revision）');
  }
  const instance = input.instance === undefined ? undefined : parseFlags(input.instance, 'instance');
  let sessions: Array<{ platform: string; sceneId: string; flags: ControlFlagsPatch }> | undefined;
  if (input.sessions !== undefined) {
    if (!Array.isArray(input.sessions)) invalid('sessions 必须是数组');
    if (input.sessions.length > MAX_SESSIONS_PER_SET) invalid(`一次最多改 ${MAX_SESSIONS_PER_SET} 个会话`);
    sessions = input.sessions.map((entry, index) => {
      const item = entry as Record<string, unknown> | null;
      if (!item || typeof item !== 'object' || Array.isArray(item)) invalid(`sessions[${index}] 必须是对象`);
      const { platform, sceneId, flags } = item as { platform?: unknown; sceneId?: unknown; flags?: unknown };
      if (typeof platform !== 'string' || !platform.trim() || platform.length > 64) invalid(`sessions[${index}].platform 必填`);
      if (typeof sceneId !== 'string' || !/^(private|group|channel):.+/u.test(sceneId) || sceneId.length > 256) {
        invalid(`sessions[${index}].sceneId 形如 group:123（<scope>:<sceneId>）`);
      }
      return { platform, sceneId, flags: parseFlags(flags, `sessions[${index}].flags`) };
    });
  }
  if (!instance && !sessions?.length) invalid('至少要改 instance 或 sessions 中的一项');
  return { expectedRevision, ...(instance ? { instance } : {}), ...(sessions ? { sessions } : {}) };
}

/** 每个实际变化的范围写一行 `control_change`；审计失败只记日志（审计不是门禁）。 */
export function auditControlChanges(
  log: DecisionEventLog | undefined,
  changes: readonly ControlChange[],
  revision: number,
  actorId: string,
): void {
  if (!log || changes.length === 0) return;
  const turnId = randomUUID();
  for (const change of changes) {
    const session = change.scope.level === 'session' ? change.scope : undefined;
    const turnedOn = SWITCHES.filter((name) => !change.before[name] && change.after[name]);
    void log.record({
      turnId,
      instanceId: '*',
      platform: session?.platform ?? '*',
      sceneId: session?.sceneId ?? '*',
      kind: 'control_change',
      outcome: 'allow',
      reasonCode: 'unknown',
      reasonDetail: `${change.scope.level}${turnedOn.length ? ` on:${turnedOn.join(',')}` : ''}`,
      payload: { level: change.scope.level, revision, before: { ...change.before }, after: { ...change.after } },
      actor: 'operator',
      actorId,
    }).catch(() => undefined);
  }
}

function mapSetError(error: unknown): never {
  if (error instanceof PluginConsoleRpcError) throw error;
  const name = error instanceof Error ? error.name : '';
  if (name === 'ControlRevisionConflictError') {
    throw new PluginConsoleRpcError('conflict', '开关已被修改，请刷新后再试（revision 不一致，未覆盖）');
  }
  if (name === 'ControlValidationError') throw new PluginConsoleRpcError('invalid_input', '开关参数不正确');
  if (name === 'ControlUnavailableError') throw new PluginConsoleRpcError('unavailable', '暂时读不到控制开关状态，未写入，请稍后再试');
  logger.warn(formatCompact({ op: 'control_set_failed', error: error instanceof Error ? error.message : String(error) }));
  throw new PluginConsoleRpcError('unavailable', '保存控制开关失败，未生效，请稍后再试');
}

export async function setControl(
  plane: ControlPlaneSource,
  audit: ControlAuditSource,
  input: PluginConsoleRpcInput,
): Promise<PluginConsoleRpcJson> {
  const parsed = parseControlSetInput(input);
  const target = requirePlane(plane);
  let result: Awaited<ReturnType<AiControlPlane['set']>>;
  try {
    result = await target.set({ ...parsed, actorId: CONTROL_CONSOLE_ACTOR_ID });
  } catch (error) {
    mapSetError(error);
  }
  auditControlChanges(audit(), result.changes, result.snapshot.revision, CONTROL_CONSOLE_ACTOR_ID);
  logger.info(formatCompact({ op: 'control_set', revision: result.snapshot.revision, changes: result.changes.length }));
  return { ...(controlSnapshotJson(result.snapshot) as Record<string, PluginConsoleRpcJson>), changed: result.changes.length } as PluginConsoleRpcJson;
}

/** `control` 查询（只读）。 */
export function controlQueries(plane: ControlPlaneSource): Record<string, PluginConsoleRpcStatus> {
  return {
    control: {
      requiredPermissions: [CONTROL_READ_PERMISSION],
      handler: () => controlSnapshotJson(requirePlane(plane).snapshot()),
    },
  };
}

/** `control-set` 动作（写，需 `control:write`；管理员令牌总可调用）。 */
export function controlActions(plane: ControlPlaneSource, audit: ControlAuditSource): Record<string, PluginConsoleRpcMethod> {
  return {
    'control-set': {
      requiredPermissions: [CONTROL_WRITE_PERMISSION],
      handler: (input) => setControl(plane, audit, input),
    },
  };
}
