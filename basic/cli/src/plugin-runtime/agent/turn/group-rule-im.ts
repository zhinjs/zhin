/**
 * 群管规则的群内预览卡与审批（ADR 0039 §3，切片 B）。
 *
 * - 卡片：存储每次 `rule_submitted`（模型 `rule_draft` 或 Console 起草）都把预览卡发回**该规则所在的群**：
 *   触发 / 每档动作 / 时长 / 冷静期 / 豁免的人读版本与 `content_hash` 短码。Console 批准时另发一条生效通知。
 *   发卡前过控制面（按 addressed 判定：`emergency_stop` / `muted` / `read_only` 拦，`mention_only` 不拦）；
 *   被拦或发送失败只记日志，规则仍在 Console 可见、照常超时。
 * - 命令（只在规则所在的群里生效，Host 命令路径，模型够不着）：
 *   - `rule approve <短码>` / `rule reject <短码>`：结算待审批规则；短码即卡上的摘要前 8 位，
 *     规则被改过摘要就变了，旧短码对不上 → 不会批准没看过的内容。
 *   - `rule disable <短码|trigger>`：停用待审批或生效中的规则（停用不需要审批，ADR 0039 §3.5）。
 *   - `rules`：列出本群生效 / 待审批的规则（任何人可看）。
 * - 审批人（approve / reject / disable）= 本条消息携带的平台实时角色为群主 / 管理员
 *   ∪ `toolHardGate.imApproval.approverIds`（该平台）。不要求是起草人本人。Console 侧由 `ops:approve` 审批。
 */
import {
  GROUP_RULE_TRIGGERS,
  groupRuleHashShort,
  sceneRoleOf,
  type AiControlPlane,
  type AiGroupRules,
  type GroupRuleRecord,
  type GroupRuleStage,
  type GroupRuleTransition,
  type GroupRuleTrigger,
} from '@zhin.js/agent';
import { imApproversFor, type ToolHardGateImApprovalSettings } from '@zhin.js/agent/security';
import { formatCompact, getLogger } from '@zhin.js/logger';
import { checkControlAtIngress } from './control-gate.js';

const logger = getLogger('agent');

export interface GroupRuleCardTarget {
  readonly platform: string;
  /** 发起送审的 Bot 账号；为空时由宿主按平台唯一在线账号解析。 */
  readonly endpoint: string | null;
  /** 平台原生群号（不带 `group:` 前缀）。 */
  readonly groupId: string;
}

export interface GroupRuleImDeps {
  readonly rules: () => AiGroupRules | undefined;
  readonly controlPlane?: () => AiControlPlane | undefined;
  /** 读最新配置：审批人名单与 G6 共用 `toolHardGate.imApproval.approverIds`。 */
  readonly imApproval?: () => ToolHardGateImApprovalSettings | undefined;
  readonly send: (target: GroupRuleCardTarget, text: string) => Promise<void>;
}

export interface GroupRuleCommandInput {
  readonly platform: string;
  readonly scope: 'private' | 'group' | 'channel';
  /** 平台原生会话 id。 */
  readonly sceneId: string;
  readonly senderId: string;
  /** 入站消息上的平台角色（群主 / 管理员实时判定）。 */
  readonly senderRoles: readonly unknown[] | undefined;
  readonly endpoint?: string;
  /** 已去掉命令前缀的文本；不是命令时为 undefined。 */
  readonly commandText: string | undefined;
}

const RULE_COMMAND = /^rules?(?:\s+(approve|reject|disable)\s+(\S+))?\s*$/iu;

export const GROUP_RULE_TRIGGER_LABELS: Readonly<Record<GroupRuleTrigger, string>> = Object.freeze({
  advertising: '发广告',
  abuse: '辱骂 / 人身攻击',
  flood: '刷屏复读',
});

function formatDuration(sec: number): string {
  if (sec % 3600 === 0) return `${sec / 3600} 小时`;
  if (sec % 60 === 0) return `${sec / 60} 分钟`;
  return `${sec} 秒`;
}

