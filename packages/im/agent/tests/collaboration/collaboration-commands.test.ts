import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Message } from '@zhin.js/core';
import {
  defaultCellId,
  handleCollabBind,
  handleCollabBindPrompt,
  handleCollabStatus,
  handleCollabUnbind,
} from '../../src/collaboration/collaboration-commands.js';
import {
  getCollaborationSceneService,
  resetCollaborationSceneService,
} from '../../src/collaboration/scene-service.js';
import { MemoryCollaborationSceneRepository } from '../../src/collaboration/collaboration-scene-repository.js';

vi.mock('../../src/collaboration/bootstrap-agent-runtimes.js', () => ({
  rebootstrapEndpointRuntimes: vi.fn(async () => {}),
}));

function groupMessage(
  sceneId = '373460458',
  endpoint = '8596238',
  content: Message['$content'] = [],
): Message {
  return {
    $adapter: 'icqq',
    $endpoint: endpoint,
    $channel: { type: 'group', id: sceneId },
    $sender: { id: '1659488338', isMaster: true },
    $content: content,
  } as Message;
}

async function seedEmptyCell(sceneId = '373460458') {
  await getCollaborationSceneService().upsertScene({
    id: defaultCellId('icqq', sceneId),
    adapter: 'icqq',
    sceneId,
    goal: '测试',
    members: [],
  });
}

describe('collaboration /collab commands', () => {
  beforeEach(async () => {
    resetCollaborationSceneService();
    const repo = new MemoryCollaborationSceneRepository();
    getCollaborationSceneService().setRepository(repo);
    await getCollaborationSceneService().reloadFromRepository();
  });

  afterEach(() => {
    resetCollaborationSceneService();
    vi.clearAllMocks();
  });

  it('status is silent on non-mentioned bot in multi-bot group', async () => {
    const out = await handleCollabStatus(groupMessage());
    expect(out).toBe('');
  });

  it('bind/unbind returns empty when adapter access is unavailable', async () => {
    await seedEmptyCell();
    const bindOut = await handleCollabBind(groupMessage('373460458', '8596238'), '1689919782', 'evaluator');
    expect(bindOut).toBe('');
    const unbindOut = await handleCollabUnbind(groupMessage('373460458', '8596238'), 'evaluator');
    expect(unbindOut).toBe('');
  });

  it('bind prompt is silent on non-mentioned bot in multi-bot group', async () => {
    await seedEmptyCell();
    const out = await handleCollabBindPrompt(groupMessage('373460458', '210723495'));
    expect(out).toBe('');
  });
});
