import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createSyntheticMessage } from '@zhin.js/core';
import { applyRuntimeCollaborationInbound } from '../../src/collaboration/runtime-inbound-gate.js';
import {
  getCollaborationSceneService,
  resetCollaborationSceneService,
} from '../../src/collaboration/scene-service.js';
import { initOrchestrationService } from '../../src/orchestrator/orchestration-service.js';
import { MemoryOrchestrationRepository } from '../../src/orchestrator/orchestration-repository.js';

describe('applyRuntimeCollaborationInbound', () => {
  beforeEach(() => {
    resetCollaborationSceneService();
    initOrchestrationService(new MemoryOrchestrationRepository());
  });

  it('continues when no collaboration cell', async () => {
    const message = createSyntheticMessage({
      adapter: 'sandbox',
      endpoint: 'bot-a',
      sender: { id: 'user-1', name: 'u' },
      channel: { type: 'private', id: 'user-1' },
    });
    const result = await applyRuntimeCollaborationInbound({
      message,
      content: 'hello',
      peerMode: 'mention-only',
      replyAi: vi.fn(),
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
    });
    expect(result.action).toBe('continue');
  });

  it('skips when cell requires mention and none present', async () => {
    await getCollaborationSceneService().upsertScene({
      id: 'cell-1',
      adapter: 'sandbox',
      sceneId: 'group-1',
      enabled: true,
      members: [
        { endpointId: 'bot-a', primary: 'zhin' },
        { endpointId: 'bot-b', primary: 'zhin' },
      ],
    });
    const message = createSyntheticMessage({
      adapter: 'sandbox',
      endpoint: 'bot-a',
      sender: { id: 'human-1', name: 'h' },
      channel: { type: 'group', id: 'group-1' },
      content: [{ type: 'text', data: { text: 'hi all' } }],
    });
    const result = await applyRuntimeCollaborationInbound({
      message,
      content: 'hi all',
      peerMode: 'mention-only',
      replyAi: vi.fn(),
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
    });
    expect(result).toMatchObject({ action: 'skip', reason: 'cell_mention_required' });
  });
});
