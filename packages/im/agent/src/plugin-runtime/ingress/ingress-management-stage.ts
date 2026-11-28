import { adapterFeatureId, isAdapterIndex, isSimulationOnlyAdapterIndex } from '@zhin.js/adapter';
import { isOwner } from '@zhin.js/core';
import type { Message, SendContent } from '@zhin.js/core/runtime';
import type { RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import { formatCompact, getLogger } from '@zhin.js/logger';
import { managementCommandText } from '../../index.js';
import type { TurnAccessContext } from '../../turn/index.js';
import type { GroupRuleImChannel } from './group-rule-enforcer.js';
import type {
  AgentIngressFoundationPort,
  ImApprovalChannelPort,
} from './ports.js';
import { respondToUnauthorized } from './unauthorized-reply.js';

const logger = getLogger('agent');

export interface IngressCommandsContext {
  readonly message: Message;
  readonly turnAccess: TurnAccessContext;
  readonly ownerId: string | undefined;
  readonly effectiveEndpoint: string;
  readonly agent: AgentIngressFoundationPort;
  readonly groupRules: GroupRuleImChannel;
  readonly toolApprovalIm?: ImApprovalChannelPort;
  readonly reply: (content: SendContent) => Promise<Awaited<ReturnType<Message['$reply']>>>;
  /** The operation's snapshot: whether only local simulation adapters are loaded (owner refusal hint). */
  readonly snapshot?: RuntimeSnapshot;
}

/** #1250 b116: only local simulation adapters (capability profiles) are loaded; fails closed. */
function simulationOnly(snapshot: RuntimeSnapshot | undefined): boolean {
  try {
    const index = snapshot?.projections.get(adapterFeatureId);
    return isAdapterIndex(index) && isSimulationOnlyAdapterIndex(index);
  } catch { return false; }
}

/**
 * The Agent ingress's own short-code commands, tried before the AI trigger: group rules
 * (`rule approve|reject|disable <code>` / `rules`), hard-gate approval cards (`approve tap_…` /
 * `deny tap_…`) and the owner `/approve` commands. The Agent management commands (`models`,
 * `tree`, `reset` …) are Root commands since #1250 第 83 批 and never reach this stage.
 */
export async function tryHandleIngressCommands(input: IngressCommandsContext): Promise<boolean> {
  const {
    message,
    turnAccess,
    ownerId,
    effectiveEndpoint,
    agent,
    groupRules,
    toolApprovalIm,
    reply,
  } = input;
  const zhinAgent = agent.agent;
  // zhinjs/zhin#1250: a handler reports that its reply refuses a sender without the permission; that
  // refusal is answered in a private chat only and is silent in a group or channel.
  let unauthorized: string | undefined;
  const onUnauthorized = (reason: string) => { unauthorized ??= reason; };
  const answer = async (text: SendContent, op: string): Promise<true> => {
    const denied = unauthorized;
    const delivery = denied === undefined
      ? (await reply(text), 'replied')
      : await respondToUnauthorized({ message, text, reason: denied, reply, command: 'agent' });
    logger.info(formatCompact({ op, handled: true, ...(denied !== undefined ? { denied, delivery } : {}) }));
    return true;
  };

  // ADR 0039 slice B: `rule approve|reject|disable <code>` / `rules` in the rule's own group.
  const groupRuleReply = turnAccess.origin.kind === 'im'
    ? await groupRules.handleCommand({
        platform: turnAccess.origin.platform,
        scope: turnAccess.origin.scope,
        sceneId: turnAccess.origin.sceneId,
        senderId: turnAccess.principal.subjectId,
        senderChatRole: message.sender?.chatRole,
        endpoint: effectiveEndpoint,
        commandText: managementCommandText(message.content, message.commandPrefix),
        ...(message.locale ? { locale: message.locale } : {}),
        ...(message.commandPrefix !== undefined ? { commandPrefix: message.commandPrefix } : {}),
        onUnauthorized,
      })
    : null;
  if (groupRuleReply != null) return answer(groupRuleReply, 'agent_host_group_rule');

  // G6 (#1013): hard-gate cards (`approve tap_…` / `deny tap_…`) before the owner `/approve` commands.
  const toolApprovalReply = turnAccess.origin.kind === 'im'
    ? toolApprovalIm?.handleCommand({
        platform: turnAccess.origin.platform,
        scope: turnAccess.origin.scope,
        sceneId: turnAccess.origin.sceneId,
        senderId: turnAccess.principal.subjectId,
        commandText: managementCommandText(message.content, message.commandPrefix),
        senderIsGlobalOwner: isOwner(message.sender),
        ...(message.locale ? { locale: message.locale } : {}),
        onUnauthorized,
      }) ?? null
    : null;
  if (toolApprovalReply != null) return answer(toolApprovalReply, 'agent_host_tool_approval_im');

  const approveReply = /^approve(?:\s|$)/iu.test(managementCommandText(message.content, message.commandPrefix) ?? '')
    ? zhinAgent.ownerApprovals.handleCommand(
        {
          endpoint: message.conversation.endpoint,
          ownerId,
          subjectId: turnAccess.principal.subjectId,
          // ADR 0056 §2: any global owner, not only the first one the account resolves to.
          senderIsGlobalOwner: isOwner(message.sender),
          scope: turnAccess.origin.kind === 'im' ? turnAccess.origin.scope : 'private',
          locale: message.locale,
          commandPrefix: message.commandPrefix,
          onUnauthorized,
          ...(simulationOnly(input.snapshot) ? { simulationOnly: true } : {}),
        },
        message.content,
      )
    : null;
  if (approveReply != null) return answer(approveReply, 'agent_host_approve');

  return false;
}
