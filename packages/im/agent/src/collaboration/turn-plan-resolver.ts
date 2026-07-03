/**
 * Turn plan resolution — endpoint primary, route overlay, delegation rules.
 */

import type { Message } from '@zhin.js/core';
import { resolveIMSessionIdFromMessage } from '@zhin.js/ai';
import { resolveRoutedAgentName } from '../routing/route-matcher.js';
import { DEFAULT_ZHIN_AGENT_NAME } from '../config/types.js';
import type { AgentBindingConfig } from '../config/types.js';
import { resolveCellContextKeyFromMessage } from './cell-context.js';
import {
  findCellForMessage,
  resolveCellForScene,
  resolvePrimaryForEndpoint,
} from './collaboration-config.js';
import type { CollaborationCell } from './types.js';
import type { TurnPlan } from './types.js';

export interface TurnPlanResolverInput {
  message: Message;
  contentText: string;
  endpointId: string;
  cells: CollaborationCell[];
  agents: Record<string, AgentBindingConfig>;
  discoveredAgentNames: Set<string>;
}

function findEndpointIdForAgent(cell: CollaborationCell, agentName: string): string | undefined {
  return cell.members.find((m) => m.primary === agentName)?.endpointId;
}

export function buildTurnPlan(input: TurnPlanResolverInput): TurnPlan {
  const { message, contentText, endpointId, cells, agents, discoveredAgentNames } = input;
  const scope = message.$channel?.type || 'private';
  const sceneId = message.$channel?.id ?? '';
  const adapter = String(message.$adapter || '');

  const cell =
    (scope === 'group' || scope === 'channel') && sceneId
      ? (resolveCellForScene(adapter, sceneId, endpointId) ?? findCellForMessage(cells, adapter, sceneId))
      : undefined;

  const primary = resolvePrimaryForEndpoint(cell, endpointId, DEFAULT_ZHIN_AGENT_NAME);

  const routedAgent = resolveRoutedAgentName(agents, {
    message,
    contentText,
    discoveredAgentNames,
  });

  const handlerProfile =
    routedAgent !== DEFAULT_ZHIN_AGENT_NAME ? routedAgent : primary;

  const transport = resolveIMSessionIdFromMessage(message);
  const cellKey = resolveCellContextKeyFromMessage(message);

  const plan: TurnPlan = {
    inboundEndpointId: endpointId,
    handlerProfile,
    outboundEndpointId: endpointId,
    cellId: cell?.id,
    sessionKeys: {
      transport,
      cell: cellKey,
    },
    delegation: { mode: 'local_process' },
  };

  const handlerEndpointId = cell ? findEndpointIdForAgent(cell, handlerProfile) : undefined;
  const isOwnEndpointHandler =
    !handlerEndpointId || handlerEndpointId === endpointId;
  const isRouteOverlay =
    routedAgent !== DEFAULT_ZHIN_AGENT_NAME && routedAgent !== primary;

  if (isOwnEndpointHandler) {
    if (isRouteOverlay) {
      plan.delegation = { mode: 'spawn_task', targetAgentId: handlerProfile };
    }
    return plan;
  }

  if (handlerEndpointId) {
    plan.delegation = {
      mode: 'im_mention',
      targetEndpointId: handlerEndpointId,
      targetAgentId: handlerProfile,
    };
    return plan;
  }

  if (handlerProfile !== DEFAULT_ZHIN_AGENT_NAME) {
    plan.delegation = { mode: 'spawn_task', targetAgentId: handlerProfile };
  }
  return plan;
}
