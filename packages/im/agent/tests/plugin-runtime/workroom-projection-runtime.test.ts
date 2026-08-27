import { describe, expect, it, vi } from 'vitest';
import { MemoryWorkroomJournal } from '../../src/workroom/journal.js';
import {
  MemoryWorkroomProjectionRepository,
  WorkroomProjectionTracer,
  workroomProjectionMessageKey,
  type WorkroomProjectionBinding,
} from '../../src/workroom/projection-outbox.js';
import { WorkroomKernel } from '../../src/workroom/workroom-kernel.js';
import {
  createProjectionHumanIngressTargetResolver,
  WorkroomProjectionReplyResolver,
  WorkroomProjectionRuntime,
  WorkroomProjectionScheduler,
  workroomProjectionCatalogBindingDigest,
} from '../../src/plugin-runtime/workroom-projection-runtime.js';
import { createTestProjectionGovernance } from '../workroom/projection-governance-fixture.js';
import { digestCanonicalWorkroomValue as digest } from '../../src/workroom/canonical-value.js';
import type { PortfolioSponsorProjection } from '../../src/portfolio/sponsor-projection.js';

const governance = createTestProjectionGovernance();

describe('production Workroom Projection runtime', () => {
  it('renews each enabled IM Workroom binding before projecting durable facts', async () => {
    const repository = new MemoryWorkroomProjectionRepository();
    const renewWorkroomBinding = vi.fn(async () => undefined);
    const currentCatalog = {
      revision: 'a'.repeat(64),
      definitions: {
        'project-1': catalogDefinition(),
        disabled: { ...catalogDefinition(), enabled: false },
        repository: {
          ...catalogDefinition(),
          conversation: { kind: 'repository' as const, id: 'zhinjs/zhin', agent: 'software.orchestrator' },
        },
      },
    };
    const runtime = new WorkroomProjectionRuntime({
      catalog: { read: async () => currentCatalog },
      journal: new MemoryWorkroomJournal(),
      repository,
      outbound: { send: async () => ({ status: 'sent' }) },
      workerId: 'projection-renewal', leaseMs: 30_000,
      maxRunsPerTick: 4, maxDeliveriesPerTick: 4,
      governance,
      renewWorkroomBinding,
    });

    await expect(runtime.runOnce(new AbortController().signal)).resolves.toMatchObject({
      scannedRuns: 0, capturedRuns: 0, deliveries: 0,
    });
    expect(renewWorkroomBinding).toHaveBeenCalledExactlyOnceWith(
      'project-1', currentCatalog, expect.any(AbortSignal),
    );
  });

  it('recovers Catalog-bound Journal facts and drains them through the durable outbox', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const journal = new MemoryWorkroomJournal();
    const kernel = new WorkroomKernel({ journal, now: () => 100, createId: () => 'event-1' });
    await kernel.createRun({ projectId: 'project-1', runId: 'run-1', title: 'Production' });
    const repository = new MemoryWorkroomProjectionRepository();
    await repository.bind(0, binding());
    let unavailable = true;
    const send = vi.fn(async item => unavailable
      ? { status: 'failed' as const, code: 'transport_closed', retryable: true }
      : {
          status: 'sent' as const,
          message: { conversation: item.conversation, id: 'platform-message-1' },
        });
    const runtime = new WorkroomProjectionRuntime({
      catalog: catalog(),
      journal,
      repository,
      outbound: { send },
      workerId: 'projection-generation-7',
      leaseMs: 30_000,
      maxRunsPerTick: 4,
      maxDeliveriesPerTick: 4,
      governance,
    });

    await expect(runtime.runOnce(new AbortController().signal)).resolves.toEqual({
      scannedRuns: 1,
      capturedRuns: 1,
      deliveries: 1,
      pending: true,
    });
    unavailable = false;
    now.mockReturnValue(2_000);
    const restarted = new WorkroomProjectionRuntime({
      catalog: catalog(), journal, repository, outbound: { send },
      workerId: 'projection-generation-8', leaseMs: 30_000,
      maxRunsPerTick: 4, maxDeliveriesPerTick: 4,
      governance,
    });
    await restarted.runOnce(new AbortController().signal);

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]?.[0]).toMatchObject({
      projectId: 'project-1', runId: 'run-1', bindingRevision: 3,
    });
    expect(new TextDecoder().decode(send.mock.calls[0]?.[1]))
      .toBe('[Orchestrator · orchestrator] Run 已启动：Production');
    expect(Object.values((await repository.read()).messageIndex)).toHaveLength(1);
    now.mockRestore();
  });

  it('fails closed when the Project Catalog definition changed since exact binding', async () => {
    const journal = new MemoryWorkroomJournal();
    await new WorkroomKernel({ journal }).createRun({
      projectId: 'project-1', runId: 'run-stale', title: 'Stale',
    });
    const repository = new MemoryWorkroomProjectionRepository();
    await repository.bind(0, binding());
    const runtime = new WorkroomProjectionRuntime({
      catalog: {
        read: async () => ({
          revision: 'b'.repeat(64),
          definitions: { 'project-1': { ...catalogDefinition(), name: 'Renamed' } },
        }),
      },
      journal,
      repository,
      outbound: { send: async () => ({ status: 'sent' }) },
      workerId: 'projection-stale',
      leaseMs: 30_000,
      maxRunsPerTick: 4,
      maxDeliveriesPerTick: 4,
      governance,
    });

    await expect(runtime.runOnce(new AbortController().signal))
      .rejects.toThrow('stale Catalog revision');
  });

  it('revalidates the current Catalog binding after claim and before governance or send', async () => {
    const journal = new MemoryWorkroomJournal();
    await new WorkroomKernel({ journal }).createRun({
      projectId: 'project-1', runId: 'run-revoked', title: 'Revoked',
    });
    const repository = new MemoryWorkroomProjectionRepository();
    await repository.bind(0, binding());
    await new WorkroomProjectionTracer({
      journal, repository, governance,
    }).capture(binding(), 'run-revoked');
    const send = vi.fn(async () => ({ status: 'sent' as const }));
    const revalidate = vi.fn(governance.revalidate.bind(governance));
    const runtime = new WorkroomProjectionRuntime({
      catalog: { read: async () => ({ revision: 'b'.repeat(64), definitions: {
        'project-1': { ...catalogDefinition(), enabled: false },
      } }) },
      journal, repository, outbound: { send }, workerId: 'projection-revoked',
      leaseMs: 30_000, maxRunsPerTick: 4, maxDeliveriesPerTick: 4,
      governance: { prepareProjection: governance.prepareProjection.bind(governance), revalidate },
    });

    await expect(runtime.runOnce(new AbortController().signal)).resolves.toMatchObject({ deliveries: 1 });
    expect(revalidate).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(Object.values((await repository.read()).items)[0]?.delivery).toMatchObject({
      status: 'failed', failureCode: 'catalog_binding_stale', retryable: false,
    });
  });

  it('captures lifecycle overdue facts from the current Catalog binding and does not resend after restart', async () => {
    const repository = new MemoryWorkroomProjectionRepository();
    const lifecycleOverdue = { project: vi.fn(async () => overdueSnapshot()) };
    const send = vi.fn(async item => ({
      status: 'sent' as const,
      message: { conversation: item.conversation, id: 'lifecycle-message-1' },
    }));
    const runtime = new WorkroomProjectionRuntime({
      catalog: catalog(), journal: new MemoryWorkroomJournal(), repository,
      outbound: { send }, workerId: 'projection-lifecycle-7', leaseMs: 30_000,
      maxRunsPerTick: 4, maxDeliveriesPerTick: 4, governance, lifecycleOverdue,
      resolveSponsorConversation: async () => binding('sponsor_room').conversation,
    });

    await expect(runtime.runOnce(new AbortController().signal)).resolves.toEqual({
      scannedRuns: 0, capturedRuns: 0, deliveries: 1, pending: false,
    });
    const restarted = new WorkroomProjectionRuntime({
      catalog: catalog(), journal: new MemoryWorkroomJournal(), repository,
      outbound: { send }, workerId: 'projection-lifecycle-8', leaseMs: 30_000,
      maxRunsPerTick: 4, maxDeliveriesPerTick: 4, governance, lifecycleOverdue,
      resolveSponsorConversation: async () => binding('sponsor_room').conversation,
    });
    await restarted.runOnce(new AbortController().signal);

    expect(lifecycleOverdue.project).toHaveBeenCalledWith('project-1', expect.any(AbortSignal));
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toMatchObject({
      projectId: 'project-1', kind: 'attention',
      audience: 'sponsor_room',
      disclosure: { request: { sinkRuleId: 'projection:sponsor-room' } },
      target: { agentDefinitionId: 'software.orchestrator' },
    });
    expect(new TextDecoder().decode(send.mock.calls[0]?.[1])).toContain('Retention Hold review overdue');
  });

  it('rebinds a persisted Sponsor Room from current Catalog before reading its source', async () => {
    const repository = new MemoryWorkroomProjectionRepository();
    await repository.bind(0, binding('sponsor_room'));
    const lifecycleOverdue = { project: vi.fn(async () => overdueSnapshot()) };
    const runtime = new WorkroomProjectionRuntime({
      catalog: { read: async () => ({ revision: 'b'.repeat(64),
        definitions: { 'project-1': { ...catalogDefinition(), name: 'Renamed' } } }) },
      journal: new MemoryWorkroomJournal(), repository,
      outbound: { send: async () => ({ status: 'sent' }) },
      workerId: 'projection-lifecycle-stale', leaseMs: 30_000,
      maxRunsPerTick: 4, maxDeliveriesPerTick: 4, governance, lifecycleOverdue,
    });

    await expect(runtime.runOnce(new AbortController().signal)).resolves.toMatchObject({ deliveries: 1 });
    expect(lifecycleOverdue.project).toHaveBeenCalledTimes(1);
    expect((await repository.read()).bindings['project-1:sponsor-room']).toMatchObject({
      bindingRevision: 4,
      catalogBindingDigest: workroomProjectionCatalogBindingDigest({ ...catalogDefinition(), name: 'Renamed' }),
    });
  });

  it('rebinds a Sponsor Room when the current Endpoint capability changes across generations', async () => {
    const repository = new MemoryWorkroomProjectionRepository();
    await repository.bind(0, binding('sponsor_room'));
    await new WorkroomProjectionTracer({
      journal: new MemoryWorkroomJournal(), repository, governance,
    }).captureLifecycleOverdue(binding('sponsor_room'), overdueSnapshot());
    const currentConversation = {
      ...binding('sponsor_room').conversation,
      endpoint: { id: 'root\0zhin.adapter\0slack~next', adapter: 'root/plugin-next' },
    };
    const send = vi.fn(async item => ({
      status: 'sent' as const,
      message: { conversation: item.conversation, id: 'current-endpoint-message' },
    }));
    const runtime = new WorkroomProjectionRuntime({
      catalog: catalog(), journal: new MemoryWorkroomJournal(), repository,
      outbound: { send }, workerId: 'projection-endpoint-hmr', leaseMs: 30_000,
      maxRunsPerTick: 4, maxDeliveriesPerTick: 4, governance,
      lifecycleOverdue: { project: async () => overdueSnapshot() },
      resolveSponsorConversation: async () => currentConversation,
    });

    await runtime.runOnce(new AbortController().signal);

    expect((await repository.read()).bindings['project-1:sponsor-room']).toMatchObject({
      bindingRevision: 4,
      conversation: { endpoint: currentConversation.endpoint },
    });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ conversation: currentConversation }),
      expect.any(Uint8Array),
      expect.any(AbortSignal),
    );
    expect(Object.values((await repository.read()).items).map(item => item.delivery.status).sort())
      .toEqual(['failed', 'sent']);
  });

  it('keeps a Sponsor binding stable when one Agent definition occupies multiple member roles', async () => {
    const repository = new MemoryWorkroomProjectionRepository();
    const definition = {
      name: 'Zhin',
      members: [
        { agent: 'zhin', role: 'orchestrator' as const },
        { agent: 'zhin', role: 'executor' as const },
        { agent: 'zhin', role: 'reviewer' as const },
        { agent: 'zhin', role: 'integration' as const },
      ],
      conversation: {
        adapter: 'icqq', endpoint: 'main', kind: 'group' as const,
        id: 'workroom', agent: 'zhin',
      },
      sponsorConversation: {
        adapter: 'icqq', endpoint: 'main', kind: 'group' as const,
        id: 'sponsors', agent: 'zhin',
      },
    };
    const runtime = new WorkroomProjectionRuntime({
      catalog: { read: async () => ({
        revision: 'c'.repeat(64), definitions: { zhin: definition },
      }) },
      journal: new MemoryWorkroomJournal(), repository,
      outbound: { send: async () => ({ status: 'sent' }) },
      workerId: 'projection-multi-role', leaseMs: 30_000,
      maxRunsPerTick: 4, maxDeliveriesPerTick: 4, governance,
      lifecycleOverdue: { project: async () => {
        const { digest: _digest, ...snapshot } = overdueSnapshot();
        const body = { ...snapshot, projectId: 'zhin' };
        return { ...body, digest: digest(body) };
      } },
    });

    await runtime.runOnce(new AbortController().signal);
    const first = await repository.read();
    await runtime.runOnce(new AbortController().signal);
    const replay = await repository.read();

    expect(first.bindings['zhin:sponsor-room']).toMatchObject({ bindingRevision: 1 });
    expect(replay.bindings['zhin:sponsor-room']).toMatchObject({ bindingRevision: 1 });
  });

  it('backs off one retryable delivery so another durable item is not starved', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const repository = new MemoryWorkroomProjectionRepository();
    const first = overdueSnapshot();
    const { digest: _firstDigest, ...base } = first;
    const body = {
      ...base,
      overdue: [...first.overdue, {
        ...first.overdue[0]!, holdId: 'hold-2', placedAt: 2, reviewAt: 60, overdueBy: 40,
      }],
    };
    const lifecycleOverdue = { project: vi.fn(async () => ({ ...body, digest: digest(body) })) };
    const send = vi.fn()
      .mockResolvedValueOnce({ status: 'failed' as const, code: 'endpoint_down', retryable: true })
      .mockImplementation(async item => ({
        status: 'sent' as const, message: { conversation: item.conversation, id: 'second-item' },
      }));
    const runtime = new WorkroomProjectionRuntime({
      catalog: catalog(), journal: new MemoryWorkroomJournal(), repository,
      outbound: { send }, workerId: 'projection-fairness', leaseMs: 30_000,
      maxRunsPerTick: 4, maxDeliveriesPerTick: 4, governance, lifecycleOverdue,
      resolveSponsorConversation: async () => binding('sponsor_room').conversation,
    });

    await runtime.runOnce(new AbortController().signal);
    await runtime.runOnce(new AbortController().signal);

    expect(send).toHaveBeenCalledTimes(2);
    expect(Object.values((await repository.read()).items).map(item => item.delivery.status).sort())
      .toEqual(['failed', 'sent']);
    now.mockRestore();
  });

  it('delivers existing outbox work even when one lifecycle Project source fails', async () => {
    const journal = new MemoryWorkroomJournal();
    await new WorkroomKernel({ journal }).createRun({
      projectId: 'project-1', runId: 'run-ready', title: 'Ready',
    });
    const repository = new MemoryWorkroomProjectionRepository();
    await repository.bind(0, binding());
    await repository.bind(1, binding('sponsor_room'));
    await new WorkroomProjectionTracer({
      journal, repository, governance,
    }).capture(binding(), 'run-ready');
    const send = vi.fn(async () => ({ status: 'sent' as const }));
    const onCaptureError = vi.fn();
    const runtime = new WorkroomProjectionRuntime({
      catalog: catalog(), journal, repository, outbound: { send },
      workerId: 'projection-isolation', leaseMs: 30_000,
      maxRunsPerTick: 4, maxDeliveriesPerTick: 4, governance,
      lifecycleOverdue: { project: async () => { throw new Error('lifecycle source unavailable'); } },
      onCaptureError,
    });

    await expect(runtime.runOnce(new AbortController().signal)).resolves.toMatchObject({ deliveries: 1 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(onCaptureError).toHaveBeenCalledWith(expect.objectContaining({
      message: 'lifecycle source unavailable',
    }), 'project-1');
  });

  it('publishes Project-scoped Portfolio cards to the bootstrapped Sponsor Room once', async () => {
    const repository = new MemoryWorkroomProjectionRepository();
    const portfolioSponsor = {
      listPortfolioIds: vi.fn(async () => ['portfolio-main']),
      read: vi.fn(async () => portfolioProjection()),
    };
    const send = vi.fn(async item => ({
      status: 'sent' as const,
      message: { conversation: item.conversation, id: 'portfolio-message-1' },
    }));
    const options = {
      catalog: catalog(), journal: new MemoryWorkroomJournal(), repository,
      outbound: { send }, leaseMs: 30_000, maxRunsPerTick: 4, maxDeliveriesPerTick: 4,
      governance, portfolioSponsor,
      resolveSponsorConversation: async () => binding('sponsor_room').conversation,
    };

    await new WorkroomProjectionRuntime({ ...options, workerId: 'portfolio-generation-1' })
      .runOnce(new AbortController().signal);
    await new WorkroomProjectionRuntime({ ...options, workerId: 'portfolio-generation-2' })
      .runOnce(new AbortController().signal);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toMatchObject({
      projectId: 'project-1', audience: 'sponsor_room',
      disclosure: { request: { sinkRuleId: 'projection:sponsor-room' } },
    });
    expect(new TextDecoder().decode(send.mock.calls[0]?.[1]))
      .toContain('Portfolio portfolio-main / Project project-1');
    expect(new TextDecoder().decode(send.mock.calls[0]?.[1]))
      .toContain('rate=pool-a:2/10@1-100');
  });

  it('isolates one denied Portfolio Project without suppressing another Project card', async () => {
    const repository = new MemoryWorkroomProjectionRepository();
    const send = vi.fn(async item => ({
      status: 'sent' as const,
      message: { conversation: item.conversation, id: `portfolio-${item.projectId}` },
    }));
    const onCaptureError = vi.fn();
    const runtime = new WorkroomProjectionRuntime({
      catalog: { read: async () => ({ revision: 'a'.repeat(64), definitions: {
        'project-1': catalogDefinition(),
        'project-2': { ...catalogDefinition(), name: 'Project Two',
          conversation: { ...catalogDefinition().conversation, id: 'project-2-room' } },
      } }) },
      journal: new MemoryWorkroomJournal(), repository, outbound: { send },
      workerId: 'portfolio-isolation', leaseMs: 30_000,
      maxRunsPerTick: 4, maxDeliveriesPerTick: 4,
      governance: {
        prepareProjection: async (input, signal) => input.projectId === 'project-1'
          ? { status: 'blocked' as const, reason: 'disclosure_denied' as const }
          : await governance.prepareProjection(input, signal),
        revalidate: governance.revalidate.bind(governance),
      },
      portfolioSponsor: {
        listPortfolioIds: async () => ['portfolio-main'],
        read: async () => portfolioProjection(['project-1', 'project-2']),
      },
      resolveSponsorConversation: async () => binding('sponsor_room').conversation,
      onCaptureError,
    });

    await runtime.runOnce(new AbortController().signal);

    expect(onCaptureError).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('disclosure blocked'),
    }), 'project-1');
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toMatchObject({ projectId: 'project-2' });
  });

  it('aborts and joins an in-flight generation tick on dispose', async () => {
    let observedSignal: AbortSignal | undefined;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const runtime = {
      runOnce: vi.fn(async (signal: AbortSignal) => {
        observedSignal = signal;
        entered();
        await new Promise<void>((_resolve, reject) => signal.addEventListener(
          'abort', () => reject(signal.reason), { once: true },
        ));
        throw new Error('unreachable');
      }),
    };
    const scheduler = new WorkroomProjectionScheduler({ runtime, intervalMs: 10 });

    scheduler.start();
    await started;
    await scheduler.dispose();

    expect(observedSignal?.aborted).toBe(true);
    expect(runtime.runOnce).toHaveBeenCalledTimes(1);
  });

  it('resolves a durable Message Index reply against the current Assignment state', async () => {
    const message = { conversation: binding().conversation, id: 'platform-message-1' };
    const resolver = new WorkroomProjectionReplyResolver({
      repository: {
        read: async () => ({
          revision: 1,
          bindings: { 'project-1': binding() },
          cursors: {}, items: {},
          messageIndex: {
            [workroomProjectionMessageKey(message)]: {
              projectionId: 'projection:1', bindingRevision: 3,
              sourceEventIds: ['event-1'], message,
              speaker: binding().agents[0]!,
              target: {
                projectId: 'project-1', runId: 'run-1', taskKey: 'build',
                taskRevision: 1, assignmentId: 'assignment-1', assignmentRevision: 2,
                agentDefinitionId: 'software.developer',
              },
            },
          },
        }),
      },
      runState: {
        read: async () => ({
          assignments: {
            'assignment-1': {
              id: 'assignment-1', taskKey: 'build', taskRevision: 1,
              revision: 2, status: 'running',
            },
          },
        }),
      },
    });

    await expect(resolver.resolve({
      projectId: 'project-1', bindingRevision: 3, replyTo: message, intent: 'task_input',
    })).resolves.toMatchObject({
      status: 'task_target', disposition: 'context_proposal',
      target: { assignmentId: 'assignment-1', status: 'active' },
    });
  });

  it('resolves a unique mentioned member to its active Assignment', async () => {
    const message = { conversation: binding().conversation, id: 'reviewer-progress-1' };
    const resolver = new WorkroomProjectionReplyResolver({
      repository: { read: async () => ({
        revision: 1, bindings: { 'project-1': binding() }, cursors: {}, items: {},
        messageIndex: {
          [workroomProjectionMessageKey(message)]: {
            projectionId: 'projection:reviewer', bindingRevision: 3,
            sourceEventIds: ['event-reviewer'], message,
            speaker: binding().agents[0]!,
            target: {
              projectId: 'project-1', runId: 'run-1', taskKey: 'review',
              taskRevision: 1, assignmentId: 'assignment-reviewer', assignmentRevision: 2,
              agentDefinitionId: 'software.developer',
            },
          },
        },
      }) },
      runState: { read: async () => ({ assignments: {
        'assignment-reviewer': {
          id: 'assignment-reviewer', taskKey: 'review', taskRevision: 1,
          revision: 2, status: 'running',
        },
      } }) },
    });
    const target = createProjectionHumanIngressTargetResolver({
      resolver,
      intent: 'discussion',
      mention: {
        agentDefinitionId: 'software.developer',
        candidates: [message],
      },
    });

    await expect(target.resolve({
      decision: { projectId: 'project-1', bindingRevision: 3 },
    } as Parameters<typeof target.resolve>[0])).resolves.toMatchObject({
      status: 'task_target', via: 'mention', intent: 'discussion',
      target: {
        projectId: 'project-1', assignmentId: 'assignment-reviewer',
        agentDefinitionId: 'software.developer', status: 'active',
      },
    });
  });

  it('returns non_task_projection before reading a pseudo lifecycle Run', async () => {
    const message = { conversation: binding().conversation, id: 'lifecycle-message-1' };
    const read = vi.fn(async () => { throw new Error('must not read pseudo Run'); });
    const resolver = new WorkroomProjectionReplyResolver({
      repository: { read: async () => ({
        revision: 1, bindings: { 'project-1': binding() }, cursors: {}, items: {},
        messageIndex: {
          [workroomProjectionMessageKey(message)]: {
            projectionId: 'projection:lifecycle', bindingRevision: 3,
            sourceEventIds: ['payload-hold-overdue:1'], message,
            speaker: binding().orchestrator,
            target: {
              projectId: 'project-1', runId: 'payload-lifecycle:object-1',
              agentDefinitionId: 'software.orchestrator',
            },
          },
        },
      }) },
      runState: { read },
    });

    await expect(resolver.resolve({
      projectId: 'project-1', bindingRevision: 3, replyTo: message, intent: 'task_input',
    })).resolves.toMatchObject({
      status: 'clarification_required', reason: 'non_task_projection',
    });
    expect(read).not.toHaveBeenCalled();
  });
});

