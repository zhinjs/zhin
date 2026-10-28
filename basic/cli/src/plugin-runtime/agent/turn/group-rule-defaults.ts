/**
 * content-moderation 迁移（ADR 0039 §5，切片 E）：原写死阶梯 → 默认规则模板。
 *
 * - 模板：广告 / 辱骂各一条，「提醒 → 警告 → 禁言 600 秒，冷静期 30 分钟」，群主 / 管理员豁免。
 * - 原 `groupModeration` 名单里的群**不自动生效**：该群该类型还没有任何规则（任意状态）时，生成一条规则并直接送审
 *   （`pending`），送审即在群里出预览卡，等群主 / 管理员 `/rule approve <短码>` 或 Console 确认一次。
 *   确认前执行器找不到生效规则，插件只提醒 / 警告，不禁言。
 * - 已有任意状态的规则（含被驳回 / 过期 / 停用）就不再生成：群主拒绝过的不反复打扰。终态规则按存储保留期清理后，
 *   下次才会再生成一张卡。
 * - 同群同类型并发调用串行化，进程内只记进行中的调用，不落额外状态（规则本身由 `ai_group_rules` 的保留期 / 配额约束）。
 */
import {
  DEFAULT_GROUP_RULE_WINDOW_MS,
  type AiGroupRules,
  type GroupRuleSpecInput,
} from '@zhin.js/agent';
import type { GroupRuleDefaultOutcome, GroupRuleViolationTrigger } from '@zhin.js/core/runtime';

/** 迁移生成的规则的起草人（不是任何真人；审批照旧要群主 / 管理员）。 */
export const GROUP_RULE_MIGRATION_ACTOR = 'content-moderation';
/** 原 content-moderation 写死的禁言时长。 */
export const DEFAULT_GROUP_RULE_MUTE_SEC = 600;

const TEMPLATE_CONTENT: Readonly<Record<GroupRuleViolationTrigger, string>> = Object.freeze({
  advertising: '发广告：第一次提醒，第二次警告，第三次禁言 10 分钟；30 分钟内不再犯则重新计数（由内容审核插件的原有群管迁移而来）',
  abuse: '辱骂他人：第一次提醒，第二次警告，第三次禁言 10 分钟；30 分钟内不再犯则重新计数（由内容审核插件的原有群管迁移而来）',
});

/** 默认模板：与原 content-moderation 写死阶梯一致。 */
export function defaultGroupRuleTemplate(trigger: GroupRuleViolationTrigger): GroupRuleSpecInput {
  return {
    trigger,
    ladder: [{ action: 'remind' }, { action: 'warn' }, { action: 'mute', durationSec: DEFAULT_GROUP_RULE_MUTE_SEC }],
    windowMs: DEFAULT_GROUP_RULE_WINDOW_MS,
    exempt: { ownerAndAdmins: true, userIds: [] },
    content: TEMPLATE_CONTENT[trigger],
  };
}

export interface EnsureDefaultGroupRuleInput {
  readonly platform: string;
  readonly endpoint?: string;
  /** 平台原生群号（不带 `group:` 前缀）。 */
  readonly groupId: string;
  readonly trigger: GroupRuleViolationTrigger;
}

/** 生成默认规则并送审；同群同类型并发调用串行。 */
export class GroupRuleDefaults {
  readonly #rules: () => AiGroupRules | undefined;
  readonly #inFlight = new Map<string, Promise<GroupRuleDefaultOutcome>>();

  constructor(rules: () => AiGroupRules | undefined) {
    this.#rules = rules;
  }

  ensure(input: EnsureDefaultGroupRuleInput): Promise<GroupRuleDefaultOutcome> {
    const key = `${input.platform}\u0000${input.groupId}\u0000${input.trigger}`;
    const running = this.#inFlight.get(key);
    if (running) return running;
    const next = this.#ensure(input).finally(() => this.#inFlight.delete(key));
    this.#inFlight.set(key, next);
    return next;
  }

  async #ensure(input: EnsureDefaultGroupRuleInput): Promise<GroupRuleDefaultOutcome> {
    const store = this.#rules();
    if (!store || !input.platform || !input.groupId) return 'unavailable';
    const sceneId = `group:${input.groupId}`;
    const existing = await store.list({ platform: input.platform, sceneId, trigger: input.trigger });
    if (existing.length > 0) return 'exists';
    const drafted = await store.create({
      ...defaultGroupRuleTemplate(input.trigger),
      platform: input.platform,
      sceneId,
      createdBy: GROUP_RULE_MIGRATION_ACTOR,
      // 名单来自运营者配置，按 Console 侧起草记；批准仍只认群主 / 管理员 / ops:approve。
      createdVia: 'console',
    });
    await store.submit({
      id: drafted.record.id,
      expectedRevision: drafted.record.revision,
      actorId: GROUP_RULE_MIGRATION_ACTOR,
      ...(input.endpoint ? { endpoint: input.endpoint } : {}),
    });
    return 'created';
  }
}
