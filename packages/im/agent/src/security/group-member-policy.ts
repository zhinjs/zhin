/**
 * Temporary hardening for group chats (#719), until full trust tiers land
 * (#726): a turn started by an ordinary group member (not master, not on the
 * `trusted` list) gets no shell, no file writes and no outbound messaging to
 * other conversations. Policy is only ever narrowed, so sub-agents inherit it.
 */
import type { TurnPolicyContext } from '../turn/turn-ingress.js';

export const GROUP_MEMBER_RESTRICTION_POLICY = 'group-member-restriction';

export const GROUP_MEMBER_RESTRICTION_REASON =
  '群成员发起的对话暂不支持执行命令、写入文件或向其他会话发消息；如确有需要，请联系主人处理或将你加入信任名单。';

const FILE_WRITE_TOOLS = new Set([
  'write_file',
  'edit_file',
  'multi_edit',
  'apply_patch',
  'delete_file',
  'move_file',
  'rename_file',
]);

const SHELL_TOOLS = new Set(['bash']);

const OUTBOUND_TOOL_NAME = /(?:^|_)(?:send|forward|broadcast|notify|email|mail|dm|post_message|private_message)(?:_|$)/;

interface TurnOriginView {
  readonly kind: string;
  readonly scope?: string;
}

export interface GroupMemberTurnView {
  readonly origin: TurnOriginView;
  readonly principal: Readonly<{ roles: readonly string[] }>;
}

/** An IM group/channel turn whose initiator is neither master nor trusted. */
export function isGroupMemberTurn(turn: GroupMemberTurnView): boolean {
  if (turn.origin.kind !== 'im') return false;
  if (turn.origin.scope !== 'group' && turn.origin.scope !== 'channel') return false;
  const roles = turn.principal.roles;
  return !roles.includes('master') && !roles.includes('trusted');
}

export function isGroupMemberRestrictedTool(tool: Readonly<{ name: string; tags?: readonly string[] }>): boolean {
  return SHELL_TOOLS.has(tool.name)
    || FILE_WRITE_TOOLS.has(tool.name)
    || OUTBOUND_TOOL_NAME.test(tool.name)
    || (tool.tags?.includes('outbound') ?? false);
}

/** Narrows a policy for a group-member turn: no shell, read-only files. Never widens. */
export function tightenGroupMemberPolicy(policy: Readonly<TurnPolicyContext>): Readonly<TurnPolicyContext> {
  const { shell: _shell, ...rest } = policy;
  return Object.freeze({
    ...rest,
    ...(policy.filesystem
      ? { filesystem: Object.freeze({ ...policy.filesystem, access: 'read-only' as const }) }
      : {}),
  });
}

/**
 * The single #719 restriction applied to a Turn before it starts: for an
 * ordinary group member, restricted tools are removed and the policy is
 * tightened; any other Turn is returned unchanged. Used by AgentRuntime and
 * by the agent evals so both exercise the same rule.
 */
export function restrictGroupMemberTurn<TTool extends Readonly<{ name: string; tags?: readonly string[] }>>(
  turn: GroupMemberTurnView & Readonly<{ policy: TurnPolicyContext }>,
  tools: readonly TTool[],
): Readonly<{ restricted: boolean; policy: Readonly<TurnPolicyContext>; tools: readonly TTool[] }> {
  if (!isGroupMemberTurn(turn)) return Object.freeze({ restricted: false, policy: turn.policy, tools });
  return Object.freeze({
    restricted: true,
    policy: tightenGroupMemberPolicy(turn.policy),
    tools: Object.freeze(tools.filter(tool => !isGroupMemberRestrictedTool(tool))),
  });
}
