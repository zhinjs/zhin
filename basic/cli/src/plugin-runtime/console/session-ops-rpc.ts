// `@zhin.js/agent` 是可选 peer：这里只做类型导入，运行时不依赖它（错误按 `name` 识别）。
import { randomUUID } from 'node:crypto';
import type { AiSessionOps, DecisionEventLog, SessionOpsChange, SessionOpsConfig, SessionOpsSnapshot } from '@zhin.js/agent';
import { PluginConsoleRpcError, type PluginConsoleRpcInput, type PluginConsoleRpcJson, type PluginConsoleRpcMethod, type PluginConsoleRpcStatus } from '@zhin.js/plugin-runtime';
import { formatCompact, getLogger } from '@zhin.js/logger';
import type { MemberLifecycle } from '../agent/turn/member-lifecycle.js';

/**
 * 会话运营配置 Console RPC（ADR 0037 切片 A：入群欢迎 / 退群记录）：
 *
 * - `plugin.root.session-ops`（`control:read`）：读实例默认、会话配置与 `revision`。
 * - `plugin.root.session-ops-preview`（`control:read`）：渲染欢迎模板预览——**不发送、不写审计**。
 *   用该会话最近一次真实入群（进程内），没有则用示例成员；未知变量原样保留并在 `unknownVars` 里列出。
 * - `plugin.root.session-ops-set`（`control:write`，动作）：改配置；必须带 `expectedRevision`，不符返回 `conflict`
 *   且不覆盖。每个实际变化的范围写一行 `kind=config_change`、`actor=operator`。
 *
 * 权限暂复用控制面的 `control:read` / `control:write`；ADR 0037 切片 E 引入 `ops:approve` 后再评估是否拆分。
 * 模型没有工具能读写这些配置。
 */

export const SESSION_OPS_READ_PERMISSION = 'control:read';
export const SESSION_OPS_WRITE_PERMISSION = 'control:write';
export const SESSION_OPS_CONSOLE_ACTOR_ID = 'console';
const MAX_SESSIONS_PER_SET = 50;
const SCENE_ID_PATTERN = /^(group|channel):.+/u;

const logger = getLogger('console');

export type SessionOpsSource = () => AiSessionOps | undefined;
export type MemberLifecycleSource = () => MemberLifecycle | undefined;
export type SessionOpsAuditSource = () => DecisionEventLog | undefined;

function invalid(message: string): never {
  throw new PluginConsoleRpcError('invalid_input', message);
}

function requireOps(source: SessionOpsSource): AiSessionOps {
  const ops = source();
  if (!ops) throw new PluginConsoleRpcError('unavailable', '机器人还没启动 AI，暂时无法读写会话运营配置');
  return ops;
}

function configJson(config: SessionOpsConfig): Record<string, PluginConsoleRpcJson> {
  return { welcome: { ...config.welcome }, leave: { ...config.leave } } as unknown as Record<string, PluginConsoleRpcJson>;
}

export function sessionOpsSnapshotJson(snapshot: SessionOpsSnapshot, ops?: AiSessionOps): PluginConsoleRpcJson {
  return {
    revision: snapshot.revision,
    defaults: configJson(snapshot.defaults),
    sessions: snapshot.sessions.map((entry) => ({
      platform: entry.platform,
      sceneId: entry.sceneId,
      overrides: JSON.parse(JSON.stringify(entry.overrides)),
      ...(ops ? { effective: configJson(ops.resolve(entry.platform, entry.sceneId)) } : {}),
    })),
    updatedAt: snapshot.updatedAt,
    updatedBy: snapshot.updatedBy,
    persistent: snapshot.persistent,
    available: snapshot.available,
  } as unknown as PluginConsoleRpcJson;
}

/** 入参只做形状检查；字段级校验由 `AiSessionOps.set` 完成（错误映射为 `invalid_input`）。 */
export function parseSessionOpsSetInput(input: PluginConsoleRpcInput): { expectedRevision: number; defaults?: unknown; sessions?: unknown[] } {
  for (const key of Object.keys(input)) {
    if (!['expectedRevision', 'defaults', 'sessions'].includes(key)) invalid(`不支持的字段：${key}`);
  }
  const expectedRevision = input.expectedRevision;
  if (typeof expectedRevision !== 'number' || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    invalid('需要 expectedRevision（先用 session-ops 读出当前 revision）');
  }
  if (input.sessions !== undefined) {
    if (!Array.isArray(input.sessions)) invalid('sessions 必须是数组');
    if (input.sessions.length > MAX_SESSIONS_PER_SET) invalid(`一次最多改 ${MAX_SESSIONS_PER_SET} 个会话`);
  }
  if (input.defaults === undefined && !(input.sessions as unknown[] | undefined)?.length) invalid('至少要改 defaults 或 sessions 中的一项');
  return {
    expectedRevision,
    ...(input.defaults !== undefined ? { defaults: input.defaults } : {}),
    ...(input.sessions !== undefined ? { sessions: input.sessions as unknown[] } : {}),
  };
}