function catalog() {
  return {
    async read() {
      return {
        revision: 'a'.repeat(64),
        definitions: {
          'project-1': catalogDefinition(),
        },
      };
    },
  };
}

function overdueSnapshot() {
  const body = {
    version: 1 as const, projectId: 'project-1', clockRevision: 2, observedAt: 100,
    overdue: [{ objectId: 'object-1', stateSequence: 4,
      stateDigest: `sha256:${'d'.repeat(64)}`, holdId: 'hold-1', ownerPrincipalId: 'steward-1',
      reasonCode: 'legal_hold' as const, placedAt: 1, reviewAt: 50, overdueBy: 50 }],
  };
  return { ...body, digest: digest(body) };
}

function portfolioProjection(projectIds: readonly string[] = ['project-1']): PortfolioSponsorProjection {
  const project = (projectId: string): PortfolioSponsorProjection['projects'][string] => ({
    projectId, policyRevision: 1, lane: 'normal', status: 'active', weight: 1,
    grants: [], reclaims: [],
    budget: { limitMicros: 5, reservedMicros: 0, spentMicros: 0, availableMicros: 5 },
    rate: { 'pool-a': { windowStart: 1, windowEnd: 100, usedUnits: 2, limitUnits: 10 } },
    blockers: [],
    fairness: { normalizedService: 0, weight: 1, weightedService: 0, normalizedAtSequence: 4 },
  });
  const body = {
    version: 1 as const,
    portfolioId: 'portfolio-main', sourceSequence: 4,
    clock: { now: 10, sequence: 4, digest: `sha256:${'1'.repeat(64)}` },
    policy: { revision: 1, digest: `sha256:${'2'.repeat(64)}` },
    globalBudget: { limitMicros: 10, reservedMicros: 0, spentMicros: 0, availableMicros: 10 },
    projects: Object.fromEntries(projectIds.map(projectId => [projectId, project(projectId)])),
  };
  return { ...body, digest: digest(body) };
}

