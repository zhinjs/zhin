import { sceneRefFromMessage, type Message } from '@zhin.js/core';
import type { OrchestrationRunSource, OrchestrationSceneRef } from '@zhin.js/ai';

/** Project an authenticated IM turn into the origin-neutral orchestration source contract. */
export function orchestrationSourceFromMessage(message: Message): OrchestrationRunSource {
  const scene = sceneRefFromMessage(message);
  if (!scene) return { kind: 'manual', label: 'orchestration' };
  const projected: OrchestrationSceneRef = {
    platform: scene.platform,
    endpointKey: scene.endpointKey,
    sceneId: scene.sceneId,
    kind: scene.kind,
    ...(scene.senderId ? { senderId: scene.senderId } : {}),
    ...(scene.parent ? {
      parent: {
        kind: scene.parent.kind === 'guild' ? 'channel' as const : scene.parent.kind,
        sceneId: scene.parent.sceneId,
      },
    } : {}),
  };
  return { kind: 'im_scene', scene: projected };
}
