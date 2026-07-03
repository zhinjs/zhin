import { describe, it, expect } from 'vitest';
import { buildTurnPlan } from '../../src/collaboration/turn-plan-resolver.js';
import { DEFAULT_ZHIN_AGENT_NAME } from '../../src/config/types.js';
import type { CollaborationCell } from '../../src/collaboration/types.js';

const cell: CollaborationCell = {
  id: 'room-alpha',
  adapter: 'sandbox',
  sceneId: 'group-1',
  members: [
    { endpointId: 'planner-bot', primary: 'planner' },
    { endpointId: 'researcher-bot', primary: 'researcher' },
  ],
};

function mockMessage(endpoint = 'planner-bot') {
  return {
    $adapter: 'sandbox',
    $endpoint: endpoint,
    $channel: { type: 'group', id: 'group-1' },
    $sender: { id: 'user-1' },
    $content: [{ type: 'text', data: { text: 'hi' } }],
  } as import('@zhin.js/core').Message;
}

describe('buildTurnPlan', () => {
  it('uses endpoint primary from cell', () => {
    const plan = buildTurnPlan({
      message: mockMessage('researcher-bot'),
      contentText: 'hi',
      endpointId: 'researcher-bot',
      cells: [cell],
      agents: { zhin: { provider: 'mock', model: 'm' } },
      discoveredAgentNames: new Set(['zhin']),
    });
    expect(plan.handlerProfile).toBe('researcher');
    expect(plan.cellId).toBe('room-alpha');
    expect(plan.sessionKeys.cell).toBe('cell:sandbox:group-1');
    expect(plan.delegation?.mode).toBe('local_process');
  });

  it('defaults to zhin without cell', () => {
    const plan = buildTurnPlan({
      message: mockMessage(),
      contentText: 'hi',
      endpointId: 'planner-bot',
      cells: [],
      agents: { zhin: { provider: 'mock', model: 'm' } },
      discoveredAgentNames: new Set(['zhin']),
    });
    expect(plan.handlerProfile).toBe(DEFAULT_ZHIN_AGENT_NAME);
    expect(plan.cellId).toBeUndefined();
  });

  it('prefers im_mention when routed agent maps to peer endpoint', () => {
    const plan = buildTurnPlan({
      message: {
        ...mockMessage('planner-bot'),
        $content: [{ type: 'image', data: { url: 'http://x/img.png' } }],
      },
      contentText: '',
      endpointId: 'planner-bot',
      cells: [cell],
      agents: {
        zhin: { provider: 'mock', model: 'm' },
        researcher: {
          provider: 'mock',
          model: 'm',
          priority: 10,
          match: { hasMedia: ['image'] },
        },
      },
      discoveredAgentNames: new Set(['zhin', 'researcher']),
    });
    expect(plan.handlerProfile).toBe('researcher');
    expect(plan.delegation?.mode).toBe('im_mention');
    expect(plan.delegation?.targetEndpointId).toBe('researcher-bot');
  });

  it('uses spawn_task path when no peer endpoint', () => {
    const plan = buildTurnPlan({
      message: {
        ...mockMessage(),
        $content: [{ type: 'image', data: { url: 'http://x/img.png' } }],
      },
      contentText: '',
      endpointId: 'solo-bot',
      cells: [],
      agents: {
        zhin: { provider: 'mock', model: 'm' },
        vision: {
          provider: 'mock',
          model: 'm',
          priority: 10,
          match: { hasMedia: ['image'] },
        },
      },
      discoveredAgentNames: new Set(['zhin', 'vision']),
    });
    expect(plan.handlerProfile).toBe('vision');
    expect(plan.delegation?.mode).toBe('spawn_task');
  });
});
