/**
 * `rule_draft`（ADR 0039 §3.1，切片 B）：模型只能**起草并送审**群管规则，不能让它生效。
 *
 * - `risk: 'safe'`：写一行 `ai_group_rules`（`created_via=model`），随即以发起人名义提交（`draft` → `pending`）；
 *   宿主监听 `rule_submitted` 把预览卡发回本群，由本群群主 / 管理员（或审批人名单）在群里或 Console 批准。
 * - 只在群里可用，目标固定为当前群；发起人必须是**本群群主 / 管理员**——按本条消息携带的平台实时角色判定，
 *   否则拒绝并写 `rule_draft_forbidden`。
 * - 规则内容的校验（trigger / 阶梯 / 禁言时长 / 冷静期 / 豁免）与 `content_hash` 都由存储做。
 */
import {
  defineAgentTool,
  toolFeatureId,
  type AgentToolDefinition,
  type ToolExecutionContext,
} from '@zhin.js/tool';
import {
  GROUP_RULE_ACTIONS,
  GROUP_RULE_TRIGGERS,
  MAX_GROUP_RULE_CONTENT_CHARS,
  MAX_GROUP_RULE_EXEMPT_USERS,
  MAX_GROUP_RULE_LADDER_STAGES,
  MAX_GROUP_RULE_MUTE_SEC,
  MIN_GROUP_RULE_MUTE_SEC,
  groupRuleHashShort,
  type AiGroupRules,
} from '../group-rules.js';
import { sceneRoleOf } from '../session-profile.js';

export const GROUP_RULE_DRAFT_TOOL_NAME = 'rule_draft';

export interface NativeGroupRuleToolFeature {
  readonly feature: typeof toolFeatureId;
  readonly name: string;
  readonly definition: Readonly<AgentToolDefinition<Record<string, unknown>, string>>;
}

export type GroupRuleStoreSource = () => AiGroupRules | undefined;

export class GroupRuleDraftForbiddenError extends Error {
  constructor() {
    super('only the group owner or an admin can draft group rules');
    this.name = 'GroupRuleDraftForbiddenError';
  }
}

export function createNativeGroupRuleToolFeatures(source: GroupRuleStoreSource): readonly NativeGroupRuleToolFeature[] {
  return Object.freeze([
    Object.freeze({
      feature: toolFeatureId,
      name: GROUP_RULE_DRAFT_TOOL_NAME,
      definition: defineAgentTool<Record<string, unknown>, string>({
        description: 'Draft a moderation rule for the CURRENT group from what the group owner/admin asked for '
          + '(e.g. "remind advertisers first, then mute 10 minutes"). The rule does NOT take effect: a preview card is posted '
          + 'to the group and the owner/an admin must approve it. Only the group owner or an admin may ask for a rule. '
          + 'Never mute or kick members yourself to enforce a rule.',
        inputSchema: Object.freeze({
          type: 'object',
          properties: Object.freeze({
            trigger: Object.freeze({
              type: 'string',
              enum: GROUP_RULE_TRIGGERS,
              description: 'Violation type: advertising (unsolicited promotion / recruiting to other groups), abuse (insults), flood (one member repeating the same message).',
            }),
            ladder: Object.freeze({
              type: 'array',
              minItems: 1,
              maxItems: MAX_GROUP_RULE_LADDER_STAGES,
              description: 'Escalation per repeat offence, first offence first. mute needs duration_sec; suggest_kick only asks admins to approve a kick.',
              items: Object.freeze({
                type: 'object',
                properties: Object.freeze({
                  action: Object.freeze({ type: 'string', enum: GROUP_RULE_ACTIONS }),
                  duration_sec: Object.freeze({ type: 'integer', minimum: MIN_GROUP_RULE_MUTE_SEC, maximum: MAX_GROUP_RULE_MUTE_SEC }),
                }),
                required: Object.freeze(['action']),
              }),
            }),
            window_minutes: Object.freeze({
              type: 'integer',
              minimum: 1,
              description: 'Cool-down: with no repeat offence for this long the ladder resets. Default 30.',
            }),
            exempt_user_ids: Object.freeze({
              type: 'array',
              maxItems: MAX_GROUP_RULE_EXEMPT_USERS,
              items: Object.freeze({ type: 'string' }),
              description: 'Extra members never punished (owner and admins are always exempt).',
            }),
            summary: Object.freeze({
              type: 'string',
              maxLength: MAX_GROUP_RULE_CONTENT_CHARS,
              description: 'One-sentence human-readable summary of the rule, in the group\'s language.',
            }),
          }),
          required: Object.freeze(['trigger', 'ladder', 'summary']),
        }),
        scopes: Object.freeze(['group'] as const),
        requiresApproval: 'never',
        risk: 'safe',
        execute: async (input, context) => draftGroupRule(source, input, context),
      }) as Readonly<AgentToolDefinition<Record<string, unknown>, string>>,
    }),
  ]);
}

async function draftGroupRule(
  source: GroupRuleStoreSource,
  input: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<string> {
  const store = source();
  if (!store) throw new Error('group rules are unavailable');
  const origin = context.origin;
  if (origin.kind !== 'im' || origin.scope !== 'group') throw new TypeError('rule_draft only works inside a group chat');
  const platform = origin.platform;
  const sceneId = `group:${origin.sceneId}`;
  const actorId = context.principal?.subjectId?.trim() || '';
  if (!actorId || !sceneRoleOf(context.principal?.roles)) {
    store.recordDraftForbidden({ platform, sceneId, actorId: actorId || 'unknown', turnId: context.turnId });
    throw new GroupRuleDraftForbiddenError();
  }
  const ladderInput = Array.isArray(input.ladder) ? input.ladder : [];
  const ladder = ladderInput.map((stage) => {
    const raw = (stage && typeof stage === 'object' ? stage : {}) as { action?: unknown; duration_sec?: unknown; durationSec?: unknown };
    const durationSec = raw.duration_sec ?? raw.durationSec;
    return { action: String(raw.action ?? ''), ...(typeof durationSec === 'number' ? { durationSec } : {}) };
  });
  const windowMinutes = input.window_minutes;
  const exemptIds = Array.isArray(input.exempt_user_ids)
    ? input.exempt_user_ids.filter((id): id is string | number => typeof id === 'string' || typeof id === 'number').map(String)
    : [];
  const created = await store.create({
    platform,
    sceneId,
    trigger: String(input.trigger ?? ''),
    ladder,
    ...(typeof windowMinutes === 'number' ? { windowMs: Math.round(windowMinutes * 60_000) } : {}),
    exempt: { ownerAndAdmins: true, userIds: exemptIds },
    content: typeof input.summary === 'string' ? input.summary : '',
    createdBy: actorId,
    createdVia: 'model',
    turnId: context.turnId,
  });
  // 发起人是本群群主 / 管理员：以其名义送审；预览卡由宿主按 `rule_submitted` 发回本群。
  const submitted = await store.submit({
    id: created.record.id,
    expectedRevision: created.record.revision,
    actorId,
    turnId: context.turnId,
    endpoint: origin.endpoint,
  });
  const code = groupRuleHashShort(submitted.record.contentHash);
  return `Rule draft ${code} (${submitted.record.trigger}) is waiting for approval. It is NOT active yet: `
    + `a preview card was posted to this group; the owner or an admin approves it with "rule approve ${code}". `
    + 'Tell the user briefly; do not repeat the card and do not mute/kick anyone yourself.';
}
