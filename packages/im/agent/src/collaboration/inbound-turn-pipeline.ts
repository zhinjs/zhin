/**
 * InboundTurnPipeline — Agent Orchestration Plane entry (ADR 0023).
 *
 * Stages: enrich → peerPolicy → buildTurnPlan → executeTurn → outbound
 * Turn 执行委托 `inbound-turn-execute` / `inbound-spawn-task`（阶段 4）。
 */
import type { Plugin, Tool, Message, AgentTurnMessage, AIAccessScopeConfig, AITriggerConfig } from '@zhin.js/core';
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
import type { MessageElement } from '@zhin.js/core';
import { resolveIMSessionIdFromMessage } from '@zhin.js/core';
import { formatCompactLog, truncatePreview, formatContentChainLog, CONTENT_CHAIN_STAGE } from '@zhin.js/logger';
import type { AIServiceRefs } from '../init/shared-refs.js';
import { extractMediaParts, extractMediaPartsFromQuotedPayload } from '../init/message-media.js';
import { DEFAULT_ZHIN_AGENT_NAME } from '../config/types.js';
import { discoverWorkspaceAgents } from '../discovery/agents.js';
import { formatAiHandlerCompleteLog } from '../turn/turn-metrics.js';
import {
  formatSubagentProcessingMessage,
  SUBAGENT_GOAL_NOTIFY_EXTRA_KEY,
  shouldSuppressSubagentGoalNotifyToIm,
  type SubagentProcessingNotice,
} from '../subagent-goal-notify.js';
import type { AIService } from '../service.js';
import { evaluateCellAtOwnership, evaluatePeerTrigger, isInboundFromCollaborationPeer } from './peer-policy.js';
import { buildTurnPlan } from './turn-plan-resolver.js';
import { getCollaborationSceneService } from './scene-service.js';
import { findCellForInbound, findCellMemberByEndpoint } from './collaboration-config.js';
import {
  sanitizeCellToolJsonInOutboundBatches,
  batchHasAtSegment,
  isCollaborationNoOpReasoningOutbound,
} from './collaboration-outbound.js';
import { resolveOutboundBatches } from './outbound-resolver.js';
import { tryCompleteKernelImProjectionFromOutbound } from './collaboration-kernel-bridge.js';
import { dispatchPeerTask } from './collaboration-dispatch.js';
import type { GroupMessageAdapterView } from './group-message.js';
import type { PeerTriggerMode } from './types.js';
import { collectInboundTurnTools } from './inbound-turn-tools.js';
import { tryHandlePeerInboundHandback } from './inbound-peer-handback.js';
import { executeInboundSpawnTaskTurn } from './inbound-spawn-task.js';
import { executeInboundAgentTurn } from './inbound-turn-execute.js';
import { getAgentRuntimeRegistry } from './runtime-registry.js';

function applyCollaborationOutboundPostProcess(
  batches: MessageElement[][],
): MessageElement[][] {
  return batches.filter((batch) => batch.length > 0);
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
  logger: { debug: (...args: unknown[]) => void; info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void };
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
    const cellService = getCollaborationSceneService();
    const scope = message.$channel?.type || 'private';
    const sceneId = message.$channel?.id ?? '';
    let cell =
      (scope === 'group' || scope === 'channel') && sceneId !== ''
        ? findCellForInbound(
          cellService.listScenes(),
          String(message.$adapter),
          String(sceneId),
          endpointId,
        )
        : undefined;
    if (cell) {
      const fresh = await cellService.getSceneFresh(cell.id);
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
      const handbackDone = await tryHandlePeerInboundHandback({
        message,
        cell,
        peerEndpointId: peerResult.peerEndpointId,
        replyAi,
        logger,
      });
      if (handbackDone) return;
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
        endpointIds: endpointAtIds,
        cells: cellService.listScenes(),
        agents: routing?.agents ?? {},
        discoveredAgentNames,
      });

      logger.debug(formatCompactLog('AI Handler', {
        turn_plan: turnPlan.handlerProfile,
        cell: turnPlan.collaborationSceneId,
        delegation: turnPlan.delegation?.mode,
      }));

      const peerTarget = turnPlan.delegation?.delegateToPeer ?? turnPlan.delegation?.targetEndpointId;
      if (peerTarget && peerTarget !== endpointId && cell) {
        const delegateText = aiContent.trim() || '请处理上述协作请求。';
        try {
          const dispatched = await dispatchPeerTask({
            cell,
            fromEndpointId: endpointId,
            toEndpointId: peerTarget,
            goal: delegateText,
            handlerProfile: turnPlan.handlerProfile,
            message: commMessage,
          });
          if (
            dispatched.task.status === 'completed'
            || dispatched.task.status === 'waiting_result'
            || dispatched.task.status === 'running'
          ) {
            logger.info(formatCompactLog('AI Handler', {
              path: 'kernel_internal_room',
              run: dispatched.runId,
              task: dispatched.taskId,
              from: endpointId,
              to: peerTarget,
              agent: turnPlan.handlerProfile,
            }));
            return;
          }
          logger.warn(formatCompactLog('AI Handler', {
            path: 'kernel_internal_room_failed',
            task: dispatched.taskId,
            error: dispatched.task.error,
            fallback: 'local_process',
          }));
        } catch (err) {
          logger.warn(formatCompactLog('AI Handler', {
            path: 'kernel_internal_room_failed',
            error: err instanceof Error ? err.message : String(err),
            fallback: 'local_process',
          }));
        }
      }

      if (
        turnPlan.delegation?.mode === 'spawn_task'
        && turnPlan.delegation.targetAgentId
        && turnPlan.delegation.targetAgentId !== DEFAULT_ZHIN_AGENT_NAME
      ) {
        const spawnResult = await executeInboundSpawnTaskTurn({
          zhinAgent,
          commMessage,
          message,
          aiContent,
          delegation: turnPlan.delegation,
          cell,
          bindingRegistry,
          replyAi,
          logger,
        });
        if (spawnResult.handled) return;
      }

      const handlerBinding =
        bindingRegistry?.getBinding(turnPlan.handlerProfile)
        ?? bindingRegistry?.getBinding(DEFAULT_ZHIN_AGENT_NAME)
        ?? bindingRegistry?.requireZhinBinding();

      const externalTools = collectInboundTurnTools({ root, ai, commMessage, cell });
      const { elements, cell: turnCell } = await executeInboundAgentTurn({
        zhinAgent,
        commMessage,
        aiContent,
        externalTools,
        mediaParts,
        handlerBinding: handlerBinding ?? null,
        refs,
        cell,
        endpointId,
        onChunk,
        logger,
      });
      cell = turnCell;

      if (cell) {
        const freshOutbound = await cellService.getSceneFresh(cell.id);
        if (freshOutbound) cell = freshOutbound;
      }
      const selfMember = cell ? findCellMemberByEndpoint(cell, endpointId) : undefined;
      const adapterView = root.inject(message.$adapter) as GroupMessageAdapterView | undefined;

      const collabResolved = await resolveOutboundBatches({
        message,
        elements,
        inboundContent: aiContent,
        cell,
        endpointId,
        adapterView: adapterView,
        selfMember,
        warn: (msg) => logger.warn(msg),
      });
      let outboundBatches: MessageElement[][] = collabResolved.batches;

      if (cell) {
        outboundBatches = sanitizeCellToolJsonInOutboundBatches(outboundBatches);
      }
      outboundBatches = applyCollaborationOutboundPostProcess(outboundBatches);

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
          await tryCompleteKernelImProjectionFromOutbound({
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
