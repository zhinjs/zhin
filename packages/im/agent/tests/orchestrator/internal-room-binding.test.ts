import { describe, expect, it } from 'vitest';
import type { AIService } from '../../src/service.js';
import type { CollaborationScene } from '../../src/collaboration/types.js';
import { resolveInternalRoomBinding } from '../../src/orchestrator/bootstrap-executors.js';

describe('internal_room binding resolution', () => {
  it('resolves the member pipeline role instead of treating endpoint identity as an agent name', () => {
    const cell = {
      id: 'research-cell',
      adapter: 'icqq',
      sceneId: 'group-1',
      members: [{
        endpointKey: 'bot-10002',
        primary: 'research-primary',
        pipelineRole: 'researcher',
      }],
    } as CollaborationScene;
    const aiService = {
      getRoutingConfig: () => ({
        agents: {
          zhin: { provider: 'openai', model: 'gpt-main' },
          researcher: { provider: 'anthropic', model: 'claude-research' },
        },
      }),
    } as unknown as AIService;

    expect(resolveInternalRoomBinding(aiService, cell, 'bot-10002')).toMatchObject({
      name: 'researcher',
      providerAlias: 'anthropic',
      model: 'claude-research',
    });
  });

  it('fails closed when the endpoint is not a member of the cell', () => {
    const cell = {
      id: 'research-cell',
      adapter: 'icqq',
      sceneId: 'group-1',
      members: [],
    } as unknown as CollaborationScene;

    expect(() => resolveInternalRoomBinding({} as AIService, cell, 'unknown'))
      .toThrow('is not a member');
  });
});
