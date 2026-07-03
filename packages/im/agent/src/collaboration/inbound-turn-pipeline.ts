/**
 * InboundTurnPipeline — Agent Orchestration Plane entry (ADR 0023).
 *
 * Stages: enrich → peerPolicy → buildTurnPlan → executeTurn → outbound
 */
import type { Plugin, Tool, Message, MessageElement, AgentTurnMessage, AIAccessScopeConfig, AITriggerConfig } from '@zhin.js/core';
import {
  checkAIAccess,
  enrichMessageForAgent,
  resolveQuoteContextBlock,
  QUOTE_CONTEXT_BLOCK_EXTRA_KEY,
  QUOTE_CONTEXT_SYSTEM_EXTRA_KEY,
  QUOTE_CONTEXT_SYSTEM_HINT,
  QUOTED_MESSAGE_CONTEXT_MARKER,
  resolveQuotedMessagePayload,
} from '@zhin.js/core';
import type { ContentPart } from '@zhin.js/ai';
import type { OutputElement } from '@zhin.js/ai';
import { parseOutput, resolveIMSessionIdFromMessage } from '@zhin.js/ai';
import { formatCompactLog, truncatePreview, formatContentChainLog, CONTENT_CHAIN_STAGE } from '@zhin.js/logger';
import { formatRedactedJson } from '@zhin.js/ai';
import type { AIServiceRefs } from '../init/shared-refs.js';
import { extractMediaParts, extractMediaPartsFromQuotedPayload } from '../init/message-media.js';
import {
  preprocessInboundMedia,
  publishOutboundElements,
  resolveMultimodalConfig,
  getPrimaryAppConfig,
  INBOUND_MEDIA_PARTS_EXTRA_KEY,
} from '../media/index.js';
import { providerSupportsVision } from '../media/vision-capability.js';
import { DEFAULT_ZHIN_AGENT_NAME } from '../config/types.js';
import { discoverWorkspaceAgents } from '../discovery/agents.js';
import { canAccessTool } from '../orchestrator/tool-selection.js';
import { formatAiHandlerCompleteLog } from '../zhin-agent/turn-metrics.js';
import {
  formatSubagentProcessingMessage,
  SUBAGENT_GOAL_NOTIFY_EXTRA_KEY,
  shouldSuppressSubagentGoalNotifyToIm,
  type SubagentProcessingNotice,
} from '../subagent-goal-notify.js';
import type { AIService } from '../service.js';
import { evaluateCellAtOwnership, evaluatePeerTrigger, isInboundFromCollaborationPeer } from './peer-policy.js';
import { buildTurnPlan } from './turn-plan-resolver.js';
import { getCollaborationCellService } from './cell-service.js';
import { findCellForInbound, findCellMemberByEndpoint } from './collaboration-config.js';
import { sendImMentionDelegation } from './im-mention-delegate.js';
import {
  tryBuildCollaborationOutboundBatches,
  sanitizeCellToolJsonInOutboundBatches,
  batchHasAtSegment,
  isCollaborationNoOpReasoningOutbound,
} from './collaboration-outbound.js';
import { expandOutboundBatchesForLongText } from './group-message.js';
import { normalizePlannerOutboundBatches } from './planner-outbound-normalize.js';
import { tryCompleteKernelGroupMentionFromOutbound } from './collaboration-kernel-bridge.js';
import {
  messageTextContent,
  stripCellToolJsonFromOutputElements,
  summarizeDelegateeReply,
  isSubstantiveGroupTaskReply,
} from './collaboration-delegation.js';
import { getAgentRuntimeRegistry } from './runtime-registry.js';
import { attachCollaborationTurnSnapshot } from './collaboration-turn-snapshot.js';
import type { GroupMessageAdapterView } from './group-message.js';
import type { CollaborationCell, PeerTriggerMode } from './types.js';
import { getOrchestrationService } from '../orchestrator/orchestration-service.js';
import { createOrchestrationTools } from '../builtin/orchestration-tools.js';

function applyCollaborationOutboundPostProcess(
  batches: MessageElement[][],
  input: {
    cell?: CollaborationCell;
    endpointId: string;
    adapterView?: GroupMessageAdapterView;
    selfMember?: CollaborationCell['members'][number];
  },
): MessageElement[][] {
  const { cell, endpointId, adapterView, selfMember } = input;

  let result = batches.map((batch) => [...batch]);

  if (cell && selfMember?.pipelineRole === 'planner' && adapterView) {
    result = normalizePlannerOutboundBatches(result, cell, endpointId, adapterView);
  }

  return result.filter((batch) => batch.length > 0);
}

