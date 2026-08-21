import { vi } from 'vitest';
import {
  LocalWorkroomSchedulerDispatchSupply,
  PinnedProfileCatalogLocalAssignmentRoute,
} from '../../src/plugin-runtime/workroom-local-assignment-supply.js';
import type { WorkroomDispatchTaskDecision } from '../../src/workroom/workroom-scheduler.js';

describe('Local Workroom Scheduler supply', () => {
  it('uses the one exact pinned Profile + Catalog local agent and issues through Kernel authority', async () => {
    const decision = dispatchDecision();
    const route = new PinnedProfileCatalogLocalAssignmentRoute({
      profiles: {
        read: async () => ({
          projectId: 'project-1', registryRevision: 3,
          active: { revisionId: 'profile-1', compiledDigest: sha('a'), activatedAtRegistryRevision: 2 },
          runPins: {
            'run-1': {
              projectId: 'project-1', runId: 'run-1', profileRevisionId: 'profile-1',
              profileDigest: sha('a'), activationRegistryRevision: 2, pinnedAtRegistryRevision: 3,
            },
          },
          revisions: {
            'profile-1': {
              revisionId: 'profile-1', projectId: 'project-1', compiledDigest: sha('a'),
              compiledProfile: {
                revisionId: 'profile-1', projectId: 'project-1', digest: sha('a'),
                agents: [{ id: 'developer', digest: sha('b'), role: 'executor', allowedTools: [], allowedSkills: [] }],
              },
            },
          },
        }) as never,
      },
    });
    const catalog = {
      revision: 'catalog-1',
      definitions: {
        'project-1': { enabled: true, members: [{ role: 'executor', agent: 'developer' }] },
      },
    } as never;
    await expect(route.resolve({ decision, catalog })).resolves.toEqual({
      kind: 'local', agentDefinitionId: 'developer',
      authorityRef: `profile:profile-1:${sha('a')}:catalog:catalog-1`,
    });

    const issueLocalAssignment = vi.fn(async () => ({ envelope: { assignmentId: 'assignment-1' } }));
    const dispatch = vi.fn();
    const supply = new LocalWorkroomSchedulerDispatchSupply({
      catalog: { read: async () => catalog },
      runState: {
        read: async () => ({ tasks: { build: { revision: 1, status: 'ready' } } }) as never,
        pinTaskAcceptance: async () => ({
          tasks: { build: { revision: 1, status: 'ready', acceptanceContract: { id: 'contract' } } },
        }) as never,
      },
      kernel: { issueLocalAssignment },
      runtime: { dispatch },
      route,
    });

    await supply.deliver(decision);
    expect(issueLocalAssignment).toHaveBeenCalledWith({
      operationId: decision.decisionId,
      projectId: decision.projectId,
      runId: decision.runId,
      taskKey: decision.taskKey,
      agentDefinitionId: 'developer',
    });
    expect(dispatch).toHaveBeenCalledWith({ assignmentId: 'assignment-1' });
  });

  it('fails closed rather than choosing lexicographically when pinned role routing is ambiguous', async () => {
    const route = new PinnedProfileCatalogLocalAssignmentRoute({
      profiles: { read: async () => ({
        projectId: 'project-1', registryRevision: 1,
        runPins: { 'run-1': { profileRevisionId: 'profile-1', profileDigest: sha('a') } },
        revisions: { 'profile-1': { compiledDigest: sha('a'), compiledProfile: {
          revisionId: 'profile-1', projectId: 'project-1', digest: sha('a'),
          agents: [
            { id: 'developer-a', role: 'executor' },
            { id: 'developer-b', role: 'executor' },
          ],
        } } },
      }) as never },
    });
    const catalog = { revision: 'catalog-1', definitions: { 'project-1': {
      enabled: true,
      members: [
        { role: 'executor', agent: 'developer-a' },
        { role: 'executor', agent: 'developer-b' },
      ],
    } } } as never;

    await expect(route.resolve({ decision: dispatchDecision(), catalog })).resolves.toBeNull();
  });

  it('probes governed runtime readiness before claiming and becomes recoverable without a claim', async () => {
    const decision = dispatchDecision();
    let payloadVaultReady = false;
    const issueLocalAssignment = vi.fn();
    const supply = new LocalWorkroomSchedulerDispatchSupply({
      catalog: { read: async () => ({
        revision: 'catalog-1',
        definitions: { 'project-1': {
          enabled: true, members: [{ role: 'executor', agent: 'developer' }],
        } },
      }) as never },
      runState: {
        read: async () => ({ tasks: { build: {
          revision: 1, status: 'ready', acceptanceContract: { id: 'contract' },
        } } }) as never,
        pinTaskAcceptance: vi.fn(),
      },
      kernel: { issueLocalAssignment },
      runtime: { dispatch: vi.fn() },
      route: { resolve: async () => ({
        kind: 'local', agentDefinitionId: 'developer', authorityRef: 'profile:1',
      }) },
      assertReady: () => {
        if (!payloadVaultReady) throw new Error('Payload Vault unavailable');
      },
    });

    await expect(supply.probe(decision)).resolves.toBe(false);
    await expect(supply.deliver(decision)).rejects.toThrow('route is unavailable');
    expect(issueLocalAssignment).not.toHaveBeenCalled();

    payloadVaultReady = true;
    await expect(supply.probe(decision)).resolves.toBe(true);
    expect(issueLocalAssignment).not.toHaveBeenCalled();
  });
});

function dispatchDecision(): WorkroomDispatchTaskDecision {
  return {
    version: 1, kind: 'dispatch_task', decisionId: `scheduler-decision:${sha('f')}`,
    digest: sha('f'), projectId: 'project-1', runId: 'run-1', taskKey: 'build',
    taskRevision: 1, role: 'executor', expectedSequence: 4, reason: 'ready',
    policy: { ref: 'scheduler:1', revision: 1, digest: sha('e') },
  };
}

function sha(char: string): string {
  return `sha256:${char.repeat(64)}`;
}
