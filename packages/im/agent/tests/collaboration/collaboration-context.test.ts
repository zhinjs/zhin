import { beforeEach, describe, expect, it } from 'vitest';
import type { Message } from '../../../core/src/message.js';
import { resolveCollaborationSceneForMessage } from '../../src/collaboration/collaboration-context.js';
import {
  getCollaborationSceneService,
  resetCollaborationSceneService,
} from '../../src/collaboration/scene-service.js';
import { MemoryCollaborationSceneRepository } from '../../src/collaboration/collaboration-scene-repository.js';

function groupMessage(endpoint: string, sceneId = '373460458'): Message {
  return {
    $adapter: 'icqq',
    $endpoint: endpoint,
    $channel: { type: 'group', id: sceneId },
    $sender: { id: 'user1' },
    $content: [],
  } as unknown as Message;
}

describe('resolveCollaborationSceneForMessage', () => {
  beforeEach(async () => {
    resetCollaborationSceneService();
    const repo = new MemoryCollaborationSceneRepository();
    await repo.upsert({
      id: 'icqq-collab-room',
      adapter: 'icqq',
      sceneId: '373460458',
      members: [
        { endpointKey: '8596238', primary: 'planner' },
        { endpointKey: '210723495', primary: 'researcher' },
      ],
    });
    const service = getCollaborationSceneService();
    service.setRepository(repo);
    await service.reloadFromRepository();
  });

  it('resolves only a configured group member', () => {
    expect(resolveCollaborationSceneForMessage(groupMessage('8596238'))?.id).toBe('icqq-collab-room');
    expect(resolveCollaborationSceneForMessage(groupMessage('unknown-bot'))).toBeUndefined();
    expect(resolveCollaborationSceneForMessage(groupMessage('8596238', 'other'))).toBeUndefined();
  });

  it('does not treat private messages as collaboration scenes', () => {
    const message = {
      ...groupMessage('8596238'),
      $channel: { type: 'private', id: 'user1' },
    } as unknown as Message;
    expect(resolveCollaborationSceneForMessage(message)).toBeUndefined();
  });
});
