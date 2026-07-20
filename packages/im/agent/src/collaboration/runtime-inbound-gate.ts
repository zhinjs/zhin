/**
 * Plugin Runtime collaboration inbound gate (no host Plugin / ALS).
 * Peer/at ownership + handback + peer dispatch; local turns stay with Agent Host.
 */
import type { Message } from '@zhin.js/core';
import { formatCompactLog } from '@zhin.js/logger';
import { findCellForInbound } from './collaboration-config.js';
import { evaluateCellAtOwnership, evaluatePeerTrigger, isInboundFromCollaborationPeer } from './peer-policy.js';
import { tryHandlePeerInboundHandback } from './inbound-peer-handback.js';
import { buildTurnPlan } from './turn-plan-resolver.js';
import { dispatchPeerTask } from './collaboration-dispatch.js';
import { getCollaborationSceneService } from './scene-service.js';
import type { CollaborationScene, PeerTriggerMode, TurnPlan } from './types.js';
import type { AgentBindingConfig } from '../config/types.js';

export type RuntimeCollaborationInboundResult =
  | { action: 'skip'; reason: string }
  | { action: 'done'; reason: string }
  | { action: 'continue'; cell?: CollaborationScene; turnPlan: TurnPlan };

export interface RuntimeCollaborationInboundInput {
  message: Message;
  content: string;
  peerMode: PeerTriggerMode;
  /** Platform @ ids for this endpoint (optional; empty = text/@ segment only). */
  endpointAtIds?: string[];
  discoveredAgentNames?: Set<string>;
  agents?: Record<string, AgentBindingConfig>;
  replyAi: (payload: unknown) => Promise<unknown>;
  logger: {
    debug: (...args: unknown[]) => void;
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
  };
}

export async function applyRuntimeCollaborationInbound(
  input: RuntimeCollaborationInboundInput,
): Promise<RuntimeCollaborationInboundResult> {
  const {
    message,
    content,
    peerMode,
    endpointAtIds = [],
    discoveredAgentNames = new Set(),
    agents = {},
    replyAi,
    logger,
  } = input;

  const endpointId = String(message.$endpoint ?? '');
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
  });
  if (peerResult.isPeer && !peerResult.shouldTrigger) {
    logger.debug(formatCompactLog('AI Handler', {
      skip: 'peer_mention_required',
      peer: peerResult.peerEndpointId,
      reason: peerResult.reason,
      path: 'runtime',
    }));
    return { action: 'skip', reason: peerResult.reason ?? 'peer_mention_required' };
  }

  const atOwnership = evaluateCellAtOwnership(message, cell, endpointId);
  if (!atOwnership.shouldHandle) {
    logger.debug(formatCompactLog('AI Handler', {
      skip: atOwnership.reason ?? 'cell_at_filter',
      mentioned: atOwnership.mentionedEndpointIds?.join(','),
      endpoint: endpointId,
      path: 'runtime',
    }));
    return { action: 'skip', reason: atOwnership.reason ?? 'cell_at_filter' };
  }

  const peerInbound = isInboundFromCollaborationPeer(message, cell);
  if (peerInbound && cell && peerResult.peerEndpointId) {
    const handbackDone = await tryHandlePeerInboundHandback({
      message,
      cell,
      peerEndpointId: peerResult.peerEndpointId,
      replyAi,
      logger,
    });
    if (handbackDone) {
      return { action: 'done', reason: 'peer_handback' };
    }
  }

  const turnPlan = buildTurnPlan({
    message,
    contentText: content,
    endpointId,
    endpointIds: endpointAtIds,
    cells: cellService.listScenes(),
    agents,
    discoveredAgentNames,
  });

  const peerTarget = turnPlan.delegation?.delegateToPeer ?? turnPlan.delegation?.targetEndpointId;
  if (peerTarget && peerTarget !== endpointId && cell) {
    const delegateText = content.trim() || '请处理上述协作请求。';
    try {
      const dispatched = await dispatchPeerTask({
        cell,
        fromEndpointId: endpointId,
        toEndpointId: peerTarget,
        goal: delegateText,
        handlerProfile: turnPlan.handlerProfile,
        message,
      });
      if (
        dispatched.task.status === 'completed'
        || dispatched.task.status === 'waiting_result'
        || dispatched.task.status === 'running'
      ) {
        logger.info(formatCompactLog('AI Handler', {
          path: 'runtime_kernel_internal_room',
          run: dispatched.runId,
          task: dispatched.taskId,
          from: endpointId,
          to: peerTarget,
          agent: turnPlan.handlerProfile,
        }));
        return { action: 'done', reason: 'peer_dispatch' };
      }
      logger.warn(formatCompactLog('AI Handler', {
        path: 'runtime_kernel_internal_room_failed',
        task: dispatched.taskId,
        error: dispatched.task.error,
        fallback: 'local_process',
      }));
    } catch (err) {
      logger.warn(formatCompactLog('AI Handler', {
        path: 'runtime_kernel_internal_room_failed',
        error: err instanceof Error ? err.message : String(err),
        fallback: 'local_process',
      }));
    }
  }

  return { action: 'continue', cell, turnPlan };
}