/** 每个实际变化的范围写一行 `config_change`；审计失败只记日志。 */
export function auditSessionOpsChanges(
  log: DecisionEventLog | undefined,
  changes: readonly SessionOpsChange[],
  revision: number,
  actorId: string,
): void {
  if (!log || changes.length === 0) return;
  const turnId = randomUUID();
  for (const change of changes) {
    const session = change.scope.level === 'session' ? change.scope : undefined;
    void log.record({
      turnId,
      instanceId: '*',
      platform: session?.platform ?? '*',
      sceneId: session?.sceneId ?? '*',
      kind: 'config_change',
      outcome: 'allow',
      reasonCode: 'unknown',
      reasonDetail: `session_ops:${change.scope.level}`,
      payload: { area: 'session_ops', level: change.scope.level, revision, before: configJson(change.before), after: configJson(change.after) },
      actor: 'operator',
      actorId,
    }).catch(() => undefined);
  }
}

function mapSetError(error: unknown): never {
  if (error instanceof PluginConsoleRpcError) throw error;
  const name = error instanceof Error ? error.name : '';
  if (name === 'SessionOpsRevisionConflictError') {
    throw new PluginConsoleRpcError('conflict', '会话运营配置已被修改，请刷新后再试（revision 不一致，未覆盖）');
  }
  if (name === 'SessionOpsValidationError') throw new PluginConsoleRpcError('invalid_input', `会话运营配置不正确：${(error as Error).message}`);
  if (name === 'SessionOpsUnavailableError') throw new PluginConsoleRpcError('unavailable', '暂时读不到会话运营配置，未写入，请稍后再试');
  logger.warn(formatCompact({ op: 'session_ops_set_failed', error: error instanceof Error ? error.message : String(error) }));
  throw new PluginConsoleRpcError('unavailable', '保存会话运营配置失败，未生效，请稍后再试');
}

export async function setSessionOps(
  source: SessionOpsSource,
  audit: SessionOpsAuditSource,
  input: PluginConsoleRpcInput,
): Promise<PluginConsoleRpcJson> {
  const parsed = parseSessionOpsSetInput(input);
  const ops = requireOps(source);
  let result: Awaited<ReturnType<AiSessionOps['set']>>;
  try {
    result = await ops.set({ ...parsed, actorId: SESSION_OPS_CONSOLE_ACTOR_ID });
  } catch (error) {
    mapSetError(error);
  }
  auditSessionOpsChanges(audit(), result.changes, result.snapshot.revision, SESSION_OPS_CONSOLE_ACTOR_ID);
  logger.info(formatCompact({ op: 'session_ops_set', revision: result.snapshot.revision, changes: result.changes.length }));
  return { ...(sessionOpsSnapshotJson(result.snapshot, ops) as Record<string, PluginConsoleRpcJson>), changed: result.changes.length } as PluginConsoleRpcJson;
}

/** 预览：只渲染，不发送，不写审计。 */
export async function previewWelcome(
  source: SessionOpsSource,
  lifecycle: MemberLifecycleSource,
  input: PluginConsoleRpcInput,
): Promise<PluginConsoleRpcJson> {
  for (const key of Object.keys(input)) {
    if (!['platform', 'sceneId', 'template'].includes(key)) invalid(`不支持的字段：${key}`);
  }
  const { platform, sceneId, template } = input as { platform?: unknown; sceneId?: unknown; template?: unknown };
  if (typeof platform !== 'string' || !platform.trim() || platform.length > 64) invalid('platform 必填');
  if (typeof sceneId !== 'string' || !SCENE_ID_PATTERN.test(sceneId) || sceneId.length > 256) invalid('sceneId 形如 group:123（<scope>:<sceneId>）');
  if (template !== undefined && (typeof template !== 'string' || !template.trim() || template.length > 500)) invalid('template 必须是 1–500 字的文本');
  requireOps(source);
  const engine = lifecycle();
  if (!engine) throw new PluginConsoleRpcError('unavailable', '机器人还没启动 AI，暂时无法预览');
  const preview = await engine.preview({ platform, sceneId, ...(typeof template === 'string' ? { template } : {}) });
  return {
    text: preview.text,
    parts: preview.parts.map((part) => ({ ...part })),
    unknownVars: [...preview.unknownVars],
    sample: preview.sample,
    members: preview.members.map((member) => ({ ...member })),
    enabled: preview.enabled,
  } as unknown as PluginConsoleRpcJson;
}

export function sessionOpsQueries(source: SessionOpsSource, lifecycle: MemberLifecycleSource): Record<string, PluginConsoleRpcStatus> {
  return {
    'session-ops': {
      requiredPermissions: [SESSION_OPS_READ_PERMISSION],
      handler: () => {
        const ops = requireOps(source);
        return sessionOpsSnapshotJson(ops.snapshot(), ops);
      },
    },
    'session-ops-preview': {
      requiredPermissions: [SESSION_OPS_READ_PERMISSION],
      handler: (input) => previewWelcome(source, lifecycle, input),
    },
  };
}

export function sessionOpsActions(source: SessionOpsSource, audit: SessionOpsAuditSource): Record<string, PluginConsoleRpcMethod> {
  return {
    'session-ops-set': {
      requiredPermissions: [SESSION_OPS_WRITE_PERMISSION],
      handler: (input) => setSessionOps(source, audit, input),
    },
  };
}