export function formatGroupRuleStage(stage: GroupRuleStage): string {
  switch (stage.action) {
    case 'remind':
      return '提醒';
    case 'warn':
      return '警告';
    case 'mute':
      return `禁言 ${formatDuration(stage.durationSec ?? 0)}（自动执行）`;
    case 'suggest_kick':
      return '建议踢出（每次出审批卡，人批才踢）';
    default:
      return String((stage as { action: unknown }).action);
  }
}

/** 预览卡：人读版本 + 摘要短码 + 两条命令。 */
export function formatGroupRuleCard(rule: GroupRuleRecord, approvalTtlMs: number, commandPrefix = '/'): string {
  const code = groupRuleHashShort(rule.contentHash);
  const extraExempt = rule.exempt.userIds.length;
  const exempt = [
    rule.exempt.ownerAndAdmins ? '群主 / 管理员' : undefined,
    extraExempt ? `另加 ${extraExempt} 人` : undefined,
  ].filter(Boolean).join('，') || '无';
  return [
    `【群规草案 · 待审批】摘要 ${code}`,
    `触发：${GROUP_RULE_TRIGGER_LABELS[rule.trigger]}`,
    ...rule.ladder.map((stage, index) => `第 ${index + 1} 次：${formatGroupRuleStage(stage)}`),
    `冷静期：${formatDuration(Math.round(rule.windowMs / 1000))}内无再犯则重新计数`,
    `豁免：${exempt}`,
    rule.content ? `说明：${rule.content}` : undefined,
    `批准：${commandPrefix}rule approve ${code}`,
    `驳回：${commandPrefix}rule reject ${code}`,
    `仅本群群主 / 管理员可审批；${formatDuration(Math.round(approvalTtlMs / 1000))}内未批自动作废。批准后禁言档自动执行，踢人仍每次审批。`,
  ].filter((line): line is string => Boolean(line)).join('\n');
}

function summaryLine(rule: GroupRuleRecord): string {
  const status = rule.status === 'active' ? '生效中' : '待审批';
  return `${groupRuleHashShort(rule.contentHash)} ${status} · ${GROUP_RULE_TRIGGER_LABELS[rule.trigger]}：${rule.ladder.map(formatGroupRuleStage).join(' → ')}`;
}

function parseGroupScene(sceneId: string): string | undefined {
  return sceneId.startsWith('group:') && sceneId.length > 6 ? sceneId.slice(6) : undefined;
}

function isTrigger(value: string): value is GroupRuleTrigger {
  return (GROUP_RULE_TRIGGERS as readonly string[]).includes(value);
}

export class GroupRuleImChannel {
  readonly #deps: GroupRuleImDeps;
  readonly #inFlight = new Set<Promise<void>>();

  constructor(deps: GroupRuleImDeps) {
    this.#deps = deps;
  }

