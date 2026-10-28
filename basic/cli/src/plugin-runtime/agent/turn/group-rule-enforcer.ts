/**
 * 群管规则执行器（ADR 0039 §4，切片 C）：一次违规命中 → 按该群生效规则的当前阶梯档执行。
 *
 * 调用方（切片 D 的 `flood` 检测、切片 E 迁移后的 content-moderation）只负责「判定违规」，
 * 「判定后做什么」统一交给这里：
 *
 * - 找规则：该群该 `trigger` 的 `active` 规则；没有 → 什么都不做（`no_rule`，不写审计）。
 * - 摘要复核：按记录现算 `content_hash`，与规则摘要不符（被直接改库）→ `rule_hash_mismatch`，不执行。
 * - 豁免：被执行人是群主 / 管理员（规则 `exempt.ownerAndAdmins`）或在白名单里 → `rule_hit_exempt`。
 * - 阶梯进度（进程内）：`rule_id + member_id → { count, lastViolationAt, notifiedAt }`。
 *   - 距上次违规超过冷静期（`window_ms`）→ 归零；
 *   - 早于上次提醒送达的消息不推进阶梯（沿用 content-moderation 语义：提醒前已发出的消息不算再犯）；
 *   - 阶梯走完后再犯，重复最后一档；
 *   - 动作没有落地（控制面拦、冷却、Bot 非管理员、平台失败）不推进阶梯。
 * - 执行：
 *   - `remind` / `warn`：模板文案（不调模型）@ 当事人，过控制面（按 addressed：`emergency_stop` / `muted` / `read_only` 拦）
 *     与会话画像；可选撤回原消息（调用方绑定，属于同一规则批准范围）。
 *   - `mute`：**自动执行**。Bot 须是可管理该成员的管理员（实时查询），再以规则的审批记录作硬闸批准
 *     （{@link ToolHardGate.checkPreApproved}，`via: rule`，`approvalId = rule_id`）：过控制面
 *     `emergency_stop` / `read_only`（`muted` 不拦管理动作）与 `ops_cooldown`，不弹卡。成功后发一条禁言说明（过发言闸）。
 *   - `suggest_kick`：**不自动执行**。Bot 须是管理员；随后走普通硬闸（`member` 类）：过控制面与 `ops_cooldown`，
 *     生成一张新鲜的人批审批卡（IM 审批通道 / Console），后台等结算；批准才踢，驳回 / 超时不踢。
 * - Bot 不是管理员：`rule_hit_bot_not_admin`（`skip`），每群每天首次在群里提示一次。
 * - 审计：每次命中一行 `kind=rule_enforcement`（码见 ADR 0039 §6）；实际禁言 / 踢人另有硬闸 `tool_hard_gate`
 *   与 `outbound` 行，共享 `turn_id`，回放能从禁言追到规则、批准人与命中证据。
 * - 磁盘有界：执行器不落盘。阶梯进度只在进程内，条目有上限并按最长冷静期过期清理；重启后阶梯归零（偏宽松，不偏严）。
 */
import { randomUUID } from 'node:crypto';
import {
  groupRuleContentHash,
  groupRuleHashShort,
  normalizeGroupRuleSpec,
  sceneRoleOf,
  speakBlock,
  speakBlockReasonCode,
  type AiControlPlane,
  type AiGroupRules,
  type ApprovalPort,
  type DecisionEventLog,
  type DecisionPayload,
  type DecisionReasonCode,
  type DeliveryOutcome,
  type GroupRuleAction,
  type GroupRuleRecord,
  type GroupRuleTrigger,
  type SessionProfileStore,
  type WelcomePart,
} from '@zhin.js/agent';
import {
  ToolHardGate,
  type OpsCooldownView,
  type ToolApprovalQueue,
  type ToolHardGateConfig,
  type ToolHardGateResult,
} from '@zhin.js/agent/security';
import { formatCompact, getLogger } from '@zhin.js/logger';
import { checkControlAtIngress } from './control-gate.js';
import { auditOutbound, createDecisionAudit, type DecisionAudit } from './decision-audit.js';
import { GROUP_RULE_TRIGGER_LABELS } from './group-rule-im.js';

const logger = getLogger('agent');

