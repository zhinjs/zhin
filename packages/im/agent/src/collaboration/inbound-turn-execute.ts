/**
 * 入站 turn 执行 — 委托模块化 ZhinAgent（阶段 4）。
 */
import type { AgentTurnMessage } from '@zhin.js/core';
import type { ContentPart, OutputElement } from '@zhin.js/ai';
import { formatContentChainLog, CONTENT_CHAIN_STAGE } from '@zhin.js/logger';
import type { Tool } from '../orchestrator/types.js';
import type { ResolvedAgentBinding } from '../config/types.js';
import type { AIServiceRefs } from '../init/shared-refs.js';
import {
  preprocessInboundMedia,
  resolveMultimodalConfig,
  getPrimaryAppConfig,
  INBOUND_MEDIA_PARTS_EXTRA_KEY,
} from '../media/index.js';
import { providerSupportsVision } from '../media/vision-capability.js';
import type { ZhinAgent } from '../zhin-agent/index.js';
import type { CollaborationScene } from './types.js';
import { attachCollaborationTurnSnapshot } from './collaboration-turn-snapshot.js';
import { findCellMemberByEndpoint } from './collaboration-config.js';
import { getCollaborationSceneService } from './scene-service.js';
import { stripCellToolJsonFromOutputElements } from './collaboration-delegation.js';

export interface InboundZhinAgentTurnHost extends Pick<
  ZhinAgent,
  'initInboundTurnContext' | 'configure' | 'process' | 'processMultimodal'
> {}

export interface ExecuteInboundAgentTurnInput {
  zhinAgent: InboundZhinAgentTurnHost;
  commMessage: AgentTurnMessage;
  aiContent: string;
  externalTools: Tool[];
  mediaParts: ContentPart[];
  handlerBinding: ResolvedAgentBinding | null;
  refs: AIServiceRefs;
  cell?: CollaborationScene;
  endpointId: string;
  onChunk?: (chunk: string, full: string) => void;
  logger: { warn: (...args: unknown[]) => void; info: (...args: unknown[]) => void };
}

export async function executeInboundAgentTurn(
  input: ExecuteInboundAgentTurnInput,
): Promise<{ elements: OutputElement[]; cell?: CollaborationScene }> {
  const {
    zhinAgent,
    commMessage,
    aiContent,
    externalTools,
    mediaParts,
    handlerBinding,
    refs,
    endpointId,
    onChunk,
    logger,
  } = input;
  let cell = input.cell;

  if (handlerBinding) {
    zhinAgent.configure({ activeBinding: handlerBinding });
  }

  if (cell && findCellMemberByEndpoint(cell, endpointId)) {
    const cellService = getCollaborationSceneService();
    const snapCell = (await cellService.getSceneFresh(cell.id)) ?? cell;
    attachCollaborationTurnSnapshot(commMessage, snapCell, endpointId);
    cell = snapCell;
  }

  zhinAgent.initInboundTurnContext();

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
    const fullContent = [aiContent, pre.textAppend].filter(Boolean).join('\n\n');
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

  return { elements, cell };
}
