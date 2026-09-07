import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { MemoryWorkroomJournal } from '../../src/workroom/journal.js';
import { WorkroomKernel } from '../../src/workroom/workroom-kernel.js';
import { createWorkroomSchedulerPolicySnapshot } from '../../src/workroom/workroom-scheduler.js';
import { createSelfDeliveryProjectForHost } from '../../src/plugin-runtime/self-delivery-project-composition.js';
import { digestWorkroomCatalogProjectBinding, type WorkroomDefinition } from '../../src/workroom/catalog-definition.js';
import { SelfDeliveryProject, createSelfDeliveryGitHubIssueReader, type SelfDeliveryProjectPorts } from '../../src/plugin-runtime/self-delivery-project.js';

function ports(): SelfDeliveryProjectPorts {
  const hash = `sha256:${'a'.repeat(64)}`;
  const binding = { role: 'executor', requires: {}, maxAttempts: 1 };
  return {
    profile: { repository: 'zhinjs/zhin', repositoryId: 123, projectId: 'project', revision: 'r1', sponsorPrincipalIds: ['alice'] },
    kernel: new WorkroomKernel({ journal: new MemoryWorkroomJournal() }),
    authenticate: async identity => identity === 'trusted-session' ? { principalId: 'alice' } : undefined,
    readiness: async () => [],
    readIssue: vi.fn(async number => ({ repositoryId: 123, id: 987, number, title: 'Fix regression', body: 'Requirement snapshot', updatedAt: '2026-09-07T00:00:00Z', state: 'open' as const })),
    planInput: async ({ operationId }) => ({
      metadata: { proposalId: operationId, projectId: 'project', authority: { projectRevision: 'r1', projectDigest: hash,
        profileRevisionId: 'p1', profileDigest: hash, planningPolicyRevisionId: 'policy1', planningPolicyDigest: hash,
        orchestratorAgentDefinitionId: 'orchestrator', orchestratorAuthorityDigest: hash }, budget: { maxTasks: 7, maxTotalAttempts: 7 },
      schedulerPolicy: createWorkroomSchedulerPolicySnapshot({ policyRef: 'scheduler', revision: 1, pinnedAtSequence: 1,
        capacity: 1, agingStepMs: 1000, starvationBoundMs: { urgent: 10000, high: 20000, normal: 30000, low: 40000 }, preemptionDeadlineMs: 5000 }) },
      environment: 'candidate', sponsor: { principalId: 'alice', decisionTimeoutMs: 1000 },
      scheduler: { sponsorLane: 'normal', enqueuedAt: 100, deadline: 10000 },
      stages: { requirements: binding, design: binding, implement: binding, test: binding, review: { ...binding, role: 'reviewer' }, release: binding, health: binding },
    }),
  };
}

