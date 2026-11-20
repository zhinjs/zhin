import type { InferenceOperationScope } from '@zhin.js/ai/provider';
import { isOwner } from '@zhin.js/core';
import type { Message, SendContent } from '@zhin.js/core/runtime';
import { formatCompact, getLogger } from '@zhin.js/logger';
import type { SnapshotLease } from '@zhin.js/plugin-runtime';
import {
  handleRuntimeManagementCommand,
  managementCommandText,
} from '../../index.js';
import type { TurnAccessContext } from '../../turn/index.js';
import type { GroupRuleImChannel } from './group-rule-enforcer.js';
import type {
  AgentIngressFoundationPort,
  ImApprovalChannelPort,
} from './ports.js';
import type { RuntimeSenderRoles } from './request.js';
import { respondToUnauthorized } from './unauthorized-reply.js';

const logger = getLogger('agent');

export interface IngressCommandsContext {
  readonly message: Message;
  readonly lease: SnapshotLease;
  readonly operationSignal: AbortSignal | undefined;
  readonly sessionKey: string;
  readonly senderRoles: RuntimeSenderRoles;
  readonly turnAccess: TurnAccessContext;
  readonly ownerId: string | undefined;
  readonly effectiveEndpoint: string;
  readonly agent: AgentIngressFoundationPort;
  readonly groupRules: GroupRuleImChannel;
  readonly toolApprovalIm?: ImApprovalChannelPort;
  readonly withInference: <T>(
    input: Readonly<{ lease: SnapshotLease; sessionKey: string; operationId?: string; signal: AbortSignal }>,
    run: (scope: InferenceOperationScope) => Promise<T>,
  ) => Promise<T>;
  readonly withModelScope?: <T>(
    input: Readonly<{ lease: SnapshotLease; sessionKey: string; signal: AbortSignal }>,
    operation: () => Promise<T>,
  ) => Promise<T>;
  readonly reply: (content: SendContent) => Promise<Awaited<ReturnType<Message['$reply']>>>;
  /**
   * #1250 (ADR 0067 D8): sends a fixed-template reply and records it as this session's own delivery.
   * Used only for `reset`, whose answers are fixed strings; other management replies may carry stored
   * content (memory, session tree) and keep counting as background.
   */
  readonly replyFixed?: (text: string) => Promise<Awaited<ReturnType<Message['$reply']>>>;
}

export async function tryHandleIngressCommands(input: IngressCommandsContext): Promise<boolean> {
  const {
    message,
    lease,
    operationSignal,
    sessionKey,
    senderRoles,
    turnAccess,
    ownerId,
    effectiveEndpoint,
    agent,
    groupRules,
    toolApprovalIm,
    withInference,
    withModelScope,
    reply,
  } = input;
  const service = agent.service;
  const zhinAgent = agent.agent;
  // zhinjs/zhin#1250: a handler reports that its reply refuses a sender without the permission; that
  // refusal is answered in a private chat only and is silent in a group or channel.
  let unauthorized: string | undefined;
  const onUnauthorized = (reason: string) => { unauthorized ??= reason; };
  const answer = async (text: SendContent, op: string, send: (content: SendContent) => Promise<unknown> = reply): Promise<true> => {
    const denied = unauthorized;
    const delivery = denied === undefined
      ? (await send(text), 'replied')
      : await respondToUnauthorized({ message, text, reason: denied, reply: send, command: 'agent' });
    logger.info(formatCompact({ op, handled: true, ...(denied !== undefined ? { denied, delivery } : {}) }));
    return true;
  };

  // Agent 管理命令（/models /tree /reset…）— 在 AI trigger 前拦截
  const managementReply = await handleRuntimeManagementCommand({
    service,
    zhinAgent,
    sessionKey,
    content: message.content,
    commandPrefix: message.commandPrefix,
    locale: message.locale,
    senderRoles,
    inference: {
      list: query => withInference(
        { lease, sessionKey, signal: operationSignal ?? lease.stopSignal },
        scope => scope.client.list(query),
      ),
    },
    withModelScope: operation => {
      if (!withModelScope) throw new Error('The Host model operation is unavailable');
      return withModelScope({ lease, sessionKey, signal: operationSignal ?? lease.stopSignal }, operation);
    },
    semanticMemory: agent.semanticMemory ?? null,
    senderId: turnAccess.principal.subjectId,
    onUnauthorized,
  });
  if (managementReply != null) {
    const fixed = input.replyFixed && /^reset\s*$/iu.test(managementCommandText(message.content, message.commandPrefix) ?? '');
    return answer(managementReply, 'agent_host_management', fixed ? text => input.replyFixed!(text as string) : reply);
  }

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
        },
        message.content,
      )
    : null;
  if (approveReply != null) return answer(approveReply, 'agent_host_approve');

  return false;
}
