import type { Message } from '@zhin.js/core';
import type { CollaborationScene } from './types.js';
import { resolveCellForScene, findCellMemberByEndpoint } from './collaboration-config.js';

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