function resolveEndpointAtIds(message: Message, root: Plugin): string[] {
  const ids = new Set<string>([String(message.$endpoint)]);
  try {
    const adapter = root.inject(message.$adapter) as
      | { endpoints?: Map<string, { $config?: Record<string, unknown>; $platformUserId?: string }> }
      | undefined;
    const endpoint = adapter?.endpoints?.get(message.$endpoint);
    const cfg = endpoint?.$config;
    if (cfg?.name) ids.add(String(cfg.name));
    if (cfg?.appid) ids.add(String(cfg.appid));
    if (endpoint?.$platformUserId) ids.add(String(endpoint.$platformUserId));
  } catch {
    // adapter 未就绪
  }
  return [...ids];
}

function resolveEndpointAiAccess(message: Message, root: Plugin): AIAccessScopeConfig | undefined {
  try {
    const adapter = root.inject(message.$adapter) as
      | { endpoints?: Map<string, { $config?: { aiAccess?: AIAccessScopeConfig } }> }
      | undefined;
    return adapter?.endpoints?.get(message.$endpoint)?.$config?.aiAccess;
  } catch {
    return undefined;
  }
}

export interface InboundTurnPipelineDeps {
  root: Plugin;
  ai: AIService;
  refs: AIServiceRefs;
  triggerConfig: AITriggerConfig;
  peerMode: PeerTriggerMode;
  logger: { debug: (...a: unknown[]) => void; info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void };
  replyOutbound: (payload: unknown, options?: { quote?: boolean }) => Promise<unknown>;
}

export type InboundTurnPipeline = (
  message: Message,
  content: string,
) => Promise<void>;

