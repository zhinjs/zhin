/**
 * 群管违规上报（ADR 0039 §5，切片 E）。
 *
 * content-moderation 等插件只负责「判定违规」，「判定后做什么」交给 Agent host 的群规执行器：
 * 按该群生效规则的阶梯执行提醒 / 警告 / 禁言（以规则批准作硬闸批准）/ 建议踢人（每次人批出卡）。
 * Agent host 在根作用域提供本 token；未装 Agent（没有本资源）时插件只能提醒 / 警告，不能禁言或踢人。
 */
import { createToken } from '@zhin.js/plugin-runtime';
import type { ConversationRef } from '@zhin.js/im-contract';

/** 插件可上报的违规类型（`flood` 由宿主本地检测，不经插件）。 @public */
export type GroupRuleViolationTrigger = 'advertising' | 'abuse';

/** @public */
export interface GroupRuleViolationReport {
  /** Runtime-only authority captured from the actual incoming Client; never persist this object. */
  readonly source: Readonly<{ client: unknown; signal: AbortSignal }>;
  /** 违规消息所在的群会话（`kind` 必须是 `group`）。 */
  readonly conversation: ConversationRef;
  readonly memberId: string;
  readonly memberName?: string;
  /** 入站消息上的平台角色（群主 / 管理员豁免）。 */
  readonly memberRoles?: readonly unknown[];
  readonly trigger: GroupRuleViolationTrigger;
  /** 原消息发出时间（毫秒）。 */
  readonly sentAt: number;
  readonly messageId?: string;
  /** 命中证据（原文摘录）。 */
  readonly evidence?: readonly string[];
  /**
   * 入群不久即发广告：不按阶梯，直接出一张踢人审批卡（每次人批，绝不自动踢）。
   * 只对 `advertising` 生效。
   */
  readonly newcomer?: boolean;
  /** `remind` / `warn` 档的附加动作：撤回原消息（调用方绑定到这条原消息）。 */
  readonly recall?: () => Promise<void>;
}

/**
 * `handled`：执行器已按规则处理（含被控制面 / 豁免 / 冷却跳过），调用方不得再自行提醒或处罚。
 * `no_rule`：该群该类型没有可用规则，调用方可退回只提醒 / 警告。
 * @public
 */
export type GroupRuleViolationOutcome = 'handled' | 'no_rule';

/** 迁移结果：`created` 新建了待确认规则；`exists` 该群该类型已有规则（任意状态）；`unavailable` 规则存储不可用。 @public */
export type GroupRuleDefaultOutcome = 'created' | 'exists' | 'unavailable';

/** @public */
export interface GroupRuleViolationSink {
  report(violation: GroupRuleViolationReport): Promise<GroupRuleViolationOutcome>;
  /**
   * 迁移：该群该类型还没有任何规则时，按默认模板（提醒 → 警告 → 禁言 600 秒，冷静期 30 分钟）
   * 生成一条 `pending` 规则并在群里出预览卡，等群主 / 管理员确认一次。已有任意状态的规则则不动。
   */
  ensureDefaultRule(input: Readonly<{ conversation: ConversationRef; trigger: GroupRuleViolationTrigger }>): Promise<GroupRuleDefaultOutcome>;
}

/** @public */
export const groupRuleViolationToken = createToken<GroupRuleViolationSink>('zhin.im.group-rule-violations');
