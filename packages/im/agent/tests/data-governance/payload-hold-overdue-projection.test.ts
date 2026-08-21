import { describe, expect, it } from 'vitest';
import {
  PayloadRetentionHoldOverdueProjection,
  type PayloadRetentionHoldProjectionState,
  type PayloadRetentionHoldOverdueProjectionSourcePort,
} from '../../src/data-governance/payload-hold-overdue-projection.js';
import { digestCanonicalWorkroomValue as digest } from '../../src/workroom/canonical-value.js';

describe('Payload Retention Hold overdue projection', () => {
  it('projects only content-free active Holds past their trusted Kernel review clock', async () => {
    const active = state('object:active', { holdId: 'hold:active', reviewAt: 50 });
    const released = state('object:released', { holdId: 'hold:released', reviewAt: 40, released: true });
    const source: PayloadRetentionHoldOverdueProjectionSourcePort = {
      listObjectIds: async () => ['object:released', 'object:active'],
      read: async (_projectId, objectId) => objectId === 'object:active' ? active : released,
    };
    const projection = new PayloadRetentionHoldOverdueProjection({
      source,
      clock: { read: async () => ({ version: 1, now: 100, revision: 7,
        digest: digest({ version: 1, now: 100, revision: 7 }) }) },
    });

    const snapshot = await projection.project('project-1', signal());
    expect(snapshot).toMatchObject({
      version: 1, projectId: 'project-1', clockRevision: 7,
      overdue: [{ objectId: 'object:active', holdId: 'hold:active', reviewAt: 50 }],
    });
    expect(JSON.stringify(snapshot)).not.toContain('payload body');
    const { digest: _digest, ...body } = snapshot;
    expect(snapshot.digest).toBe(digest(body));
  });

  it('fails closed when the Kernel clock authority is unavailable or drifts', async () => {
    const source: PayloadRetentionHoldOverdueProjectionSourcePort = {
      listObjectIds: async () => [], read: async () => { throw new Error('unused'); },
    };
    await expect(new PayloadRetentionHoldOverdueProjection({
      source, clock: { read: async () => undefined },
    }).project('project-1', signal())).rejects.toThrow('unavailable');
    await expect(new PayloadRetentionHoldOverdueProjection({
      source, clock: { read: async () => ({ version: 1, now: 1, revision: 1, digest: sha('forged') }) },
    }).project('project-1', signal())).rejects.toThrow('drift');
  });
});

function state(
  objectId: string,
  input: { holdId: string; reviewAt: number; released?: boolean },
): PayloadRetentionHoldProjectionState {
  const hold = {
    id: input.holdId, ownerPrincipalId: 'steward:1', reasonCode: 'legal_hold' as const,
    placedAt: 1, reviewAt: input.reviewAt,
    ...(input.released ? { release: {
      releasedBy: 'steward:2', releasedAt: 30,
    } } : {}),
  };
  return {
    projectId: 'project-1', objectId, stateDigest: sha(objectId),
    holds: { [input.holdId]: hold },
  };
}

function sha(seed: string): string { return digest({ seed }); }
function signal(): AbortSignal { return new AbortController().signal; }
