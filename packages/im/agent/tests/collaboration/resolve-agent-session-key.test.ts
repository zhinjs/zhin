import { describe, it, expect } from 'vitest';
import {
  resolveAgentSessionKeyForTurn,
  resolveArtifactRunId,
} from '../../src/collaboration/resolve-agent-session-key.js';
import type { CollaborationCell } from '../../src/collaboration/types.js';
import type { Message } from '@zhin.js/core';

const cell: CollaborationCell = {
  id: 'c1',
  adapter: 'icqq',
  sceneId: '373460458',
  members: [{ endpointId: '210723495', primary: 'researcher', pipelineRole: 'researcher' }],
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
