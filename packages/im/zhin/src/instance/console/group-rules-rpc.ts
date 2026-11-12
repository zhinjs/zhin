// `@zhin.js/agent` 是可选 peer：这里只做类型导入，运行时不依赖它（错误按 `name` 识别）。
import type { AiGroupRules, GroupRuleRecord, GroupRuleStatus, GroupRuleTransition } from '@zhin.js/agent';
import { PluginConsoleRpcError, type PluginConsoleRpcInput, type PluginConsoleRpcJson, type PluginConsoleRpcMethod, type PluginConsoleRpcStatus } from '@zhin.js/plugin-runtime';
import { formatCompact, getLogger } from '@zhin.js/logger';
import { OPS_APPROVE_PERMISSION } from './tool-approvals.js';

/**
 * 群管规则 Console RPC（ADR 0039 §3，切片 B）。本期只做 Host RPC，Console 页面另行实现。
 *
 * 读（`control:read`）：
 * - `plugin.root.group-rules`：`{ platform, sceneId, status? }` → 该群的规则（新的在前）。
 * - `plugin.root.group-rule`：`{ id }` → 单条。
 * 写（全部带 `expectedRevision` 的除 create 外；不符返回 `conflict` 且不覆盖）：
 * - `group-rule-create`（`control:write`）：`{ platform, sceneId, trigger, ladder, windowMs?, exempt?, content }`
 *   → 起草并立即送审（`pending`）；预览卡同样发回该群，群主 / 管理员可在群里批。
 * - `group-rule-disable`（`control:write`）：`{ id, expectedRevision, reason? }`；停用不需要审批（ADR 0039 §3.5）。
 * - `group-rule-approve` / `group-rule-reject`（`ops:approve`）：`{ id, expectedRevision, contentHash?, reason? }`。
 *   `contentHash` 传 Console 上看到的摘要时，规则被改过就拒绝批准（`rule_hash_mismatch`）。
 * Console RPC 目前拿不到调用者身份，操作者记为 `console`（与公告同约定）。每次迁移由存储写 `kind=group_rule` 审计。
 */

export const GROUP_RULES_READ_PERMISSION = 'control:read';
export const GROUP_RULES_WRITE_PERMISSION = 'control:write';
export const GROUP_RULES_APPROVE_PERMISSION = OPS_APPROVE_PERMISSION;
export const GROUP_RULES_CONSOLE_ACTOR_ID = 'console';
const SCENE_ID_PATTERN = /^group:.+/u;
const STATUSES: readonly GroupRuleStatus[] = ['draft', 'pending', 'active', 'rejected', 'expired', 'disabled'];

const logger = getLogger('console');

export type GroupRulesSource = () => AiGroupRules | undefined;

function invalid(message: string): never {
  throw new PluginConsoleRpcError('invalid_input', message);
}

function requireStore(source: GroupRulesSource): AiGroupRules {
  const store = source();
  if (!store) throw new PluginConsoleRpcError('unavailable', '机器人还没启动 AI，暂时无法读写群规');
  return store;
}

function onlyFields(input: PluginConsoleRpcInput, fields: readonly string[]): void {
  for (const key of Object.keys(input)) if (!fields.includes(key)) invalid(`不支持的字段：${key}`);
}

function requireId(input: PluginConsoleRpcInput): string {
  const id = input.id;
  if (typeof id !== 'string' || !id.trim() || id.length > 64) invalid('需要群规 id');
  return id;
}

function requireRevision(input: PluginConsoleRpcInput): number {
  const value = input.expectedRevision;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) invalid('需要 expectedRevision（先读出当前 revision）');
  return value;
}

function optionalText(input: PluginConsoleRpcInput, key: string): string | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') invalid(`${key} 必须是文本`);
  return value;
}

function requireScene(input: PluginConsoleRpcInput): { platform: string; sceneId: string } {
  const { platform, sceneId } = input as { platform?: unknown; sceneId?: unknown };
  if (typeof platform !== 'string' || !platform.trim() || platform.length > 64) invalid('platform 必填');
  if (typeof sceneId !== 'string' || !SCENE_ID_PATTERN.test(sceneId) || sceneId.length > 256) invalid('sceneId 形如 group:123（群规只能作用于群）');
  return { platform, sceneId };
}

export function groupRuleJson(record: GroupRuleRecord): PluginConsoleRpcJson {
  return {
    id: record.id,
    platform: record.platform,
    sceneId: record.sceneId,
    trigger: record.trigger,
    ladder: record.ladder.map((stage) => ({ ...stage })),
    windowMs: record.windowMs,
    exempt: { ownerAndAdmins: record.exempt.ownerAndAdmins, userIds: [...record.exempt.userIds] },
    content: record.content,
    contentHash: record.contentHash,
    status: record.status,
    createdBy: record.createdBy,
    createdVia: record.createdVia,
    approvedBy: record.approvedBy,
    approvedAt: record.approvedAt,
    approvedVia: record.approvedVia,
    submittedAt: record.submittedAt,
    revision: record.revision,
    reason: record.reason,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  } as unknown as PluginConsoleRpcJson;
}

function transitionJson(transition: GroupRuleTransition): PluginConsoleRpcJson {
  return {
    rule: groupRuleJson(transition.record),
    from: transition.from,
    to: transition.to,
    reasonCode: transition.reasonCode,
    ...(transition.superseded?.length ? { superseded: transition.superseded.map((rule) => rule.id) } : {}),
  } as unknown as PluginConsoleRpcJson;
}

