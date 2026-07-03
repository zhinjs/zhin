import { describe, it, expect, beforeEach } from 'vitest';
import { evaluatePeerTrigger, evaluateCellAtOwnership, isInboundFromCollaborationPeer } from '../../src/collaboration/peer-policy.js';
import type { CollaborationCell } from '../../src/collaboration/types.js';

const cell: CollaborationCell = {
  id: 'room-alpha',
  adapter: 'sandbox',
  sceneId: 'group-1',
  members: [
    { endpointId: 'planner-bot', primary: 'planner', pipelineRole: 'planner' },
    { endpointId: 'researcher-bot', primary: 'researcher', pipelineRole: 'researcher' },
  ],
};

// Endpoint 反查 stub：senderId(bot-planner) → endpoint(planner-bot)（ADR 0024 D5）
const fakeRoot = {
  inject: (_adapter: string) => ({
    endpoints: new Map<string, { $platformUserId?: string }>([
      ['planner-bot', { $platformUserId: 'bot-planner' }],
      ['researcher-bot', { $platformUserId: 'bot-researcher' }],
    ]),
  }),
} as unknown as import('@zhin.js/core').Plugin;

function mockMessage(overrides: Record<string, unknown> = {}) {
  return {
    $adapter: 'sandbox',
    $endpoint: 'researcher-bot',
    $channel: { type: 'group', id: 'group-1' },
    $sender: { id: 'bot-planner' },
    $content: [{ type: 'text', data: { text: 'hello' } }],
    ...overrides,
  } as import('@zhin.js/core').Message;
}

describe('evaluatePeerTrigger', () => {
  it('allows non-peer messages', () => {
    const result = evaluatePeerTrigger({
      message: mockMessage({ $sender: { id: 'human-user' } }),
      cell,
      peerMode: 'mention-only',
      endpointAtIds: ['researcher-bot'],
      root: fakeRoot,
    });
    expect(result.isPeer).toBe(false);
    expect(result.shouldTrigger).toBe(true);
  });

  it('blocks peer without mention in mention-only mode', () => {
    const result = evaluatePeerTrigger({
      message: mockMessage(),
      cell,
      peerMode: 'mention-only',
      endpointAtIds: ['researcher-bot'],
      root: fakeRoot,
    });
    expect(result.isPeer).toBe(true);
    expect(result.shouldTrigger).toBe(false);
    expect(result.reason).toBe('peer_mention_required');
  });

  it('allows peer when @ endpoint', () => {
    const result = evaluatePeerTrigger({
      message: mockMessage({
        $elements: [{ type: 'at', data: { qq: 'researcher-bot' } }],
        $content: [
          { type: 'at', data: { qq: 'researcher-bot' } },
          { type: 'text', data: { text: ' 请调研' } },
        ],
      }),
      cell,
      peerMode: 'mention-only',
      endpointAtIds: ['researcher-bot'],
      root: fakeRoot,
    });
    expect(result.isPeer).toBe(true);
    expect(result.shouldTrigger).toBe(true);
  });

  it('peerMode off treats peer like normal', () => {
    const result = evaluatePeerTrigger({
      message: mockMessage(),
      cell,
      peerMode: 'off',
      endpointAtIds: ['researcher-bot'],
      root: fakeRoot,
    });
    expect(result.isPeer).toBe(true);
    expect(result.shouldTrigger).toBe(true);
  });
});

describe('isInboundFromCollaborationPeer', () => {
  it('detects peer bot sender in cell via endpoint reverse-lookup', () => {
    expect(isInboundFromCollaborationPeer(mockMessage(), cell, fakeRoot)).toBe(true);
    expect(isInboundFromCollaborationPeer(mockMessage({ $sender: { id: 'human-user' } }), cell, fakeRoot)).toBe(false);
    expect(isInboundFromCollaborationPeer(mockMessage(), undefined, fakeRoot)).toBe(false);
  });
});

describe('evaluateCellAtOwnership', () => {
  it('all @mentioned cell members handle multi-at message', () => {
    const message = {
      $content: [
        { type: 'at', data: { qq: 'planner-bot' } },
        { type: 'text', data: { text: ' 规划' } },
        { type: 'at', data: { qq: 'researcher-bot' } },
        { type: 'text', data: { text: ' 执行' } },
      ],
    } as import('@zhin.js/core').Message;

    expect(evaluateCellAtOwnership(message, cell, 'planner-bot').shouldHandle).toBe(true);
    expect(evaluateCellAtOwnership(message, cell, 'researcher-bot').shouldHandle).toBe(true);
  });

  it('skips cell members not @mentioned', () => {
    const message = {
      $content: [
        { type: 'at', data: { qq: 'planner-bot' } },
        { type: 'text', data: { text: ' 规划' } },
      ],
    } as import('@zhin.js/core').Message;

    expect(evaluateCellAtOwnership(message, cell, 'planner-bot').shouldHandle).toBe(true);
    expect(evaluateCellAtOwnership(message, cell, 'researcher-bot').shouldHandle).toBe(false);
    expect(evaluateCellAtOwnership(message, cell, 'researcher-bot').reason).toBe('cell_not_mentioned');
  });

  it('skips all members when message has no @ in cell', () => {
    const message = {
      $content: [{ type: 'text', data: { text: 'hello everyone' } }],
    } as import('@zhin.js/core').Message;

    expect(evaluateCellAtOwnership(message, cell, 'planner-bot').shouldHandle).toBe(false);
    expect(evaluateCellAtOwnership(message, cell, 'researcher-bot').shouldHandle).toBe(false);
    expect(evaluateCellAtOwnership(message, cell, 'planner-bot').reason).toBe('cell_mention_required');
  });

  it('allows any endpoint when not in a cell', () => {
    const message = {
      $content: [{ type: 'text', data: { text: 'hello' } }],
    } as import('@zhin.js/core').Message;

    expect(evaluateCellAtOwnership(message, undefined, 'planner-bot').shouldHandle).toBe(true);
  });

  // Legacy pipelineState.activeDelegations / pendingDelegateTarget ownership
  // gate removed (ADR 0027 — kernel owns delegation state). Ownership is now
  // purely mention-based; delegation tracking lives in kernel group_mention tasks.
});