function binding(audience: 'workroom' | 'sponsor_room' = 'workroom'): WorkroomProjectionBinding {
  return {
    version: 1,
    audience,
    projectId: 'project-1',
    catalogBindingDigest: workroomProjectionCatalogBindingDigest(catalogDefinition()),
    bindingRevision: 3,
    projectionPolicyRevision: 1,
    conversation: {
      endpoint: { id: 'root\0zhin.adapter\0slack~main', adapter: 'root/plugin' },
      kind: 'channel', id: audience === 'workroom' ? 'project-1-room' : 'project-1-sponsors',
    },
    orchestrator: {
      principalId: 'agent-definition:software.orchestrator',
      agentDefinitionId: 'software.orchestrator',
      displayName: 'Orchestrator',
      role: 'orchestrator',
    },
    agents: [{
      principalId: 'agent-definition:software.developer',
      agentDefinitionId: 'software.developer',
      displayName: 'Developer',
      role: 'executor',
    }],
  };
}

function catalogDefinition() {
  return {
    name: 'Project One',
    sponsors: ['principal:sponsor'],
    members: [
      { agent: 'software.orchestrator', role: 'orchestrator' as const },
      { agent: 'software.developer', role: 'executor' as const },
    ],
    conversation: {
      adapter: 'slack', endpoint: 'main', kind: 'channel' as const,
      id: 'project-1-room', agent: 'software.orchestrator',
    },
    sponsorConversation: {
      adapter: 'slack', endpoint: 'main', kind: 'channel' as const,
      id: 'project-1-sponsors', agent: 'software.orchestrator',
    },
  };
}
