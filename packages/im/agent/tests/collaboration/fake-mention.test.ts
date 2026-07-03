import { describe, it, expect } from 'vitest';
import { evaluateCellAtOwnership } from '../../src/collaboration/peer-policy.js';
import { stripCellPeerMentionsFromSegments } from '../../src/collaboration/collaboration-outbound.js';
import type { CollaborationScene } from '../../src/collaboration/types.js';

const cell: CollaborationScene = {
  id: 'room',
  adapter: 'icqq',
  sceneId: '373460458',
  members: [
    { endpointId: '8596238', primary: 'planner', pipelineRole: 'planner' },
    { endpointId: '210723495', primary: 'researcher', pipelineRole: 'researcher' },
  ],
};

const fakeRoot = {
  inject: () => ({
    endpoints: new Map([
      ['8596238', { $platformUserId: '8596238' }],
      ['210723495', { $platformUserId: '210723495' }],
    ]),
  }),
} as unknown as import('@zhin.js/core').Plugin;

describe('fake @ in bot plain text', () => {
  it('does not trigger peer from planner fake @ in text only', () => {
    const msg = {
      $adapter: 'icqq',
      $endpoint: '210723495',
      $channel: { type: 'group', id: '373460458' },
      $sender: { id: '8596238' },
      $content: [
        {
          type: 'text',
          data: { text: ' @210723495 你好，请介绍一下你自己。' },
        },
      ],
    } as import('@zhin.js/core').Message;

    const result = evaluateCellAtOwnership(msg, cell, '210723495', fakeRoot);
    expect(result.shouldHandle).toBe(false);
    expect(result.reason).toBe('cell_mention_required');
  });

  it('still triggers peer from planner real at segment', () => {
    const msg = {
      $adapter: 'icqq',
      $endpoint: '210723495',
      $channel: { type: 'group', id: '373460458' },
      $sender: { id: '8596238' },
      $content: [
        { type: 'at', data: { qq: '210723495' } },
        { type: 'text', data: { text: ' 请发言。' } },
      ],
    } as import('@zhin.js/core').Message;

    const result = evaluateCellAtOwnership(msg, cell, '210723495', fakeRoot);
    expect(result.shouldHandle).toBe(true);
  });
});

describe('stripCellPeerMentionsFromSegments', () => {
  const adapter = {
    endpoints: new Map([
      ['8596238', { $platformUserId: '8596238' }],
      ['210723495', { $platformUserId: '210723495' }],
    ]),
  };

  it('removes fake @ text and at segments targeting peers', () => {
    const segments = stripCellPeerMentionsFromSegments(
      [
        { type: 'at', data: { id: '210723495', qq: '210723495' } },
        { type: 'text', data: { text: ' @210723495 你好，Researcher！' } },
      ],
      cell,
      '8596238',
      adapter,
    );
    expect(segments).toEqual([
      { type: 'text', data: { text: ' 你好，Researcher！' } },
    ]);
  });
});