function mapError(error: unknown): never {
  if (error instanceof PluginConsoleRpcError) throw error;
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : String(error);
  if (name === 'GroupRuleRevisionConflictError') throw new PluginConsoleRpcError('conflict', '群规已被修改，请刷新后再试（revision 不一致，未覆盖）');
  if (name === 'GroupRuleHashMismatchError') throw new PluginConsoleRpcError('conflict', '群规内容已变（摘要不一致），请刷新后重新审阅');
  if (name === 'GroupRuleNotFoundError') throw new PluginConsoleRpcError('not_found', '找不到这条群规');
  if (name === 'GroupRuleStateError') throw new PluginConsoleRpcError('conflict', `当前状态不能执行这个操作：${message}`);
  if (name === 'GroupRuleValidationError') throw new PluginConsoleRpcError('invalid_input', `群规内容不正确：${message}`);
  if (name === 'GroupRuleUnavailableError') throw new PluginConsoleRpcError('unavailable', '暂时读不到群规存储，未生效，请稍后再试');
  logger.warn(formatCompact({ op: 'group_rule_rpc_failed', error: message }));
  throw new PluginConsoleRpcError('unavailable', '群规操作失败，未生效，请稍后再试');
}

async function guarded<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    mapError(error);
  }
}

export function groupRuleQueries(source: GroupRulesSource): Record<string, PluginConsoleRpcStatus> {
  return {
    'group-rules': {
      requiredPermissions: [GROUP_RULES_READ_PERMISSION],
      handler: async (input) => {
        onlyFields(input, ['platform', 'sceneId', 'status']);
        const scene = requireScene(input);
        const status = input.status;
        if (status !== undefined && (typeof status !== 'string' || !STATUSES.includes(status as GroupRuleStatus))) invalid('status 不正确');
        const store = requireStore(source);
        const rows = await guarded(() => store.list({ ...scene, ...(status ? { status: status as GroupRuleStatus } : {}) }));
        return { rules: rows.map(groupRuleJson), persistent: store.persistent } as unknown as PluginConsoleRpcJson;
      },
    },
    'group-rule': {
      requiredPermissions: [GROUP_RULES_READ_PERMISSION],
      handler: async (input) => {
        onlyFields(input, ['id']);
        const id = requireId(input);
        const record = await guarded(() => requireStore(source).get(id));
        if (!record) throw new PluginConsoleRpcError('not_found', '找不到这条群规');
        return groupRuleJson(record);
      },
    },
  };
}

export function groupRuleActions(source: GroupRulesSource): Record<string, PluginConsoleRpcMethod> {
  const write = (handler: PluginConsoleRpcMethod['handler']): PluginConsoleRpcMethod => ({
    requiredPermissions: [GROUP_RULES_WRITE_PERMISSION],
    handler,
  });
  const approve = (handler: PluginConsoleRpcMethod['handler']): PluginConsoleRpcMethod => ({
    requiredPermissions: [GROUP_RULES_APPROVE_PERMISSION],
    handler,
  });
  const actorId = GROUP_RULES_CONSOLE_ACTOR_ID;
  return {
    'group-rule-create': write(async (input) => {
      onlyFields(input, ['platform', 'sceneId', 'trigger', 'ladder', 'windowMs', 'exempt', 'content']);
      const scene = requireScene(input);
      if (typeof input.trigger !== 'string') invalid('trigger 必填');
      if (!Array.isArray(input.ladder)) invalid('ladder 必须是数组');
      if (typeof input.content !== 'string') invalid('content 必填');
      if (input.windowMs !== undefined && typeof input.windowMs !== 'number') invalid('windowMs 必须是数字');
      if (input.exempt !== undefined && (input.exempt === null || typeof input.exempt !== 'object' || Array.isArray(input.exempt))) invalid('exempt 不正确');
      const store = requireStore(source);
      return transitionJson(await guarded(async () => {
        const created = await store.create({
          ...scene,
          trigger: input.trigger as string,
          ladder: input.ladder as never,
          ...(typeof input.windowMs === 'number' ? { windowMs: input.windowMs } : {}),
          ...(input.exempt ? { exempt: input.exempt as never } : {}),
          content: input.content as string,
          createdBy: actorId,
          createdVia: 'console',
        });
        return store.submit({ id: created.record.id, expectedRevision: created.record.revision, actorId });
      }));
    }),
    'group-rule-disable': write(async (input) => {
      onlyFields(input, ['id', 'expectedRevision', 'reason']);
      const id = requireId(input);
      const expectedRevision = requireRevision(input);
      const reason = optionalText(input, 'reason');
      const store = requireStore(source);
      return transitionJson(await guarded(() => store.disable({ id, expectedRevision, actorId, ...(reason !== undefined ? { reason } : {}) })));
    }),
    'group-rule-approve': approve(async (input) => {
      onlyFields(input, ['id', 'expectedRevision', 'contentHash']);
      const id = requireId(input);
      const expectedRevision = requireRevision(input);
      const contentHash = optionalText(input, 'contentHash');
      const store = requireStore(source);
      return transitionJson(await guarded(() => store.approve({
        id,
        expectedRevision,
        actorId,
        approvedVia: 'console',
        ...(contentHash !== undefined ? { contentHash } : {}),
      })));
    }),
    'group-rule-reject': approve(async (input) => {
      onlyFields(input, ['id', 'expectedRevision', 'reason']);
      const id = requireId(input);
      const expectedRevision = requireRevision(input);
      const reason = optionalText(input, 'reason');
      const store = requireStore(source);
      return transitionJson(await guarded(() => store.reject({ id, expectedRevision, actorId, ...(reason !== undefined ? { reason } : {}) })));
    }),
  };
}
