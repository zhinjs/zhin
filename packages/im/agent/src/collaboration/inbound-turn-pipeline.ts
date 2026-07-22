/**
 * InboundTurnPipeline — Agent Orchestration Plane entry (ADR 0023).
 *
 * Stages: enrich → peerPolicy → buildTurnPlan → route/execute → outbound
 * Turn 路由/执行/出站委托 `inbound-turn-route` / `inbound-turn-outbound-stage`（阶段 4）。
 */
import { checkAIAccess, type Plugin, type Message, type AITriggerConfig } from '@zhin.js/core';
import { formatCompactLog, truncatePreview } from '@zhin.js/logger';
import type { AIServiceRefs } from '../init/shared-refs.js';
import { discoverWorkspaceAgents } from '../discovery/agents.js';
import { formatAiHandlerTurnTable, formatAiHandlerFallbackLog, formatOutputElementsPreview } from '../turn/turn-metrics.js';
import type { OutputElement } from '@zhin.js/ai';
import type { AIService } from '../service.js';
import { evaluateCellAtOwnership, evaluatePeerTrigger, isInboundFromCollaborationPeer } from './peer-policy.js';
import { buildTurnPlan } from './turn-plan-resolver.js';
import { getCollaborationSceneService } from './scene-service.js';
import { findCellForInbound } from './collaboration-config.js';
import type { PeerTriggerMode } from './types.js';
import { tryHandlePeerInboundHandback } from './inbound-peer-handback.js';
import { routeInboundTurnExecution } from './inbound-turn-route.js';
import { executeInboundOutboundStage } from './inbound-turn-outbound-stage.js';
import { resolveEndpointAtIds, resolveEndpointAiAccess } from './inbound-turn-endpoint.js';
import { prepareInboundTurnEnrichment } from './inbound-turn-enrich.js';
import { getAgentRuntimeRegistry } from './runtime-registry.js';

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

function logInboundHandlerComplete(
  logger: InboundTurnPipelineDeps['logger'],
  t0: number,
  zhinAgent: NonNullable<AIServiceRefs['zhinAgent']>,
  context: {
    path?: string;
    userInput?: string;
    output?: string;
    elements?: OutputElement[];
  } = {},
): void {
  const totalMs = performance.now() - t0;
  const turnMetrics = zhinAgent.getLastTurnMetrics();
  const output = context.output
    ?? (context.elements ? formatOutputElementsPreview(context.elements) : undefined);

  if (turnMetrics) {
    logger.info(formatAiHandlerTurnTable(turnMetrics, totalMs, {
      userInput: context.userInput,
      output,
    }));
    return;
  }
  logger.info(formatAiHandlerFallbackLog(totalMs, context.path));
}

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

    try {
      const resolveQuotes = Boolean(triggerConfig.resolveQuotedMessages && !peerInbound);
      const { commMessage, mediaParts, aiContent, onChunk } = await prepareInboundTurnEnrichment({
        root,
        message,
        content,
        cell,
        resolveQuotes,
        replyOutbound,
        logger,
        t0,
      });
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

      const routeResult = await routeInboundTurnExecution({
        root,
        ai,
        zhinAgent,
        commMessage,
        message,
        aiContent,
        turnPlan,
        cell,
        endpointId,
        refs,
        bindingRegistry: bindingRegistry ?? undefined,
        mediaParts,
        onChunk,
        replyAi,
        logger,
      });

      if (routeResult.kind === 'done') {
        logInboundHandlerComplete(logger, t0, zhinAgent, {
          path: 'routed_done',
          userInput: aiContent,
        });
        return;
      }

      cell = await executeInboundOutboundStage({
        root,
        message,
        elements: routeResult.elements,
        aiContent,
        cell: routeResult.cell,
        endpointId,
        peerInbound,
        outputSchemaRequired: Boolean(ai.getAgentConfig?.()?.outputSchema),
        replyOutbound,
        logger,
      });

      logInboundHandlerComplete(logger, t0, zhinAgent, {
        userInput: aiContent,
        elements: routeResult.elements,
      });
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
