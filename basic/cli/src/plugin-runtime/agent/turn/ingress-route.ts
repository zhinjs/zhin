import { randomUUID } from 'node:crypto';
import {
  createAutoApprovalPort,
  handleRuntimeManagementCommand,
  publishOutboundElements,
  type ApprovalPort,
} from '@zhin.js/agent';
import {
  CapabilityIngress,
  AgentRuntime,
  type AgentCapabilities,
  type TurnIntentResolver,
} from '@zhin.js/agent/runtime';
import {
  type ImRuntime,
  type IngressRoute,
  type Message,
  type SendContent,
} from '@zhin.js/core/runtime';
import { formatCompact, getLogger } from '@zhin.js/logger';
import {
  rootPluginId,
  type PluginId,
  type RuntimeSnapshot,
  type SnapshotLease,
} from '@zhin.js/plugin-runtime';
import { observeAgentTurnTrace } from '../runtime-factory.js';
import type { AgentRuntimeFoundation } from '../runtime-foundation.js';
import {
  completedOutput,
  flattenOutputElements,
  isClearCommand,
  preprocessInboundTurn,
} from './content.js';
import {
  renderTriggerError,
  resolveRuntimeAgentTrigger,
  resolveTriggerTimeoutMs,
  restrictWorkroomAgentCapabilities,
  routeSpecialistAgent,
  withTriggerTimeout,
  workroomOrchestratorSessionKey,
} from './trigger.js';
import {
  adapterLiveEndpointId,
  capabilityLocalName,
  createRuntimeApprovalPort,
  createRuntimeQuestionPort,
  createRuntimeTurnAccess,
  createRuntimeTurnRequest,
  deliveryOutcomeFromReceipt,
  interactiveNetworkPolicy,
  resolveOwnerForRuntimeMessage,
  resolveProductTurnIntent,
  resolveRuntimeSenderRoles,
  resolveSnapshotTurnIntentResolver,
  resolveTrustedForRuntimeMessage,
  runtimeImSessionKey,
  type RuntimeSenderRoles,
} from './request.js';
import type { AgentWorkroomPort } from '../workroom-port.js';
import { resolveSandboxTurnPolicy } from './sandbox-policy.js';

const logger = getLogger('agent');

export interface AgentTurnIngressRouteOptions {
  readonly projectRoot: string;
  readonly runtime: AgentRuntime;
  readonly im: ImRuntime;
  readonly transcribeUrl?: (audioUrl: string) => Promise<string | null>;
  readonly approvalPort?: ApprovalPort;
  readonly resolveTurnIntent?: TurnIntentResolver;
  readonly resolveEndpointOwner?: (adapterLocalName: string, endpointKey: string) => string | undefined;
  readonly resolveEndpointTrusted?: (adapterLocalName: string, endpointKey: string) => readonly string[];
  readonly ingress: CapabilityIngress;
  readonly agent: AgentRuntimeFoundation;
  readonly workroom: AgentWorkroomPort;
}

/** Generation-owned IM ingress adapter for management, approval, and Agent turns. */
export class AgentTurnIngressRoute implements IngressRoute {

  constructor(private readonly options: AgentTurnIngressRouteOptions) {}

  async preRoute(
    message: Message,
    _lease: SnapshotLease,
    _requester: PluginId,
    conversationSequence: number | undefined,
  ): Promise<boolean> {
    return await this.options.workroom.preRoute(message, conversationSequence);
  }

  shouldRouteBeforeDispatch(message: Message): boolean {
    return this.options.workroom.hasAgentTurn(message)
      && resolveRuntimeAgentTrigger(
        message,
        this.options.agent.service.getTriggerConfig(),
        true,
      ) != null;
  }