/** 自动禁言交给硬闸评估的工具名：核心名单里的 `member` 类（ADR 0036 §3）。 */
export const GROUP_RULE_MUTE_TOOL_NAME = 'mute_member';
/** 建议踢人出卡时的工具名：核心名单里的 `member` 类；冷却键 = 该名字。 */
export const GROUP_RULE_KICK_TOOL_NAME = 'kick_member';
/** 进程内最多记住的阶梯进度条目数。 */
export const MAX_GROUP_RULE_PROGRESS_ENTRIES = 10_000;
/** 「Bot 不是管理员」提示：最多记住的群数（按天去重）。 */
const MAX_BOT_NOT_ADMIN_NOTICES = 2_000;
/** 阶梯进度过期清理的最小间隔（命中时顺手做）。 */
const PROGRESS_PRUNE_INTERVAL_MS = 60_000;
const MAX_EVIDENCE_ITEMS = 3;
const MAX_EVIDENCE_CHARS = 200;

export type GroupRuleNoticePart = WelcomePart;

export interface GroupRuleTarget {
  readonly platform: string;
  /** 收到违规消息的 Bot 账号；为空时由宿主按平台唯一在线账号解析。 */
  readonly endpoint: string | null;
  /** 平台原生群号（不带 `group:` 前缀）。 */
  readonly groupId: string;
}

/** 一次违规命中（调用方已判定）。 */
export interface GroupRuleViolation {
  readonly platform: string;
  readonly endpoint?: string;
  /** 平台原生群号。 */
  readonly groupId: string;
  readonly memberId: string;
  readonly memberName?: string;
  /** 入站消息上的平台角色（群主 / 管理员实时判定）。 */
  readonly memberRoles?: readonly unknown[];
  readonly trigger: GroupRuleTrigger;
  /** 原消息发出时间（毫秒）；早于上次提醒送达的消息不推进阶梯。 */
  readonly sentAt: number;
  readonly messageId?: string;
  /** 命中证据（原文摘录）；写进审计与踢人审批卡，有长度上限。 */
  readonly evidence?: readonly string[];
  /** `remind` / `warn` 档的附加动作：撤回原消息（调用方绑定到这条原消息）。 */
  readonly recall?: () => Promise<void>;
  /**
   * 判定方的命中记录（如 `flood` 的 `rule_hit_flood`）：找到生效规则后先写一行 `rule_enforcement`，
   * 与随后的执行行共享 `turn_id`，回放能看到「为什么判定为违规」。
   */
  readonly detection?: Readonly<{ reasonCode: DecisionReasonCode; payload?: DecisionPayload }>;
}

export type GroupRuleEnforcementResult =
  | Readonly<{ kind: 'no_rule' }>
  | Readonly<{ kind: 'skipped'; reasonCode: DecisionReasonCode | 'before_last_notice'; ruleId: string }>
  | Readonly<{ kind: 'enforced'; action: GroupRuleAction; stage: number; ruleId: string }>
  | Readonly<{ kind: 'failed'; action: GroupRuleAction; stage: number; ruleId: string; reason: string }>;

/** 实时查询：Bot 能否管理该成员；`undefined` = 平台不支持查询。 */
export type GroupRuleInspect = (target: GroupRuleTarget, memberId: string, signal: AbortSignal) => Promise<{ canModerate: boolean } | undefined>;

export interface GroupRuleEnforcerDeps {
  readonly rules: () => AiGroupRules | undefined;
  readonly controlPlane?: () => AiControlPlane | undefined;
  readonly sessions?: () => SessionProfileStore | undefined;
  readonly decisionEvents?: () => DecisionEventLog | undefined;
  readonly hardGate?: () => ToolHardGateConfig | undefined;
  /** 宿主的硬闸审批队列：建议踢人的卡进这里（IM 审批通道 / Console 结算）。 */
  readonly approvals?: () => ToolApprovalQueue | undefined;
  readonly opsCooldown?: () => OpsCooldownView | undefined;
  /** 发群消息（`text` / `mention` 段）；抛错视为失败。 */
  readonly send: (target: GroupRuleTarget, parts: readonly GroupRuleNoticePart[]) => Promise<DeliveryOutcome>;
  readonly inspect?: GroupRuleInspect;
  /** 平台禁言；抛错视为失败。 */
  readonly mute: (target: GroupRuleTarget, memberId: string, durationSec: number, signal: AbortSignal) => Promise<void>;
  /** 平台踢人；只在人批之后调用。抛错视为失败。 */
  readonly kick: (target: GroupRuleTarget, memberId: string, signal: AbortSignal) => Promise<void>;
  /** Bot 在群里说过话：`key` 为 `<platform>:<群号>`。 */
  readonly onSpoke?: (key: string) => void;
  readonly now?: () => number;
}