  /** 订阅规则迁移并发卡；返回停止函数。 */
  start(): () => void {
    const store = this.#deps.rules();
    if (!store) return () => undefined;
    return store.onTransition((transition) => {
      const delivery = this.#onTransition(transition, store.approvalTtlMs);
      if (!delivery) return;
      this.#inFlight.add(delivery);
      void delivery.finally(() => this.#inFlight.delete(delivery));
    });
  }

  /** 等所有已开始的发卡结束（测试与有序关停）。 */
  async drain(): Promise<void> {
    await Promise.allSettled([...this.#inFlight]);
  }

  #onTransition(transition: GroupRuleTransition, approvalTtlMs: number): Promise<void> | undefined {
    const rule = transition.record;
    let text: string | undefined;
    if (transition.reasonCode === 'rule_submitted') text = formatGroupRuleCard(rule, approvalTtlMs);
    // 群内命令批准时命令回执已说明；Console 批准另发一条通知，让群里知道规则生效了。
    else if (transition.reasonCode === 'rule_approved' && rule.approvedVia === 'console') {
      text = `【群规已生效】${summaryLine(rule)}（Console 批准）`;
    }
    if (!text) return undefined;
    return this.#sendToGroup(rule, transition.endpoint ?? null, text);
  }

  async #sendToGroup(rule: GroupRuleRecord, endpoint: string | null, text: string): Promise<void> {
    const groupId = parseGroupScene(rule.sceneId);
    if (!groupId) return;
    const verdict = checkControlAtIngress(this.#deps.controlPlane?.(), { platform: rule.platform, scope: 'group', sceneId: groupId }, true);
    if (verdict.blocked) {
      logger.info(formatCompact({ op: 'group_rule_card_skipped', ruleId: rule.id, reason: verdict.reasonCode }));
      return;
    }
    try {
      await this.#deps.send({ platform: rule.platform, endpoint, groupId }, text);
    } catch (error) {
      logger.warn(formatCompact({ op: 'group_rule_card_failed', ruleId: rule.id, error: error instanceof Error ? error.message : String(error) }));
    }
  }

  #isApprover(input: GroupRuleCommandInput): boolean {
    if (sceneRoleOf(input.senderRoles)) return true;
    const settings = this.#deps.imApproval?.();
    return settings ? imApproversFor(settings, input.platform).includes(input.senderId.trim()) : false;
  }

  /** 处理 `rule …` / `rules`；不是这类命令返回 null。 */
  async handleCommand(input: GroupRuleCommandInput): Promise<string | null> {
    const match = input.commandText ? RULE_COMMAND.exec(input.commandText) : null;
    if (!match) return null;
    if (input.scope !== 'group') return '群规命令只能在对应的群里使用。';
    const store = this.#deps.rules();
    if (!store) return '群规功能暂不可用。';
    const scene = { platform: input.platform, sceneId: `group:${input.sceneId}` };
    try {
      const open = (await store.list(scene)).filter((rule) => rule.status === 'active' || rule.status === 'pending');
      const verb = match[1]?.toLowerCase();
      if (!verb) {
        return open.length ? ['本群群规：', ...open.map(summaryLine)].join('\n') : '本群还没有生效或待审批的群规。';
      }
      if (!this.#isApprover(input)) return '只有本群群主或管理员可以审批 / 停用群规。';
      const key = match[2]!.toLowerCase();
      const actorId = input.senderId;
      const common = { actorId, ...(input.endpoint ? { endpoint: input.endpoint } : {}) };
      if (verb === 'disable') {
        const target = isTrigger(key)
          ? open.find((rule) => rule.status === 'active' && rule.trigger === key)
          : open.find((rule) => groupRuleHashShort(rule.contentHash) === key);
        if (!target) return `本群没有匹配 ${key} 的生效或待审批群规。`;
        await store.disable({ id: target.id, expectedRevision: target.revision, ...common, reason: 'disabled in group' });
        return `已停用群规 ${groupRuleHashShort(target.contentHash)}（${GROUP_RULE_TRIGGER_LABELS[target.trigger]}）。`;
      }
      const target = open.find((rule) => rule.status === 'pending' && groupRuleHashShort(rule.contentHash) === key);
      if (!target) return `本群没有摘要为 ${key} 的待审批群规（可能已处理、已过期或内容被改过）。`;
      if (verb === 'reject') {
        await store.reject({ id: target.id, expectedRevision: target.revision, ...common, reason: 'rejected in group' });
        return `已驳回群规 ${key}。`;
      }
      const approved = await store.approve({
        id: target.id,
        expectedRevision: target.revision,
        ...common,
        approvedVia: 'im',
        contentHash: target.contentHash,
      });
      const replaced = approved.superseded?.length ? `，原同类规则已停用` : '';
      return `群规 ${key} 已生效：${GROUP_RULE_TRIGGER_LABELS[target.trigger]}，${target.ladder.map(formatGroupRuleStage).join(' → ')}${replaced}。`;
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      if (name === 'GroupRuleRevisionConflictError' || name === 'GroupRuleStateError' || name === 'GroupRuleHashMismatchError') {
        return '这条群规刚被别人处理过或已过期，请发 /rules 查看最新状态。';
      }
      logger.warn(formatCompact({ op: 'group_rule_command_failed', error: error instanceof Error ? error.message : String(error) }));
      return '群规操作失败，未生效，请稍后再试。';
    }
  }
}