  async route(
    message: Message,
    lease: SnapshotLease,
    requester: PluginId,
    conversationSequence: number | undefined,
  ): Promise<boolean> {
    const options = this.options;
    const service = options.agent.service;
    const zhinAgent = options.agent.agent;
    const traceRuntime = options.agent.traceRuntime;
    const binding = service.getBindingRegistry().requireZhinBinding();
    const ingress = options.ingress;
    const workroom = options.workroom;
      const snapshot = lease.value;
      const trigger = service.getTriggerConfig();
      const workroomAgentTurn = workroom.takeAgentTurn(message);
      const matched = resolveRuntimeAgentTrigger(message, trigger, workroomAgentTurn != null);

      const ownerId = resolveOwnerForRuntimeMessage(message, options.resolveEndpointOwner);
      const endpointTrusted = resolveTrustedForRuntimeMessage(message, options.resolveEndpointTrusted);
      const senderRoles = resolveRuntimeSenderRoles(message, ownerId, endpointTrusted, trigger);
      const turnAccess = createRuntimeTurnAccess(message, senderRoles);
      const sessionKey = workroomAgentTurn
        ? workroomOrchestratorSessionKey(workroomAgentTurn)
        : runtimeImSessionKey(turnAccess);
      const workroomReplyConversation = workroomAgentTurn
        ? await workroom.resolveOrchestratorConversation(workroomAgentTurn)
        : undefined;
      if (workroomAgentTurn && !workroomReplyConversation) {
        throw new Error(`Workroom ${workroomAgentTurn.projectId} has no current Orchestrator projection binding`);
      }

      // Runtime message.adapter is a CapabilityId (\0-separated); strip it and
      // use Endpoint liveName so the OutboundHost resolve() succeeds.
      const effectiveAdapter = capabilityLocalName(String(message.conversation.endpoint.id));
      const effectiveEndpoint = adapterLiveEndpointId(message);
      const reply = async (
        content: SendContent,
      ): Promise<Awaited<ReturnType<Message['$reply']>>> => {
        const receipt = workroomReplyConversation
          ? await options.im.sendWithSnapshotLease(lease, {
              conversation: workroomReplyConversation,
              requester: rootPluginId(),
              content,
            })
          : await message.$reply(content);
        logger.debug(formatCompact({
          op: 'replychain_message_reply',
          status: receipt.status,
          code: receipt.failure?.code,
          messageId: receipt.message?.id,
        }));
        return receipt;
      };

      // Agent 管理命令（/models /tree /reset…）— 在 AI trigger 前拦截
      const managementReply = workroomAgentTurn
        ? null
        : await handleRuntimeManagementCommand({
            service,
            zhinAgent,
            sessionKey,
            content: message.content,
            senderRoles,
          });
      if (managementReply != null) {
        await reply(managementReply);
        logger.info(formatCompact({ op: 'agent_host_management', handled: true }));
        return true;
      }

      const approveReply = !workroomAgentTurn && /^\/approve(?:\s|$)/iu.test(message.content.trim())
        ? zhinAgent.ownerApprovals.handleCommand(
            {
              platform: turnAccess.origin.kind === 'im' ? turnAccess.origin.platform : '',
              endpoint: turnAccess.origin.kind === 'im' ? turnAccess.origin.endpoint : '',
              ownerId,
              subjectId: turnAccess.principal.subjectId,
              scope: turnAccess.origin.kind === 'im' ? turnAccess.origin.scope : 'private',
            },
            message.content,
          )
        : null;
      if (approveReply != null) {
        await reply(approveReply);
        logger.info(formatCompact({ op: 'agent_host_approve', handled: true }));
        return true;
      }

      if (!matched) {
        return false;
      }

      if (!workroomAgentTurn && isClearCommand(matched.content)) {
        await zhinAgent.archiveSession(sessionKey);
        await reply('已清空本会话的 AI 多轮上下文。');
        return true;
      }

      let capabilityActive = true;
      try {
        const inbound = await preprocessInboundTurn(
          message,
          matched.content,
          options.transcribeUrl,
        );
        const capabilities = restrictWorkroomAgentCapabilities(await readCapabilities(
          ingress,
          snapshot,
          requester,
          message,
          senderRoles,
          () => capabilityActive,
        ), workroomAgentTurn != null);
        const routed = routeSpecialistAgent(
          inbound.text,
          capabilities,
          workroomAgentTurn?.agentDefinitionId,
          binding.name,
          turnAccess.origin.kind === 'im' ? turnAccess.origin.platform : undefined,
        );
        // thinkingMessage：进入 AI 处理前先回占位（对齐 legacy inbound-turn-pipeline）。
        // 占位消息不 await 回包——平台 ack 慢不应拖住 turn 启动；
        // 失败仅记日志（正式回复仍走 replyAndRecord 的完整确认）。
        if (trigger.thinkingMessage) {
          message.$reply(trigger.thinkingMessage).catch((error: unknown) => {
            logger.debug(formatCompact({
              op: 'agent_host_thinking_reply_failed',
              error: error instanceof Error ? error.message : String(error),
            }));
          });
        }

        const outcome = await withTriggerTimeout(
          async (signal) => {
            const turnPolicy = resolveSandboxTurnPolicy({
              platform: turnAccess.origin.kind === 'im' ? turnAccess.origin.platform : '',
              isMaster: senderRoles.isMaster,
              metadata: message.metadata,
              projectRoot: options.projectRoot,
              defaultNetwork: interactiveNetworkPolicy(service.getAgentConfig()),
            });
            const approvalInteraction = ownerId
              ? options.im.createInteraction(message, { subjectId: ownerId })
              : undefined;
            const askApprovalPort = createRuntimeApprovalPort({
              // Sandbox `ask` must be a real interaction, even though the
              // authenticated Console user maps to the endpoint owner.
              isMaster: senderRoles.isMaster && turnPolicy.shell?.approvalMode !== 'ask',
              interaction: approvalInteraction,
              memory: options.agent.approvalReviewer,
            });
            const escalatedApprovalPort = createRuntimeApprovalPort({
              isMaster: false,
              interaction: approvalInteraction,
              memory: options.agent.approvalReviewer,
            });
            const request = createRuntimeTurnRequest(message, routed.userText, senderRoles, {
              traceId: randomUUID(),
              turnId: randomUUID(),
              signal,
              workspaceRoot: turnPolicy.filesystem.workspaceRoot,
              workingDirectory: turnPolicy.filesystem.workingDirectory,
              filesystemAccess: turnPolicy.filesystem.access,
              shell: turnPolicy.shell,
              network: turnPolicy.network,
              sessionKey,
              ...(workroomAgentTurn ? {
                trustedMetadata: Object.freeze({
                  workroom: Object.freeze({
                    projectId: workroomAgentTurn.projectId,
                    proposalId: workroomAgentTurn.proposalId,
                    space: workroomAgentTurn.space,
                    disposition: 'discussion',
                    orchestratorAgentDefinitionId: workroomAgentTurn.agentDefinitionId,
                  }),
                }),
              } : {}),
              intent: await resolveProductTurnIntent(
                message,
                senderRoles,
                service.getAgentConfig()?.inboundQueue?.groupMode,
                resolveSnapshotTurnIntentResolver(snapshot, requester) ?? options.resolveTurnIntent,
              ),
              resolveReference: (reference, limits, referenceSignal) =>
                options.im.resolveConversationReference(lease, reference, {
                  signal: referenceSignal,
                  maxDepth: limits.depth,
                  maxEntries: limits.maxEntries,
                  maxChars: limits.maxChars,
                }),
              ...(conversationSequence === undefined || workroomAgentTurn ? {} : {
                readConversationContext: async (consumer: string, contextSignal: AbortSignal) => {
                  contextSignal.throwIfAborted();
                  if (!lease.active) throw new Error('Conversation context generation lease expired');
                  return options.im.readConversationContext(
                    message.conversation,
                    consumer,
                    conversationSequence,
                    50,
                    message.message?.id,
                  );
                },
                commitConversationContext: async (consumer: string, cursor: number) => {
                  if (!lease.active) throw new Error('Conversation context generation lease expired');
                  await options.im.commitConversationContext(message.conversation, consumer, cursor);
                },
              }),
              ports: {
                approval: options.approvalPort ?? resolveApprovalPort({
                  mode: turnPolicy.shell?.approvalMode
                    ?? service.getAgentConfig()?.execApprovalMode
                    ?? 'auto',
                  auto: createAutoApprovalPort(
                    options.agent.approvalReviewer,
                    escalatedApprovalPort,
                  ),
                  bypass: options.agent.bypassApprovalPort,
                  ask: askApprovalPort,
                }),
                question: createRuntimeQuestionPort(options.im, message),
                reply: {
                  send: async (output) => {
                    logger.debug(formatCompact({
                      op: 'replychain_port_send',
                      outputElements: output.length,
                      outputPreview: flattenOutputElements(output).trim() || '(empty)',
                    }));
                    const content = await publishOutboundElements([...output], effectiveAdapter || undefined);
                    logger.debug(formatCompact({
                      op: 'replychain_publish_outbound',
                      segments: content.length,
                    }));
                    if (content.length === 0) return { status: 'suppressed' as const };
                    const outcome = deliveryOutcomeFromReceipt(
                      await reply(content),
                    );
                    logger.debug(formatCompact({
                      op: 'replychain_delivery_outcome',
                      status: outcome.status,
                      code: 'code' in outcome ? outcome.code : undefined,
                      messageId: 'messageId' in outcome ? outcome.messageId : undefined,
                    }));
                    return outcome;
                  },
                },
              },
            });
            return options.runtime.executeLeased(
              lease,
              requester,
              request,
              {
                binding,
                mcpServers: binding.mcpServers,
                agent: routed.agent?.qualifiedName ?? routed.agent?.name,
              },
              observeAgentTurnTrace(traceRuntime, request),
            );
          },
          resolveTriggerTimeoutMs(trigger),
        );
        const elements = completedOutput(outcome);
        const outputText = flattenOutputElements(elements).trim();
        if (!outputText) {
          // spawn_task 等委派回合 finalReply 为空：用户可见文案由 subagent auto-continue
          // + proactive 出站；勿把 '(empty AI response)' 当成正文发给用户。
          logger.debug(formatCompact({
            op: 'agent_host_turn_no_outbound',
            reason: 'empty_elements_delegated',
          }));
        }
        logger.debug(formatCompact({
          op: 'agent_host_turn',
          turnMode: 'agent_runtime.execute',
          tools: outcome.status === 'completed' ? capabilities.tools.length : 0,
          ingressTools: capabilities.tools.length,
          elements: elements.length,
          model: binding.model,
          provider: binding.providerAlias,
          stt: inbound.sttApplied,
          agent: routed.agent?.name ?? '-',
        }));
        return true;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        logger.warn(formatCompact({ op: 'agent_host_turn_fail', error: detail }));
        try {
          await reply(renderTriggerError(trigger, detail));
        } catch {
          /* ignore reply failure */
        }
        return true;
      } finally {
        capabilityActive = false;
      }
  }
}

function resolveApprovalPort(input: Readonly<{
  mode: 'ask' | 'auto' | 'bypass';
  ask: ApprovalPort;
  auto: ApprovalPort;
  bypass: ApprovalPort;
}>): ApprovalPort {
  if (input.mode === 'auto') return input.auto;
  if (input.mode === 'bypass') return input.bypass;
  return input.ask;
}

async function readCapabilities(
  ingress: CapabilityIngress,
  snapshot: RuntimeSnapshot,
  requester: PluginId,
  message: Message,
  roles: RuntimeSenderRoles,
  isActive: () => boolean,
): Promise<AgentCapabilities> {
  return ingress.read(snapshot, requester, isActive, createRuntimeTurnAccess(message, roles));
}