interface Progress {
  count: number;
  lastViolationAt: number;
  notifiedAt: number;
  /** 写入时规则的冷静期：超过即已归零，可清理。 */
  windowMs: number;
}

/** 建议踢人的审批卡永远等不到「回合内」的答复：结算只来自审批队列（IM 卡 / Console）或硬闸超时。 */
const QUEUE_ONLY_APPROVAL: ApprovalPort = Object.freeze({
  requestApproval: (input: Parameters<ApprovalPort['requestApproval']>[0]) => new Promise<boolean>((resolve) => {
    if (input.signal.aborted) resolve(false);
    else input.signal.addEventListener('abort', () => resolve(false), { once: true });
  }),
});

function formatDuration(sec: number): string {
  if (sec % 3600 === 0) return `${sec / 3600} 小时`;
  if (sec % 60 === 0) return `${sec / 60} 分钟`;
  return `${sec} 秒`;
}

function hitCode(action: GroupRuleAction): DecisionReasonCode {
  switch (action) {
    case 'remind': return 'rule_hit_remind';
    case 'warn': return 'rule_hit_warn';
    case 'mute': return 'rule_hit_mute';
    default: return 'rule_hit_kick_suggested';
  }
}

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 120);
}

function localDay(now: number): string {
  const date = new Date(now);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

/** 规则模板文案（不调模型）。 */
export function formatGroupRuleNotice(
  rule: GroupRuleRecord,
  action: GroupRuleAction,
  memberId: string,
  memberName?: string,
): readonly GroupRuleNoticePart[] {
  const label = GROUP_RULE_TRIGGER_LABELS[rule.trigger];
  const code = groupRuleHashShort(rule.contentHash);
  let text: string;
  switch (action) {
    case 'remind':
      text = ` 提醒：本群不允许${label}，请注意（群规 ${code}）。`;
      break;
    case 'warn':
      text = ` 警告：再次${label}将按群规处理（群规 ${code}）。`;
      break;
    case 'mute': {
      const stage = rule.ladder.find((item) => item.action === 'mute');
      text = ` 因${label}已被禁言 ${formatDuration(stage?.durationSec ?? 0)}（群规 ${code}）。`;
      break;
    }
    default:
      text = ` 多次${label}，已提请群主 / 管理员审批是否移出本群（群规 ${code}）。`;
  }
  return [{ type: 'mention', id: memberId, ...(memberName ? { name: memberName } : {}) }, { type: 'text', text }];
}

export class GroupRuleEnforcer {
  readonly deps: GroupRuleEnforcerDeps;
  readonly #now: () => number;
  readonly #progress = new Map<string, Progress>();
  /** 同一规则同一成员的命中串行处理，避免并发命中把阶梯推两档。 */
  readonly #locks = new Map<string, Promise<unknown>>();
  readonly #botNotAdminNoticed = new Map<string, string>();
  readonly #inFlight = new Set<Promise<void>>();
  readonly #dispose = new AbortController();
  #lastPruneAt = 0;

  constructor(deps: GroupRuleEnforcerDeps) {
    this.deps = deps;
    this.#now = deps.now ?? Date.now;
  }

  /** 处理一次违规命中。永不抛错：存储 / 平台故障记为 `failed` 并写审计。 */
  enforce(violation: GroupRuleViolation): Promise<GroupRuleEnforcementResult> {
    return this.#enforce(violation).catch((error: unknown) => {
      logger.warn(formatCompact({ op: 'group_rule_enforce_failed', error: errorText(error) }));
      return { kind: 'no_rule' } as const;
    });
  }

  /** 进程内阶梯进度条目数（测试与观测）。 */
  get progressSize(): number {
    return this.#progress.size;
  }

  /** 等所有后台踢人审批结束（测试与有序关停）。 */
  async drain(): Promise<void> {
    await Promise.allSettled([...this.#inFlight]);
  }

  /** 关停：中止等待中的踢人审批（卡片按硬闸语义记为取消，不踢）。 */
  dispose(): void {
    this.#dispose.abort();
    this.#progress.clear();
    this.#botNotAdminNoticed.clear();
  }

  async #enforce(violation: GroupRuleViolation): Promise<GroupRuleEnforcementResult> {
    const store = this.deps.rules();
    if (!store || this.#dispose.signal.aborted || !violation.groupId || !violation.memberId) return { kind: 'no_rule' };
    const sceneId = `group:${violation.groupId}`;
    const rule = await store.getActive({ platform: violation.platform, sceneId, trigger: violation.trigger });
    if (!rule) return { kind: 'no_rule' };

    const turnId = randomUUID();
    const audit = createDecisionAudit(this.deps.decisionEvents?.(), {
      turnId,
      instanceId: violation.endpoint || violation.platform,
      platform: violation.platform,
      sceneId,
      userId: violation.memberId,
    });
    const payload: DecisionPayload = {
      ruleId: rule.id,
      ruleCode: groupRuleHashShort(rule.contentHash),
      trigger: rule.trigger,
      memberId: violation.memberId,
      ...(violation.messageId ? { messageId: violation.messageId } : {}),
      ...(violation.evidence?.length ? { evidence: evidence(violation.evidence) } : {}),
    };
    if (violation.detection) {
      audit({
        kind: 'rule_enforcement',
        outcome: 'allow',
        reasonCode: violation.detection.reasonCode,
        payload: { ...payload, ...violation.detection.payload },
        actor: 'policy',
      });
    }
    const skip = (reasonCode: DecisionReasonCode, extra: DecisionPayload = {}, outcome: 'skip' | 'deny' = 'skip'): GroupRuleEnforcementResult => {
      audit({ kind: 'rule_enforcement', outcome, reasonCode, payload: { ...payload, ...extra }, actor: 'policy' });
      return { kind: 'skipped', reasonCode, ruleId: rule.id };
    };

    // 1. 摘要复核：生效规则不可改；对不上说明被绕过状态机改过，不执行。
    const currentHash = recomputeHash(rule);
    if (currentHash !== rule.contentHash) {
      return skip('rule_hash_mismatch', { contentHash: currentHash ?? null, approvedHash: rule.contentHash }, 'deny');
    }

    // 2. 豁免。
    if ((rule.exempt.ownerAndAdmins && sceneRoleOf(violation.memberRoles)) || rule.exempt.userIds.includes(violation.memberId)) {
      return skip('rule_hit_exempt');
    }

    // 3. 阶梯（同一规则同一成员串行）。
    const key = `${rule.id}\u0000${violation.memberId}`;
    return this.#serialize(key, async () => {
      const now = this.#now();
      this.#prune(now);
      const previous = this.#progress.get(key);
      const progress: Progress = previous && violation.sentAt - previous.lastViolationAt < rule.windowMs
        ? { ...previous }
        : { count: 0, lastViolationAt: 0, notifiedAt: 0, windowMs: rule.windowMs };
      if (previous && violation.sentAt <= progress.notifiedAt) {
        logger.debug(formatCompact({ op: 'group_rule_before_notice', ruleId: rule.id }));
        return { kind: 'skipped', reasonCode: 'before_last_notice', ruleId: rule.id } as const;
      }
      const stageIndex = Math.min(progress.count, rule.ladder.length - 1);
      const stage = rule.ladder[stageIndex]!;
      const stagePayload = { ...payload, stage: stageIndex + 1, action: stage.action, ...(stage.durationSec ? { durationSec: stage.durationSec } : {}) };
      const target: GroupRuleTarget = { platform: violation.platform, endpoint: violation.endpoint ?? null, groupId: violation.groupId };
      const advance = (notified: boolean) => {
        this.#progress.set(key, {
          count: progress.count + 1,
          lastViolationAt: Math.max(progress.lastViolationAt, violation.sentAt),
          notifiedAt: notified ? this.#now() : progress.notifiedAt,
          windowMs: rule.windowMs,
        });
        this.#bound();
      };
      const context = { rule, violation, target, audit, turnId, payload: stagePayload, stage: stageIndex + 1 };
      switch (stage.action) {
        case 'remind':
        case 'warn':
          return this.#notify(context, stage.action, advance);
        case 'mute':
          return this.#mute(context, stage.durationSec ?? 0, advance);
        default:
          return this.#suggestKick(context, advance);
      }
    });
  }

  async #notify(ctx: StageContext, action: 'remind' | 'warn', advance: (notified: boolean) => void): Promise<GroupRuleEnforcementResult> {
    const blocked = await this.#speakBlocked(ctx);
    if (blocked) return { kind: 'skipped', reasonCode: blocked, ruleId: ctx.rule.id };
    const delivered = await this.#send(ctx.target, formatGroupRuleNotice(ctx.rule, action, ctx.violation.memberId, ctx.violation.memberName));
    auditOutbound(ctx.audit, delivered, ctx.payload);
    if (delivered.status !== 'sent') {
      const reason = delivered.status === 'suppressed' ? 'suppressed' : `${delivered.status}:${delivered.code}`;
      ctx.audit({ kind: 'rule_enforcement', outcome: 'error', reasonCode: hitCode(action), reasonDetail: reason, payload: ctx.payload, actor: 'policy' });
      return { kind: 'failed', action, stage: ctx.stage, ruleId: ctx.rule.id, reason };
    }
    this.#spoke(ctx.target);
    advance(true);
    let recalled: boolean | undefined;
    if (ctx.violation.recall) {
      try {
        await ctx.violation.recall();
        recalled = true;
      } catch (error) {
        recalled = false;
        logger.warn(formatCompact({ op: 'group_rule_recall_failed', ruleId: ctx.rule.id, error: errorText(error) }));
      }
    }
    ctx.audit({
      kind: 'rule_enforcement',
      outcome: 'allow',
      reasonCode: hitCode(action),
      payload: { ...ctx.payload, ...(recalled === undefined ? {} : { recalled }) },
      actor: 'policy',
    });
    return { kind: 'enforced', action, stage: ctx.stage, ruleId: ctx.rule.id };
  }

  async #mute(ctx: StageContext, durationSec: number, advance: (notified: boolean) => void): Promise<GroupRuleEnforcementResult> {
    const notAdmin = await this.#botNotAdmin(ctx);
    if (notAdmin) return notAdmin;
    const verdict = this.#gate(ctx).checkPreApproved(
      { name: GROUP_RULE_MUTE_TOOL_NAME },
      { groupId: ctx.target.groupId, target: ctx.violation.memberId, durationSec },
      `group-rule:${ctx.rule.id}:${ctx.turnId}`,
      {
        source: 'rule',
        id: ctx.rule.id,
        approvedBy: ctx.rule.approvedBy,
        channel: ctx.rule.approvedVia === 'im' ? 'im_group' : 'console',
        approvedHash: ctx.rule.contentHash,
        contentHash: recomputeHash(ctx.rule) ?? '',
      },
    );
    if (verdict.status === 'denied') {
      ctx.audit({ kind: 'rule_enforcement', outcome: 'deny', reasonCode: verdict.reasonCode, payload: { ...ctx.payload, stageGate: 'tool_hard_gate' }, actor: 'policy' });
      return { kind: 'skipped', reasonCode: verdict.reasonCode, ruleId: ctx.rule.id };
    }
    try {
      await this.deps.mute(ctx.target, ctx.violation.memberId, durationSec, this.#dispose.signal);
    } catch (error) {
      const reason = errorText(error);
      auditOutbound(ctx.audit, { status: 'failed', code: reason, retryable: false }, ctx.payload);
      ctx.audit({ kind: 'rule_enforcement', outcome: 'error', reasonCode: 'rule_hit_mute', reasonDetail: reason, payload: ctx.payload, actor: 'policy' });
      return { kind: 'failed', action: 'mute', stage: ctx.stage, ruleId: ctx.rule.id, reason };
    }
    auditOutbound(ctx.audit, { status: 'sent' }, { ...ctx.payload, op: 'mute' });
    ctx.audit({
      kind: 'rule_enforcement',
      outcome: 'allow',
      reasonCode: 'rule_hit_mute',
      payload: { ...ctx.payload, approvedBy: ctx.rule.approvedBy, approvedVia: ctx.rule.approvedVia },
      actor: 'policy',
    });
    // 禁言说明是附带的：过发言闸，被拦或失败不影响禁言已执行。
    let notified = false;
    if (!(await this.#speakBlocked(ctx, false))) {
      const delivered = await this.#send(ctx.target, formatGroupRuleNotice(ctx.rule, 'mute', ctx.violation.memberId, ctx.violation.memberName));
      auditOutbound(ctx.audit, delivered, ctx.payload);
      notified = delivered.status === 'sent';
      if (notified) this.#spoke(ctx.target);
    }
    advance(notified);
    return { kind: 'enforced', action: 'mute', stage: ctx.stage, ruleId: ctx.rule.id };
  }

  async #suggestKick(ctx: StageContext, advance: (notified: boolean) => void): Promise<GroupRuleEnforcementResult> {
    const notAdmin = await this.#botNotAdmin(ctx);
    if (notAdmin) return notAdmin;
    const endpointKey = ctx.target.endpoint ?? '';
    const gate = this.#gate(ctx, {
      unattended: false,
      approval: QUEUE_ONLY_APPROVAL,
      conversationScope: 'group',
      ...(endpointKey
        ? { origin: { platform: ctx.target.platform, endpointKey, scope: 'group' as const, sceneId: ctx.target.groupId } }
        : {}),
    });
    const args = {
      groupId: ctx.target.groupId,
      target: ctx.violation.memberId,
      ruleId: ctx.rule.id,
      ruleCode: groupRuleHashShort(ctx.rule.contentHash),
      reason: GROUP_RULE_TRIGGER_LABELS[ctx.rule.trigger],
      ...(ctx.violation.evidence?.length ? { evidence: evidence(ctx.violation.evidence) } : {}),
    };
    // 卡片入队是同步的；等结算在后台进行，不阻塞入站。
    const settled = gate.check({ name: GROUP_RULE_KICK_TOOL_NAME }, args, `group-rule:${ctx.rule.id}:${ctx.turnId}`);
    // 控制面 / 冷却 / latch 的拒绝在入队前同步得出；等一个宏任务即可区分「已拒绝」与「卡片已出、等人批」。
    const queued = await Promise.race([settled, new Promise<undefined>((resolve) => setImmediate(() => resolve(undefined)))]);
    if (queued && queued.status === 'denied') {
      ctx.audit({ kind: 'rule_enforcement', outcome: 'deny', reasonCode: queued.reasonCode, payload: { ...ctx.payload, stageGate: 'tool_hard_gate' }, actor: 'policy' });
      return { kind: 'skipped', reasonCode: queued.reasonCode, ruleId: ctx.rule.id };
    }
    ctx.audit({ kind: 'rule_enforcement', outcome: 'defer', reasonCode: 'rule_hit_kick_suggested', payload: ctx.payload, actor: 'policy' });
    advance(false);
    const run = this.#settleKick(ctx, settled);
    this.#inFlight.add(run);
    void run.finally(() => this.#inFlight.delete(run));
    return { kind: 'enforced', action: 'suggest_kick', stage: ctx.stage, ruleId: ctx.rule.id };
  }

  async #settleKick(ctx: StageContext, settled: Promise<ToolHardGateResult>): Promise<void> {
    let verdict: ToolHardGateResult;
    try {
      verdict = await settled;
    } catch (error) {
      logger.warn(formatCompact({ op: 'group_rule_kick_gate_failed', ruleId: ctx.rule.id, error: errorText(error) }));
      return;
    }
    // 驳回 / 超时 / 取消：硬闸已写审计；这里只在批准时执行。
    if (verdict.status !== 'approved' || this.#dispose.signal.aborted) return;
    try {
      await this.deps.kick(ctx.target, ctx.violation.memberId, this.#dispose.signal);
      auditOutbound(ctx.audit, { status: 'sent' }, { ...ctx.payload, op: 'kick', ...(verdict.approvalId ? { approvalId: verdict.approvalId } : {}) });
    } catch (error) {
      const reason = errorText(error);
      auditOutbound(ctx.audit, { status: 'failed', code: reason, retryable: false }, { ...ctx.payload, op: 'kick' });
      logger.warn(formatCompact({ op: 'group_rule_kick_failed', ruleId: ctx.rule.id, error: reason }));
    }
  }

  #gate(ctx: StageContext, extra: Partial<ConstructorParameters<typeof ToolHardGate>[1]> = {}): ToolHardGate {
    const events = this.deps.decisionEvents?.();
    const queue = this.deps.approvals?.();
    const cooldown = this.deps.opsCooldown?.();
    return new ToolHardGate(this.deps.hardGate?.(), {
      turnId: ctx.turnId,
      sessionKey: `group-rule:${ctx.rule.id}`,
      unattended: true,
      signal: this.#dispose.signal,
      location: { instanceId: ctx.target.endpoint || ctx.target.platform, platform: ctx.target.platform, sceneId: ctx.rule.sceneId, userId: ctx.violation.memberId },
      ...(events ? { audit: events } : {}),
      ...(queue ? { queue } : {}),
      ...(cooldown ? { opsCooldown: cooldown } : {}),
      ...(this.deps.controlPlane ? { controlPlane: () => this.deps.controlPlane!() } : {}),
      ...extra,
    });
  }

  /**
   * 发言闸：控制面按 addressed（`emergency_stop` / `muted` / `read_only` 拦）+ 会话画像（Bot 被禁言等）。
   * `audited=false` 时只判定不写审计（禁言后的附带说明）。
   */
  async #speakBlocked(ctx: StageContext, audited = true): Promise<DecisionReasonCode | undefined> {
    const verdict = checkControlAtIngress(this.deps.controlPlane?.(), { platform: ctx.target.platform, scope: 'group', sceneId: ctx.target.groupId }, true);
    if (verdict.blocked) {
      if (audited) {
        const detail = verdict.level === 'unavailable' ? 'control_state_unavailable' : `${verdict.level}:${verdict.switch}`;
        ctx.audit({ kind: 'rule_enforcement', outcome: 'skip', reasonCode: verdict.reasonCode, reasonDetail: detail, payload: { ...ctx.payload, stageGate: 'control_gate' }, actor: 'policy' });
      }
      return verdict.reasonCode;
    }
    const sessions = this.deps.sessions?.();
    if (!sessions) return undefined;
    let blocked: ReturnType<typeof speakBlock> = null;
    try {
      blocked = speakBlock(await sessions.get(ctx.target.platform, 'group', ctx.target.groupId), this.#now());
    } catch (error) {
      logger.warn(formatCompact({ op: 'session_profile_read_failed', source: 'group_rule', error: errorText(error) }));
    }
    if (!blocked) return undefined;
    const { code, detail } = speakBlockReasonCode(blocked);
    if (audited) {
      ctx.audit({ kind: 'rule_enforcement', outcome: 'skip', reasonCode: code, reasonDetail: detail, payload: { ...ctx.payload, stageGate: 'speak_gate' }, actor: 'policy' });
    }
    return code;
  }

  /** 实时确认 Bot 能管理该成员；不能 → `rule_hit_bot_not_admin`，每群每天首次提示一次。平台不支持查询时交给平台调用本身判定。 */
  async #botNotAdmin(ctx: StageContext): Promise<GroupRuleEnforcementResult | undefined> {
    if (!this.deps.inspect) return undefined;
    let member: { canModerate: boolean } | undefined;
    try {
      member = await this.deps.inspect(ctx.target, ctx.violation.memberId, this.#dispose.signal);
    } catch (error) {
      ctx.audit({ kind: 'rule_enforcement', outcome: 'error', reasonCode: 'rule_hit_bot_not_admin', reasonDetail: errorText(error), payload: ctx.payload, actor: 'policy' });
      return { kind: 'failed', action: ctx.payload.action as GroupRuleAction, stage: ctx.stage, ruleId: ctx.rule.id, reason: 'inspect_failed' };
    }
    if (!member || member.canModerate) return undefined;
    ctx.audit({ kind: 'rule_enforcement', outcome: 'skip', reasonCode: 'rule_hit_bot_not_admin', payload: ctx.payload, actor: 'policy' });
    await this.#noticeBotNotAdmin(ctx);
    return { kind: 'skipped', reasonCode: 'rule_hit_bot_not_admin', ruleId: ctx.rule.id };
  }

  async #noticeBotNotAdmin(ctx: StageContext): Promise<void> {
    const sceneKey = `${ctx.target.platform}:${ctx.target.groupId}`;
    const today = localDay(this.#now());
    if (this.#botNotAdminNoticed.get(sceneKey) === today) return;
    this.#botNotAdminNoticed.delete(sceneKey);
    this.#botNotAdminNoticed.set(sceneKey, today);
    while (this.#botNotAdminNoticed.size > MAX_BOT_NOT_ADMIN_NOTICES) {
      const oldest = this.#botNotAdminNoticed.keys().next();
      if (oldest.done) break;
      this.#botNotAdminNoticed.delete(oldest.value);
    }
    if (await this.#speakBlocked(ctx, false)) return;
    const code = groupRuleHashShort(ctx.rule.contentHash);
    const delivered = await this.#send(ctx.target, [{
      type: 'text',
      text: `我在本群不是管理员（或无权管理该成员），群规 ${code} 的禁言 / 踢人档暂时无法执行。请群主把我设为管理员，或发 /rule disable ${code} 停用该规则。`,
    }]);
    auditOutbound(ctx.audit, delivered, { ...ctx.payload, notice: 'bot_not_admin' });
    if (delivered.status === 'sent') this.#spoke(ctx.target);
  }

  async #send(target: GroupRuleTarget, parts: readonly GroupRuleNoticePart[]): Promise<DeliveryOutcome> {
    try {
      return await this.deps.send(target, parts);
    } catch (error) {
      return { status: 'failed', code: errorText(error), retryable: false };
    }
  }

  #spoke(target: GroupRuleTarget): void {
    try {
      this.deps.onSpoke?.(`${target.platform}:${target.groupId}`);
    } catch { /* 观测回调不影响执行结果 */ }
  }

  async #serialize<T>(key: string, run: () => Promise<T>): Promise<T> {
    const previous = this.#locks.get(key) ?? Promise.resolve();
    const next = previous.then(run, run);
    const tail = next.catch(() => undefined);
    this.#locks.set(key, tail);
    void tail.finally(() => {
      if (this.#locks.get(key) === tail) this.#locks.delete(key);
    });
    return next;
  }

  /** 过期清理：超过冷静期没再犯的条目已归零，不必再记。 */
  #prune(now: number): void {
    if (now - this.#lastPruneAt < PROGRESS_PRUNE_INTERVAL_MS && this.#progress.size < MAX_GROUP_RULE_PROGRESS_ENTRIES) return;
    this.#lastPruneAt = now;
    for (const [key, entry] of this.#progress) {
      if (now - entry.lastViolationAt >= entry.windowMs) this.#progress.delete(key);
    }
  }

  /** 总量上限：仍超出时丢最早写入的条目（归零 = 偏宽松）。 */
  #bound(): void {
    while (this.#progress.size > MAX_GROUP_RULE_PROGRESS_ENTRIES) {
      const oldest = this.#progress.keys().next();
      if (oldest.done) break;
      this.#progress.delete(oldest.value);
    }
  }
}

interface StageContext {
  readonly rule: GroupRuleRecord;
  readonly violation: GroupRuleViolation;
  readonly target: GroupRuleTarget;
  readonly audit: DecisionAudit;
  readonly turnId: string;
  readonly payload: DecisionPayload;
  readonly stage: number;
}

function evidence(items: readonly string[]): string[] {
  return items.slice(0, MAX_EVIDENCE_ITEMS).map((item) => item.slice(0, MAX_EVIDENCE_CHARS));
}

/** 按记录现算摘要；字段已不合法（被改坏）时返回 undefined。 */
function recomputeHash(rule: GroupRuleRecord): string | undefined {
  try {
    const spec = normalizeGroupRuleSpec({
      trigger: rule.trigger,
      ladder: rule.ladder,
      windowMs: rule.windowMs,
      exempt: rule.exempt,
      content: rule.content,
    } as Parameters<typeof normalizeGroupRuleSpec>[0]);
    return groupRuleContentHash({ platform: rule.platform, sceneId: rule.sceneId }, spec);
  } catch {
    return undefined;
  }
}