describe('self-delivery Issue admission', () => {
  it('converges concurrent selection and reconstructs the same seven-task Kernel admission after restart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'self-delivery-'));
    try {
      const host = ports();
      const service = new SelfDeliveryProject(join(directory, 'issues'), host);
      const input = { identity: 'trusted-session', issueNumber: 7, acceptanceCriteria: ['Regression test passes'] };
      const [first, duplicate] = await Promise.all([service.select(input), service.select(input)]);
      expect(first).toEqual(duplicate);
      const replay = await new SelfDeliveryProject(join(directory, 'issues'), { ...host, readIssue: async () => { throw new Error('Remote issue changed'); } }).select(input);
      expect(replay).toEqual(first);
      const admitted = await host.kernel.readWorkflowPlanAdmission('self-delivery:123:issue:7');
      expect(Object.keys(admitted!.receipt.state.tasks)).toHaveLength(7);
      await expect(service.select({ ...input, acceptanceCriteria: ['Changed'] })).rejects.toThrow('different criteria');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it('refuses impersonation, missing provider and wrong repository before admission', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'self-delivery-'));
    try {
      const host = ports();
      const input = { identity: 'alice', issueNumber: 7, acceptanceCriteria: ['test'] };
      await expect(new SelfDeliveryProject(join(directory, 'issues'), host).select(input)).rejects.toThrow('authenticated');
      expect(host.readIssue).not.toHaveBeenCalled();
      const unavailable = new SelfDeliveryProject(join(directory, 'issues'), { ...host, readiness: async () => ['Executor unavailable'] });
      expect(await unavailable.doctor()).toMatchObject({ configured: true, ready: false });
      await expect(unavailable.select({ ...input, identity: 'trusted-session' })).rejects.toThrow('Executor unavailable');
      expect(await new SelfDeliveryProject(join(directory, 'other')).doctor()).toMatchObject({ configured: false, ready: false });
      const wrong = new SelfDeliveryProject(join(directory, 'issues'), { ...host, readIssue: async n => ({ ...await host.readIssue(n), repositoryId: 999 }) });
      await expect(wrong.select({ ...input, identity: 'trusted-session' })).rejects.toThrow('repository scope');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it('rechecks identity after asynchronous planning and refuses revoked admission', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'self-delivery-'));
    try {
      const host = ports();
      const authenticate = vi.fn().mockResolvedValueOnce({ principalId: 'alice' }).mockResolvedValue(undefined);
      const service = new SelfDeliveryProject(join(directory, 'issues'), { ...host, authenticate });
      await expect(service.select({ identity: 'trusted-session', issueNumber: 7, acceptanceCriteria: ['test'] })).rejects.toThrow('revoked');
      expect(await host.kernel.readWorkflowPlanAdmission('self-delivery:123:issue:7')).toBeUndefined();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it('composes the shared Kernel with active Catalog/Profile and invokes the existing Run pin writer', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'self-delivery-'));
    try {
      const host = ports();
      const definition: WorkroomDefinition = { name: 'Zhin', sponsors: ['alice'], members: [{ agent: 'orchestrator', role: 'orchestrator' }],
        conversation: { kind: 'repository', id: 'zhinjs/zhin', adapter: 'github', endpoint: 'github', agent: 'orchestrator' } };
      const pin = vi.fn(async () => undefined);
      const config = { ...host,
        planInput: async (request: Parameters<SelfDeliveryProjectPorts['planInput']>[0]) => {
          const plan = await host.planInput(request);
          return { ...plan, metadata: { ...plan.metadata, authority: { ...plan.metadata.authority,
            projectDigest: digestWorkroomCatalogProjectBinding(definition) } } };
        },
        codingExecutor: { execute() { throw new Error('not dispatched by selection'); } },
        deliveryProvider: { provider: { id: 'fixture', digest: `sha256:${'a'.repeat(64)}` },
          inspect: vi.fn(), dispatch: vi.fn(), query: vi.fn() },
      };
      const service = createSelfDeliveryProjectForHost({ directory: join(directory, 'issues'), configuration: config,
        kernel: host.kernel, catalog: { read: async () => ({ revision: 'r1', definitions: { project: definition } }) },
        profiles: { read: async () => ({ projectId: 'project', registryRevision: 1, revisions: {}, runPins: {},
          active: { revisionId: 'p1', compiledDigest: `sha256:${'a'.repeat(64)}`, activatedAtRegistryRevision: 1 } }) },
        pins: { afterPlanAdmission: pin }, signal: new AbortController().signal });
      expect(await service.doctor()).toMatchObject({ ready: true });
      const admitted = await service.select({ identity: 'trusted-session', issueNumber: 7, acceptanceCriteria: ['test'] });
      expect(pin).toHaveBeenCalledWith(expect.objectContaining({ operationId: 'self-delivery:123:issue:7',
        receipt: expect.objectContaining({ runId: admitted.runId }) }), expect.any(AbortSignal));
      definition.sponsors = [];
      await expect(service.select({ identity: 'trusted-session', issueNumber: 7, acceptanceCriteria: ['test'] })).rejects.toThrow('authenticated');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it('uses GitHub REST repository identity and rejects PR-shaped input without forwarding redirects', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({ id: 123 })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ pull_request: {}, number: 7 })));
    const read = createSelfDeliveryGitHubIssueReader({ repositoryId: 123, token: async () => 'test-token', fetch: transport });
    await expect(read(7)).rejects.toThrow('pull request');
    expect(transport.mock.calls[1]![0]).toBe('https://api.github.com/repos/zhinjs/zhin/issues/7');
    expect(transport.mock.calls[0]![1]).toMatchObject({ redirect: 'error' });
  });
});
