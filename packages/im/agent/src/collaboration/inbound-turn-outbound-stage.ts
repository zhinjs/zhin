/**
 * 入站出站阶段 — batch 解析、IM 发送、Kernel 投影完成（阶段 4）。
 */
import type { Plugin, Message, MessageElement } from '@zhin.js/core';
import type { OutputElement } from '@zhin.js/ai';
import { formatCompactLog } from '@zhin.js/logger';
import { findCellMemberByEndpoint } from './collaboration-config.js';
import {
  sanitizeCellToolJsonInOutboundBatches,
  batchHasAtSegment,
  isCollaborationNoOpReasoningOutbound,
} from './collaboration-outbound.js';
import { resolveOutboundBatches } from './outbound-resolver.js';
import { tryCompleteKernelImProjectionFromOutbound } from './collaboration-kernel-bridge.js';
import type { GroupMessageAdapterView } from './group-message.js';
import type { CollaborationScene } from './types.js';
import { getCollaborationSceneService } from './scene-service.js';

function applyCollaborationOutboundPostProcess(
  batches: MessageElement[][],
): MessageElement[][] {
  return batches.filter((batch) => batch.length > 0);
}

export interface ExecuteInboundOutboundStageInput {
  root: Plugin;
  message: Message;
  elements: OutputElement[];
  aiContent: string;
  cell?: CollaborationScene;
  endpointId: string;
  peerInbound: boolean;
  replyOutbound: (payload: unknown, options?: { quote?: boolean }) => Promise<unknown>;
  logger: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void };
}

/** @returns 刷新后的 cell（若有） */
export async function executeInboundOutboundStage(
  input: ExecuteInboundOutboundStageInput,
): Promise<CollaborationScene | undefined> {
  const {
    root,
    message,
    elements,
    aiContent,
    endpointId,
    peerInbound,
    replyOutbound,
    logger,
  } = input;
  let cell = input.cell;

  if (cell) {
    const freshOutbound = await getCollaborationSceneService().getSceneFresh(cell.id);
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
    adapterView,
    selfMember,
    warn: (msg) => logger.warn(msg),
    root,
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
    const batch = outboundBatches[i];
    if (!batch?.length) continue;
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

  return cell;
}
