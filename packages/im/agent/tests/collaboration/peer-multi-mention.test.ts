import { describe, it, expect } from 'vitest';
import { evaluateCellAtOwnership } from '../../src/collaboration/peer-policy.js';
import type { CollaborationScene } from '../../src/collaboration/types.js';

const cell: CollaborationScene = {
  id: 'room',
  adapter: 'sandbox',
  sceneId: 'group-1',
  members: [
    { endpointId: 'planner-bot', primary: 'planner', pipelineRole: 'planner' },
    { endpointId: 'researcher-bot', primary: 'researcher', pipelineRole: 'researcher' },
    { endpointId: 'evaluator-bot', primary: 'evaluator', pipelineRole: 'evaluator' },
  ],
};

const fakeRoot = {
  inject: () => ({
    endpoints: new Map<string, { $platformUserId?: string }>([
      ['planner-bot', { $platformUserId: 'bot-planner' }],
      ['researcher-bot', { $platformUserId: 'bot-researcher' }],
      ['evaluator-bot', { $platformUserId: 'bot-evaluator' }],
    ]),
  }),
} as unknown as import('@zhin.js/core').Plugin;

describe('evaluateCellAtOwnership peer multi-mention', () => {
  it('allows only first mentioned peer when bot @all', () => {
    const msg = {
      $adapter: 'sandbox',
      $endpoint: 'evaluator-bot',
      $channel: { type: 'group', id: 'group-1' },
      $sender: { id: 'bot-planner' },
      $content: [
        { type: 'at', data: { qq: 'researcher-bot' } },
        { type: 'at', data: { qq: 'evaluator-bot' } },
        { type: 'text', data: { text: ' 请发言' } },
      ],
    } as import('@zhin.js/core').Message;

    const researcher = evaluateCellAtOwnership(msg, cell, 'researcher-bot', fakeRoot);
    expect(researcher.shouldHandle).toBe(true);

    const evaluator = evaluateCellAtOwnership(msg, cell, 'evaluator-bot', fakeRoot);
    expect(evaluator.shouldHandle).toBe(false);
    expect(evaluator.reason).toBe('peer_multi_mention_first_only');
  });

  it('still allows human to @ multiple peers', () => {
    const msg = {
      $adapter: 'sandbox',
      $endpoint: 'evaluator-bot',
      $channel: { type: 'group', id: 'group-1' },
      $sender: { id: 'human-user' },
      $content: [
        { type: 'at', data: { qq: 'researcher-bot' } },
        { type: 'at', data: { qq: 'evaluator-bot' } },
      ],
    } as import('@zhin.js/core').Message;

    expect(evaluateCellAtOwnership(msg, cell, 'researcher-bot', fakeRoot).shouldHandle).toBe(true);
    expect(evaluateCellAtOwnership(msg, cell, 'evaluator-bot', fakeRoot).shouldHandle).toBe(true);
  });
});
