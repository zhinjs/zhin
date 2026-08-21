import { describe, expect, it, vi } from 'vitest';
import {
  GenerationOwnedWorkroomSchedulerAssignmentRouteRegistry,
} from '../../src/plugin-runtime/workroom-scheduler-route-registry.js';
import {
  createWorkroomSchedulerPolicySnapshot,
  decideWorkroomSchedule,
} from '../../src/workroom/workroom-scheduler.js';
import type { WorkroomEvent } from '../../src/workroom/kernel-contracts.js';

describe('generation-owned Workroom Scheduler Assignment route registry', () => {
  it('returns the only route proven by the pinned Profile, Catalog, Task role, and generation', async () => {
    const signal = new AbortController().signal;
    const registry = new GenerationOwnedWorkroomSchedulerAssignmentRouteRegistry({
      generation: 7,
      signal,
      profiles: pinnedProfiles(),
    });
    const dispose = registry.register({
      providerId: 'local-agent-bindings',
      generation: 7,
      resolve: vi.fn(async () => ({
        kind: 'local' as const,
        agentDefinitionId: 'developer',
        authorityRef: 'local-binding:generation:7:developer',
      })),
    });

    await expect(registry.resolve({ decision: decision(), catalog: catalog() }))
      .resolves.toEqual({
        kind: 'local',
        agentDefinitionId: 'developer',
        authorityRef: 'local-binding:generation:7:developer',
      });

    dispose();
    await expect(registry.resolve({ decision: decision(), catalog: catalog() }))
      .resolves.toBeNull();
  });

  it('fails closed when local and remote providers both claim the exact Task route', async () => {
    const registry = new GenerationOwnedWorkroomSchedulerAssignmentRouteRegistry({
      generation: 7,
      signal: new AbortController().signal,
      profiles: pinnedProfiles(),
    });
    registry.register({
      providerId: 'local-agent-bindings', generation: 7,
      resolve: async () => ({
        kind: 'local', agentDefinitionId: 'developer', authorityRef: 'local:7',
      }),
    });
    registry.register({
      providerId: 'remote-a2a-bindings', generation: 7,
      resolve: async () => ({
        kind: 'remote', agentDefinitionId: 'developer', endpointId: 'remote-1',
        authorityRef: 'remote:7',
      }),
    });

    await expect(registry.resolve({ decision: decision(), catalog: catalog() }))
      .resolves.toBeNull();
  });

  it('rejects stale-generation and non-Profile route producers', async () => {
    const registry = new GenerationOwnedWorkroomSchedulerAssignmentRouteRegistry({
      generation: 7,
      signal: new AbortController().signal,
      profiles: pinnedProfiles(),
    });
    expect(() => registry.register({
      providerId: 'stale', generation: 6, resolve: async () => null,
    })).toThrow('generation');
    registry.register({
      providerId: 'forged-agent', generation: 7,
      resolve: async () => ({
        kind: 'local', agentDefinitionId: 'reviewer', authorityRef: 'local:7',
      }),
    });

    await expect(registry.resolve({ decision: decision(), catalog: catalog() }))
      .resolves.toBeNull();
  });
});

function pinnedProfiles() {
  return {
    read: async () => ({
      projectId: 'project-1',
      registryRevision: 3,
      runPins: {
        'run-1': {
          projectId: 'project-1', runId: 'run-1', profileRevisionId: 'profile-1',
          profileDigest: sha('a'), activationRegistryRevision: 2, pinnedAtRegistryRevision: 3,
        },
      },
      revisions: {
        'profile-1': {
          id: 'profile-1', projectId: 'project-1', compiledDigest: sha('a'),
          compiledProfile: {
            revisionId: 'profile-1', projectId: 'project-1', digest: sha('a'),
            agents: [{
              id: 'developer', digest: sha('b'), role: 'executor',
              allowedTools: [], allowedSkills: [],
            }],
          },
        },
      },
    }) as never,
  };
}

function catalog() {
  return {
    revision: sha('c'),
    definitions: {
      'project-1': {
        enabled: true,
        members: [
          { role: 'executor', agent: 'developer' },
          { role: 'reviewer', agent: 'reviewer' },
        ],
      },
    },
  } as never;
}

function decision() {
  return decideWorkroomSchedule(readyJournal())!;
}

function readyJournal(): readonly WorkroomEvent[] {
  const policy = createWorkroomSchedulerPolicySnapshot({
    policyRef: 'scheduler://1', revision: 1, pinnedAtSequence: 1, capacity: 1,
    agingStepMs: 100, starvationBoundMs: { urgent: 100, high: 200, normal: 300, low: 400 },
    preemptionDeadlineMs: 50,
  });
  return [
    event(0, 'run.created', { projectId: 'project-1', title: 'Run' }),
    event(1, 'plan.admitted', { schedulerPolicy: policy }),
    event(2, 'task.planned', {
      taskKey: 'build', title: 'Build', role: 'executor', required: true, maxAttempts: 1,
      sponsorLane: 'normal', localRank: 0, deadline: 1_000, enqueuedAt: 0,
      dependsOn: [], preemptibility: 'atomic',
    }),
  ];
}

function event(sequence: number, type: WorkroomEvent['type'], payload: Record<string, unknown>): WorkroomEvent {
  return Object.freeze({
    version: 1, eventId: `event-${sequence}`, runId: 'run-1', sequence,
    occurredAt: sequence, type, payload: Object.freeze(payload),
  });
}

function sha(value: string): string {
  return `sha256:${value.repeat(64).slice(0, 64)}`;
}