export function createInboundTurnPipeline(deps: InboundTurnPipelineDeps): InboundTurnPipeline {
  const { root, ai, refs, triggerConfig, peerMode, logger, replyOutbound } = deps;

  return async (message: Message, content: string) => {
    const t0 = performance.now();
    const endpointId = String(message.$endpoint);

    if (!ai.isReady()) {
      logger.warn(formatCompactLog('AI Handler', { skip: 'not_ready', endpoint: endpointId }));
      await replyOutbound('AI 服务未就绪，请检查 zhin.config.yml 中的 providers 配置。');
      return;
    }

    const registry = getAgentRuntimeRegistry();
    const zhinAgent = registry.getForEndpoint(endpointId) ?? refs.zhinAgent;
    if (!zhinAgent) {
      logger.warn(formatCompactLog('AI Handler', { skip: 'no_zhin_agent', endpoint: endpointId }));
      await replyOutbound('AI Agent 未初始化，请查看启动日志。');
      return;
    }

    const access = checkAIAccess(
      message,
      ai.getAccessConfig?.(),
      resolveEndpointAiAccess(message, root),
    );
    if (!access.allowed) {
      logger.info(formatCompactLog('AI Access', {
        adapter: message.$adapter,
        endpoint: endpointId,
        channel: message.$channel?.type,
        allowed: false,
        reason: access.reason,
      }));
      if (access.replyMessage) await replyOutbound(access.replyMessage);
      return;
    }

    const endpointAtIds = resolveEndpointAtIds(message, root);
    const cellService = getCollaborationCellService();
    const scope = message.$channel?.type || 'private';
    const sceneId = message.$channel?.id ?? '';
    let cell =
      (scope === 'group' || scope === 'channel') && sceneId !== ''
        ? findCellForInbound(
          cellService.listCells(),
          String(message.$adapter),
          String(sceneId),
          endpointId,
        )
        : undefined;
    if (cell) {
      const fresh = await cellService.getCellFresh(cell.id);
      if (fresh) cell = fresh;
    }

    const peerResult = evaluatePeerTrigger({
      message,
      cell,
      peerMode,
      endpointAtIds,
      root,
    });
    if (peerResult.isPeer && !peerResult.shouldTrigger) {
      logger.debug(formatCompactLog('AI Handler', {
        skip: 'peer_mention_required',
        peer: peerResult.peerEndpointId,
        reason: peerResult.reason,
      }));
      return;
    }

    const atOwnership = evaluateCellAtOwnership(message, cell, endpointId, root);
    if (!atOwnership.shouldHandle) {
      logger.debug(formatCompactLog('AI Handler', {
        skip: atOwnership.reason ?? 'cell_at_filter',
        mentioned: atOwnership.mentionedEndpointIds?.join(','),
        endpoint: endpointId,
      }));
      return;
    }

    const peerInbound = isInboundFromCollaborationPeer(message, cell, root);
    const replyAi = (payload: unknown) =>
      replyOutbound(payload, { quote: !peerInbound });

    if (peerInbound && cell && peerResult.peerEndpointId) {
      const orch = getOrchestrationService();
      if (orch) {
        const rawText = messageTextContent(message);
        const explicitTaskId = rawText.match(/(?:^|[\s(（])#([A-Za-z0-9_-]{4,})(?=$|[\s),，。.!！?:：）])/u)?.[1];
        const sessionKey = resolveIMSessionIdFromMessage(message);
        const runs = await orch.listRuns(sessionKey);
        const activeGroupTasks = runs.flatMap((run) => run.tasks).filter((task) =>
          task.executor_kind === 'group_mention'
          && task.assigned_to === peerResult.peerEndpointId
          && ['assigned', 'running', 'waiting_result', 'pending'].includes(task.status),
        );
        const target = explicitTaskId
          ? activeGroupTasks.find((task) => task.id === explicitTaskId)
            ?? (await orch.repositoryHandle.getTask(explicitTaskId))
          : activeGroupTasks.length === 1
            ? activeGroupTasks[0]
            : undefined;

        if (!explicitTaskId && activeGroupTasks.length > 1) {
          const hint = `检测到 ${activeGroupTasks.length} 个活跃任务，请在回复中带上 #taskId，例如 #${activeGroupTasks[0]!.id}`;
          for (const task of activeGroupTasks) {
            await orch.taskProgress(task.id, `ambiguous handback from ${peerResult.peerEndpointId}; taskId required`);
          }
          await replyAi(hint);
          return;
        }

        if (target?.executor_kind === 'group_mention') {
          const assignee = target.assigned_to || peerResult.peerEndpointId;
          if (assignee !== peerResult.peerEndpointId) {
            logger.debug(formatCompactLog('OrchestrationKernel', {
              action: 'group_handback_skip',
              reason: 'assignee_mismatch',
              task: target.id,
              assignee,
              from: peerResult.peerEndpointId,
            }));
          } else {
            const summary = summarizeDelegateeReply(
              explicitTaskId ? rawText.replace(`#${explicitTaskId}`, '').trim() : rawText,
            );
            if (!isSubstantiveGroupTaskReply(summary)) {
              logger.info(formatCompactLog('OrchestrationKernel', {
                action: 'group_handback_skip',
                reason: 'not_substantive',
                task: target.id,
                from: peerResult.peerEndpointId,
              }));
            } else {
              await orch.completeTask(target.id, summary);
              logger.info(formatCompactLog('OrchestrationKernel', {
                action: 'group_handback',
                task: target.id,
                cell: cell.id,
                from: peerResult.peerEndpointId,
              }));
            }
          }
        }
      }
    }

    if (triggerConfig.thinkingMessage) await replyAi(triggerConfig.thinkingMessage);

    enrichMessageForAgent(root, message);
    const commMessage = message as AgentTurnMessage;
    commMessage.extra = {
      ...(commMessage.extra ?? {}),
      [SUBAGENT_GOAL_NOTIFY_EXTRA_KEY]: async (notice: SubagentProcessingNotice) => {
        if (shouldSuppressSubagentGoalNotifyToIm(message, cell)) {
          logger.debug(formatCompactLog('SubagentGoal', {
            suppress_im: true,
            cell: cell?.id,
            taskId: notice.taskId,
            kind: notice.kind,
            label: truncatePreview(notice.label),
          }));
          return;
        }
        await replyOutbound(formatSubagentProcessingMessage(notice));
      },
    };
    const toolService = root.inject('tool');
    let externalTools: Tool[] = [...ai.getResidentToolsAsTools()];
    if (toolService) {
      externalTools.push(...toolService.getAll());
      externalTools = toolService.filterByContext(externalTools, commMessage);
    } else {
      externalTools = externalTools.filter((t) => canAccessTool(t, commMessage));
    }
    if (cell) {
      externalTools.push(...createOrchestrationTools(commMessage));
    }

    try {
      const resolveQuotes = triggerConfig.resolveQuotedMessages && !peerInbound;
      let mediaParts = extractMediaParts(message);
      if (message.$quote_id && resolveQuotes) {
        const quoted = await resolveQuotedMessagePayload(message, root, { enabled: true });
        if (quoted) {
          const fromQuote = extractMediaPartsFromQuotedPayload(quoted, message.$adapter);
          if (fromQuote.length) mediaParts = [...fromQuote, ...mediaParts];
        }
      }

      let firstChunkMs = 0;
      const onChunk: (chunk: string, full: string) => void = () => {
        if (!firstChunkMs) {
          firstChunkMs = performance.now() - t0;
          logger.debug(formatCompactLog('AI Handler', { first_token_ms: Math.round(firstChunkMs) }));
        }
      };

      const quoteBlock = await resolveQuoteContextBlock(message, root, {
        enabled: resolveQuotes,
      });
      if (quoteBlock?.includes(QUOTED_MESSAGE_CONTEXT_MARKER)) {
        commMessage.extra = {
          ...commMessage.extra,
          [QUOTE_CONTEXT_BLOCK_EXTRA_KEY]: quoteBlock,
          [QUOTE_CONTEXT_SYSTEM_EXTRA_KEY]: QUOTE_CONTEXT_SYSTEM_HINT,
        };
      }

      const aiContent = content;
      const routing = refs.aiService?.getRoutingConfig();
      const bindingRegistry = refs.aiService?.getBindingRegistry();
      let discoveredAgentNames = new Set<string>();
      if (refs.aiService && routing && bindingRegistry) {
        const agentMetas = await discoverWorkspaceAgents(root);
        refs.aiService.setDiscoveredAgents(agentMetas);
        discoveredAgentNames = bindingRegistry.getDiscoveredAgentNames();
      }

      const turnPlan = buildTurnPlan({
        message,
        contentText: aiContent,
        endpointId,
        cells: cellService.listCells(),
        agents: routing?.agents ?? {},
        discoveredAgentNames,
      });

      logger.debug(formatCompactLog('AI Handler', {
        turn_plan: turnPlan.handlerProfile,
        cell: turnPlan.cellId,
        delegation: turnPlan.delegation?.mode,
      }));

      if (
        turnPlan.delegation?.mode === 'im_mention'
        && turnPlan.delegation.targetEndpointId
        && turnPlan.delegation.targetEndpointId !== endpointId
      ) {
        const delegateText = aiContent.trim() || '请处理上述协作请求。';
        const orch = getOrchestrationService();
        if (orch && cell) {
          const run = await orch.findOrCreateRun({
            sessionKey: resolveIMSessionIdFromMessage(commMessage),
            title: delegateText.slice(0, 80) || 'IM group delegation',
            source: {
              kind: 'im_cell',
              cellId: cell.id,
              adapter: String(message.$adapter),
              sceneId,
            },
          });
          const dispatched = await orch.dispatchTask({
            runId: run.id,
            name: `@${turnPlan.delegation.targetEndpointId}`,
            description: delegateText,
            role: 'worker',
            goal: delegateText,
            executorKind: 'group_mention',
            assignedTo: turnPlan.delegation.targetEndpointId,
            context: {
              handlerProfile: turnPlan.handlerProfile,
              fromEndpointId: endpointId,
            },
            message: commMessage,
            autoStart: false,
          });
          // Execute via the registered group_mention executor (ADR 0027).
          const result = await orch.runTask(dispatched.task.id, commMessage);
          if (result.status === 'waiting_result' || result.status === 'running') {
            logger.info(formatCompactLog('AI Handler', {
              path: 'kernel_group_mention',
              run: dispatched.run.id,
              task: dispatched.task.id,
              from: endpointId,
              to: turnPlan.delegation.targetEndpointId,
              agent: turnPlan.handlerProfile,
            }));
            return;
          }
          logger.warn(formatCompactLog('AI Handler', {
            path: 'kernel_group_mention_failed',
            task: dispatched.task.id,
            error: result.error,
            fallback: 'local_process',
          }));
        } else {
          const sent = await sendImMentionDelegation({
            message,
            targetEndpointId: turnPlan.delegation.targetEndpointId,
            text: delegateText,
            cell,
          });
          if (sent.ok) {
            logger.info(formatCompactLog('AI Handler', {
              path: 'im_mention_legacy',
              from: endpointId,
              to: turnPlan.delegation.targetEndpointId,
              agent: turnPlan.handlerProfile,
            }));
            return;
          }
          logger.warn(formatCompactLog('AI Handler', {
            path: 'im_mention_failed',
            error: sent.error,
            fallback: 'local_process',
          }));
        }
      }

      if (
        turnPlan.delegation?.mode === 'spawn_task'
        && turnPlan.delegation.targetAgentId
        && turnPlan.delegation.targetAgentId !== DEFAULT_ZHIN_AGENT_NAME
      ) {
        const subagentManager = zhinAgent.getSubagentManager();
        if (subagentManager) {
          const targetAgentId = turnPlan.delegation.targetAgentId;
          const delegateText = aiContent.trim() || '请处理这条入站消息。';
          const orch = getOrchestrationService();
          let summary: string;
          let kernelTaskId: string | undefined;
          if (orch) {
            const run = await orch.findOrCreateRun({
              sessionKey: resolveIMSessionIdFromMessage(commMessage),
              title: aiContent.slice(0, 80) || `Route to ${targetAgentId}`,
              source: cell
                ? {
                  kind: 'im_cell',
                  cellId: cell.id,
                  adapter: String(message.$adapter),
                  sceneId,
                }
                : {
                  kind: 'im_session',
                  adapter: String(message.$adapter),
                  endpointId,
                  sceneId: sceneId || undefined,
                },
            });
            const dispatched = await orch.dispatchTask({
              runId: run.id,
              name: targetAgentId,
              description: delegateText,
              role: 'subtask',
              goal: delegateText,
              executorKind: 'local',
              assignedTo: targetAgentId,
              context: {
                route: 'inbound_spawn_task',
              },
              message: commMessage,
              autoStart: false,
            });
            kernelTaskId = dispatched.task.id;
            // Execute via the registered local executor (ADR 0027). Media
            // handling and subagent spawn live in the executor, not here.
            const completed = await orch.runTask(dispatched.task.id, commMessage);
            if (completed.status === 'failed') {
              throw new Error(completed.error ?? `subagent ${targetAgentId} failed`);
            }
            summary = completed.resultSummary ?? '';
          } else {
            summary = await subagentManager.spawnSync({
              task: delegateText,
              label: targetAgentId,
              agent: targetAgentId,
              binding: bindingRegistry?.getBinding(targetAgentId) ?? undefined,
              origin: { message: commMessage },
              notifyContext: commMessage,
            });
          }
          const outboundSegments = await publishOutboundElements(parseOutput(summary), message.$adapter);
          if (outboundSegments.length) await replyAi(outboundSegments);
          logger.info(formatCompactLog('AI Handler', {
            path: kernelTaskId ? 'kernel_spawn_task' : 'spawn_task_legacy',
            task: kernelTaskId,
            agent: targetAgentId,
          }));
          return;
        }
        logger.warn(formatCompactLog('AI Handler', {
          path: 'spawn_task_unavailable',
          agent: turnPlan.delegation.targetAgentId,
          fallback: 'local_process',
        }));
      }

      const handlerBinding =
        bindingRegistry?.getBinding(turnPlan.handlerProfile)
        ?? bindingRegistry?.getBinding(DEFAULT_ZHIN_AGENT_NAME)
        ?? bindingRegistry?.requireZhinBinding();
      if (handlerBinding) zhinAgent.setActiveBinding(handlerBinding);

      if (cell && findCellMemberByEndpoint(cell, endpointId)) {
        const snapCell = (await cellService.getCellFresh(cell.id)) ?? cell;
        attachCollaborationTurnSnapshot(commMessage, snapCell, endpointId);
        cell = snapCell;
      }

      let elements: OutputElement[];
      const mmConfig = resolveMultimodalConfig();
      if (mediaParts.length > 0 && mmConfig.enabled) {
        const pre = await preprocessInboundMedia(mediaParts, mmConfig, undefined, {
          getConfig: getPrimaryAppConfig,
          warn: (msg) => logger.warn(formatContentChainLog({
            stage: CONTENT_CHAIN_STAGE.STT,
            peer: 'speech',
            fallback: msg,
          })),
          logContentChain: (fields) => logger.info(formatContentChainLog(fields)),
        });
        const fullContent = [content, pre.textAppend].filter(Boolean).join('\n\n');
        const visionProvider = handlerBinding && refs.aiService?.isReady()
          ? refs.aiService.getProvider(handlerBinding.providerAlias)
          : refs.aiService?.getProvider();
        const canInjectVision = pre.visionParts.length > 0
          && refs.aiService?.isReady()
          && visionProvider
          && providerSupportsVision(visionProvider);
        if (canInjectVision) {
          commMessage.extra = {
            ...commMessage.extra,
            [INBOUND_MEDIA_PARTS_EXTRA_KEY]: pre.visionParts,
          };
        }
        try {
          elements = await zhinAgent.process(fullContent, commMessage, externalTools, onChunk);
        } catch {
          const parts: ContentPart[] = [];
          if (aiContent) parts.push({ type: 'text', text: aiContent });
          parts.push(...mediaParts);
          elements = await zhinAgent.processMultimodal(parts, commMessage, onChunk);
        }
      } else if (mediaParts.length > 0) {
        const parts: ContentPart[] = [];
        if (aiContent) parts.push({ type: 'text', text: aiContent });
        parts.push(...mediaParts);
        elements = await zhinAgent.processMultimodal(parts, commMessage, onChunk);
      } else {
        elements = await zhinAgent.process(aiContent, commMessage, externalTools, onChunk);
      }

      if (cell) {
        elements = stripCellToolJsonFromOutputElements(elements);
      }

      const collabBatches = await tryBuildCollaborationOutboundBatches(message, elements, {
        inboundContent: aiContent,
        warn: (msg) => logger.warn(msg),
      });
      let outboundBatches: MessageElement[][] = collabBatches ?? [
        await publishOutboundElements(elements, message.$adapter),
      ];

      if (cell) {
        const freshOutbound = await cellService.getCellFresh(cell.id);
        if (freshOutbound) cell = freshOutbound;
      }

      const selfMember = cell ? findCellMemberByEndpoint(cell, endpointId) : undefined;
      const adapterView = root.inject(message.$adapter) as GroupMessageAdapterView | undefined;

      outboundBatches = applyCollaborationOutboundPostProcess(outboundBatches, {
        cell,
        endpointId,
        adapterView,
        selfMember,
      });

      if (cell) {
        outboundBatches = sanitizeCellToolJsonInOutboundBatches(outboundBatches);
      }
      outboundBatches = expandOutboundBatchesForLongText(outboundBatches);

      if (cell && isCollaborationNoOpReasoningOutbound(outboundBatches)) {
        logger.info(formatCompactLog('CollaborationOutbound', {
          action: 'suppress_noop_reasoning',
          cell: cell.id,
          endpoint: endpointId,
        }));
        outboundBatches = [];
      }

      for (let i = 0; i < outboundBatches.length; i++) {
        const batch = outboundBatches[i]!;
        if (!batch.length) continue;
        const quote = !peerInbound && i === 0 && !batchHasAtSegment(batch);
        await replyOutbound(batch, { quote });
      }

      if (cell && outboundBatches.some((b) => b.length > 0)) {
        try {
          await tryCompleteKernelGroupMentionFromOutbound({
            message,
            cell,
            endpointId,
            outboundBatches,
            logger,
          });
        } catch (err) {
          logger.warn(formatCompactLog('OrchestrationKernel', {
            action: 'outbound_complete_failed',
            cell: cell.id,
            endpoint: endpointId,
            error: err instanceof Error ? err.message : String(err),
          }));
        }
      }

      const totalMs = performance.now() - t0;
      const turnMetrics = zhinAgent.getLastTurnMetrics();
      if (turnMetrics) {
        logger.info(formatAiHandlerCompleteLog(turnMetrics, totalMs));
      } else {
        logger.info(formatCompactLog('AI Handler', { total_ms: Math.round(totalMs), usage: 'n/a' }));
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn(formatCompactLog('AI Handler', {
        total_ms: Math.round(performance.now() - t0),
        ok: false,
        error: truncatePreview(msg),
      }));
      await replyAi((triggerConfig.errorTemplate ?? '❌ AI 处理失败: {error}').replace('{error}', msg));
    }
  };
}
