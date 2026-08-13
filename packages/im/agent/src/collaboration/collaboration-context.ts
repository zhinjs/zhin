import { type Message, buildAiOutboundPromptHint } from '@zhin.js/core';
import type { TurnOrigin } from '../turn/turn-ingress.js';
import type { CollaborationScene } from './types.js';
import { resolveCellForScene, findCellMemberByEndpoint } from './collaboration-config.js';
/** 每轮 turn envelope 用的精简 Cell 提示（勿重复 buildAiOutboundPromptHint 长文）。 */
export function formatCollaborationTurnCellHint(
  cell: CollaborationScene,
  currentEndpointKey: string,
): string {
  const self = findCellMemberByEndpoint(cell, currentEndpointKey);
  const peers = cell.members.filter((m) => m.endpointKey !== currentEndpointKey);
  const peerBrief = peers
    .map((p) => `${p.primary}=${p.endpointKey}`)
    .join(', ');
  const lines = [
    `[Cell ${cell.id}] You: ${self?.primary ?? currentEndpointKey} (${currentEndpointKey})`,
  ];
  if (cell.goal?.trim()) lines.push(`Goal: ${cell.goal.trim()}`);
  if (peerBrief) lines.push(`Peers: ${peerBrief}`);
  lines.push('Peer dispatch uses internal_room via the orchestration kernel; IM @ is optional (im_projection / project_to_im).');
  lines.push('If the inbound message includes #taskId (im_projection), include that #taskId in your public handback.');
  return lines.join('\n');
}

export function formatCollaborationSceneHint(
  cell: CollaborationScene,
  currentEndpointKey: string,
  options?: { forceJsonOnly?: boolean },
): string {
  const self = findCellMemberByEndpoint(cell, currentEndpointKey);
  const peers = cell.members.filter((m) => m.endpointKey !== currentEndpointKey);
  const cellLines = [
    '[Collaboration cell]',
    `Cell: ${cell.id} (adapter ${cell.adapter}, scene ${cell.sceneId})`,
  ];
  if (cell.goal?.trim()) cellLines.push(`Goal: ${cell.goal.trim()}`);
  if (self) {
    cellLines.push(
      `You: endpoint ${currentEndpointKey}, agent "${self.primary}"${self.role ? ` (${self.role})` : ''}.`,
    );
  }
  if (peers.length > 0) {
    cellLines.push('Peers:');
    for (const peer of peers) {
      cellLines.push(
        `- "${peer.endpointKey}": agent "${peer.primary}"${peer.role ? ` (${peer.role})` : ''}`,
      );
    }
  }

  const lines = [
    buildAiOutboundPromptHint({
      rosterLines: cellLines,
      forceJsonOnly: options?.forceJsonOnly ?? false,
    }),
    'Peer dispatch and task handback are managed by the orchestration kernel (internal_room; IM projection is optional).',
  ];
  return lines.join('\n');
}

/** 仅当入站消息命中多 Bot 协作 Cell 时返回 Cell（私聊、非成员、单 Bot Cell 均不注入）。 */
export function resolveCollaborationSceneForMessage(
  message: Message | undefined,
): CollaborationScene | undefined {
  if (!message) return undefined;
  const scope = message.$channel?.type;
  if (scope !== 'group' && scope !== 'channel') return undefined;
  const sceneId = message.$channel?.id;
  if (!sceneId) return undefined;
  const endpointKey = String(message.$endpoint ?? '');
  if (!endpointKey) return undefined;

  return resolveCollaborationScene({
    platform: String(message.$adapter ?? ''),
    endpoint: endpointKey,
    scope,
    sceneId: String(sceneId),
  });
}

function resolveCollaborationScene(input: {
  platform: string;
  endpoint: string;
  scope: 'private' | 'group' | 'channel';
  sceneId: string;
}): CollaborationScene | undefined {
  if (input.scope !== 'group' && input.scope !== 'channel') return undefined;
  const cell = resolveCellForScene(input.platform, input.sceneId);
  if (!cell || cell.members.length < 2) return undefined;
  if (!findCellMemberByEndpoint(cell, input.endpoint)) return undefined;
  return cell;
}

/** 构建 turn envelope 用的协作提示；不满足场景时返回 undefined。 */
export function resolveCollaborationTurnHint(
  message: Message | undefined,
  _inboundContent?: string,
): string | undefined {
  const cell = resolveCollaborationSceneForMessage(message);
  if (!cell) return undefined;
  const endpointKey = String(message!.$endpoint);
  const lines = [
    formatCollaborationTurnCellHint(cell, endpointKey),
  ].filter(Boolean);
  return lines.join('\n');
}

/** Canonical Turn variant used by Agent Context; no IM Message crosses the boundary. */
export function resolveCollaborationTurnHintFromOrigin(origin: TurnOrigin): string | undefined {
  if (origin.kind !== 'im') return undefined;
  const cell = resolveCollaborationScene({
    platform: origin.platform,
    endpoint: origin.endpoint,
    scope: origin.scope,
    sceneId: origin.sceneId,
  });
  return cell ? formatCollaborationTurnCellHint(cell, origin.endpoint) : undefined;
}
