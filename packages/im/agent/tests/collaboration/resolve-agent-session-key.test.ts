import { describe, it, expect } from 'vitest';
import {
  resolveAgentSessionKeyForTurn,
  resolveAgentTurnSessionKey,
  resolveAgentTurnSessionKeyFromAddress,
  resolveArtifactRunId,
} from '../../src/collaboration/resolve-agent-session-key.js';
import { attachCollaborationTurnSnapshot } from '../../src/collaboration/collaboration-turn-snapshot.js';
import type { CollaborationScene } from '../../src/collaboration/types.js';
import type { Message } from '@zhin.js/core';

const cell: CollaborationScene = {
  id: 'c1',
  adapter: 'icqq',
  sceneId: '373460458',
  members: [{ endpointKey: '210723495', primary: 'researcher', pipelineRole: 'researcher' }],
  pipelineState: {
    runId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    stage: 'researcher',
    reviewCycles: 0,
    maxReviewCycles: 3,
    allowedNextStages: ['evaluator'],
    todo: [],
    runHistory: [{
      runId: '11111111-2222-3333-4444-555555555555',
      stage: 'planner',
      reviewCycles: 0,
      todo: [],
      userGoal: 'old mission',
      createdAt: 1,
      archivedAt: 2,
    }],
    updatedAt: Date.now(),
  },
};

function msg(endpoint = '210723495'): Message {
  return {
    $adapter: 'icqq',
    $endpoint: endpoint,
    $channel: { type: 'group', id: '373460458' },
    $sender: { id: 'u1' },
  } as unknown as Message;
}

describe('resolveAgentTurnSessionKey', () => {
  const cellWithDelegation: CollaborationScene = {
    ...cell,
    pipelineState: {
      ...cell.pipelineState!,
      activeDelegations: [{
        targetEndpointKey: '210723495',
        targetRole: 'researcher',
        runId: 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff',
        requireArtifact: true,
        delegateText: 'research',
        updatedAt: 1,
      }],
    },
  };

  it('uses collaboration snapshot bindRun when attached', () => {
    const message = msg() as Message;
    attachCollaborationTurnSnapshot(message, cellWithDelegation, '210723495');
    const key = resolveAgentTurnSessionKey(message);
    expect(key).toMatch(/^pipeline:bbbbbbbb:/);
  });

  it('matches record and drain keys when snapshot reflects same bindRun', () => {
    const passiveMsg = msg();
    const recordKey = resolveAgentTurnSessionKey(passiveMsg, cellWithDelegation);
    const atMsg = msg() as Message;
    attachCollaborationTurnSnapshot(atMsg, cellWithDelegation, '210723495');
    const drainKey = resolveAgentTurnSessionKey(atMsg);
    expect(recordKey).toBe(drainKey);
    expect(recordKey).toMatch(/^pipeline:bbbbbbbb:/);
  });

  it('derives the same pipeline session from a canonical turn address', () => {
    const key = resolveAgentTurnSessionKeyFromAddress({
      transport: 'icqq:210723495:group:373460458',
      endpointKey: '210723495',
    }, cellWithDelegation);

    expect(key).toBe(resolveAgentTurnSessionKey(msg(), cellWithDelegation));
    expect(key).toMatch(/^pipeline:bbbbbbbb:/);
  });

  it('uses the canonical transport key when no collaboration cell exists', () => {
    expect(resolveAgentTurnSessionKeyFromAddress({
      transport: 'telegram:bot:private:user-1',
      endpointKey: 'bot',
    })).toBe('telegram:bot:private:user-1');
  });
});

describe('resolveAgentSessionKeyForTurn', () => {
  it('prefixes session key with pipeline run when cell has state', () => {
    const key = resolveAgentSessionKeyForTurn(msg(), cell);
    expect(key).toMatch(/^pipeline:aaaaaaaa:/);
    expect(key).toContain('icqq:210723495:group:373460458');
  });

  it('falls back to transport key without cell state', () => {
    expect(resolveAgentSessionKeyForTurn(msg(), undefined)).toBe('icqq:210723495:group:373460458');
  });
});

describe('resolveArtifactRunId', () => {
  it('defaults to active runId', () => {
    const r = resolveArtifactRunId(undefined, cell);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.runId).toBe(cell.pipelineState!.runId);
  });

  it('resolves historical run by prefix', () => {
    const r = resolveArtifactRunId('11111111', cell);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.runId).toBe('11111111-2222-3333-4444-555555555555');
  });
});
