/**
 * Plugin Runtime collaboration inbound gate (no host Plugin / ALS).
 * Peer/at ownership + handback + peer dispatch; local turns stay with Agent Host.
 */
import type { Message } from '@zhin.js/core';
import { formatCompact } from '@zhin.js/logger';
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

  const endpointKey = String(message.$endpoint ?? '');
  const cellService = getCollaborationSceneService();
  const scope = message.$channel?.type || 'private';
  const sceneId = message.$channel?.id ?? '';
  let cell =
    (scope === 'group' || scope === 'channel') && sceneId !== ''
      ? findCellForInbound(
        cellService.listScenes(),
        String(message.$adapter),
        String(sceneId),
        endpointKey,
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
    logger.debug(formatCompact({
      op: 'skip_peer',
      peer: peerResult.peerEndpointKey,
      reason: peerResult.reason,
    }));
    return { action: 'skip', reason: peerResult.reason ?? 'peer_mention_required' };
  }

  const atOwnership = evaluateCellAtOwnership(message, cell, endpointKey);
  if (!atOwnership.shouldHandle) {
    logger.debug(formatCompact({
      op: 'skip_at_filter',
      reason: atOwnership.reason,
      endpoint: endpointKey,
    }));
    return { action: 'skip', reason: atOwnership.reason ?? 'cell_at_filter' };
  }

  const peerInbound = isInboundFromCollaborationPeer(message, cell);
  if (peerInbound && cell && peerResult.peerEndpointKey) {
    const handbackDone = await tryHandlePeerInboundHandback({
      message,
      cell,
      peerEndpointKey: peerResult.peerEndpointKey,
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
    endpointKey,
    endpointKeys: endpointAtIds,
    cells: cellService.listScenes(),
    agents,
    discoveredAgentNames,
  });

  const peerTarget = turnPlan.delegation?.delegateToPeer ?? turnPlan.delegation?.targetEndpointKey;
  if (peerTarget && peerTarget !== endpointKey && cell) {
    const delegateText = content.trim() || '请处理上述协作请求。';
    try {
      const dispatched = await dispatchPeerTask({
        cell,
        fromEndpointKey: endpointKey,
        toEndpointKey: peerTarget,
        goal: delegateText,
        handlerProfile: turnPlan.handlerProfile,
        message,
      });
      if (
        dispatched.task.status === 'completed'
        || dispatched.task.status === 'waiting_result'
        || dispatched.task.status === 'running'
      ) {
        logger.info(formatCompact({
          op: 'peer_dispatch',
          task: dispatched.taskId,
          from: endpointKey,
          to: peerTarget,
        }));
        return { action: 'done', reason: 'peer_dispatch' };
      }
      logger.warn(formatCompact({
        op: 'peer_dispatch_failed',
        task: dispatched.taskId,
        error: dispatched.task.error,
      }));
    } catch (err) {
      logger.warn(formatCompact({
        op: 'peer_dispatch_failed',
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }

  return { action: 'continue', cell, turnPlan };
}
