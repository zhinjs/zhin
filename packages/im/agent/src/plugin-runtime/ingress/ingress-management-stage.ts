import type { InferenceOperationScope } from '@zhin.js/ai/provider';
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
  });
  if (managementReply != null) {
    await reply(managementReply);
    logger.info(formatCompact({ op: 'agent_host_management', handled: true }));
    return true;
  }

  // ADR 0039 slice B: `rule approve|reject|disable <code>` / `rules` in the rule's own group.
  const groupRuleReply = turnAccess.origin.kind === 'im'
    ? await groupRules.handleCommand({
        platform: turnAccess.origin.platform,
        scope: turnAccess.origin.scope,
        sceneId: turnAccess.origin.sceneId,
        senderId: turnAccess.principal.subjectId,
        senderRoles: message.sender?.roles,
        endpoint: effectiveEndpoint,
        commandText: managementCommandText(message.content, message.commandPrefix),
      })
    : null;
  if (groupRuleReply != null) {
    await reply(groupRuleReply);
    logger.info(formatCompact({ op: 'agent_host_group_rule', handled: true }));
    return true;
  }

  // G6 (#1013): hard-gate cards (`approve tap_…` / `deny tap_…`) before the owner `/approve` commands.
  const toolApprovalReply = turnAccess.origin.kind === 'im'
    ? toolApprovalIm?.handleCommand({
        platform: turnAccess.origin.platform,
        scope: turnAccess.origin.scope,
        sceneId: turnAccess.origin.sceneId,
        senderId: turnAccess.principal.subjectId,
        commandText: managementCommandText(message.content, message.commandPrefix),
      }) ?? null
    : null;
  if (toolApprovalReply != null) {
    await reply(toolApprovalReply);
    logger.info(formatCompact({ op: 'agent_host_tool_approval_im', handled: true }));
    return true;
  }

  const approveReply = /^approve(?:\s|$)/iu.test(managementCommandText(message.content, message.commandPrefix) ?? '')
    ? zhinAgent.ownerApprovals.handleCommand(
        {
          endpoint: message.conversation.endpoint,
          ownerId,
          subjectId: turnAccess.principal.subjectId,
          scope: turnAccess.origin.kind === 'im' ? turnAccess.origin.scope : 'private',
          locale: message.locale,
          commandPrefix: message.commandPrefix,
        },
        message.content,
      )
    : null;
  if (approveReply != null) {
    await reply(approveReply);
    logger.info(formatCompact({ op: 'agent_host_approve', handled: true }));
    return true;
  }

  return false;
}
