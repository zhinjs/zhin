import { describe, expect, it, vi } from 'vitest';
import { MemoryWorkroomJournal } from '../../src/workroom/journal.js';
import {
  MemoryWorkroomProjectionRepository,
  workroomProjectionMessageKey,
  type WorkroomProjectionBinding,
} from '../../src/workroom/projection-outbox.js';
import { WorkroomKernel } from '../../src/workroom/workroom-kernel.js';
import {
  WorkroomProjectionReplyResolver,
  WorkroomProjectionRuntime,
  WorkroomProjectionScheduler,
  workroomProjectionCatalogBindingDigest,
} from '../../src/plugin-runtime/workroom-projection-runtime.js';
import { createTestProjectionGovernance } from '../workroom/projection-governance-fixture.js';

const governance = createTestProjectionGovernance();

describe('production Workroom Projection runtime', () => {
  it('recovers Catalog-bound Journal facts and drains them through the durable outbox', async () => {
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

function binding(): WorkroomProjectionBinding {
  return {
    version: 1,
    projectId: 'project-1',
    catalogBindingDigest: workroomProjectionCatalogBindingDigest(catalogDefinition()),
    bindingRevision: 3,
    projectionPolicyRevision: 1,
    conversation: {
      endpoint: { id: 'root\0zhin.adapter\0slack~main', adapter: 'root/plugin' },
      kind: 'channel', id: 'project-1-room',
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
    members: [
      { agent: 'software.orchestrator', role: 'orchestrator' as const },
      { agent: 'software.developer', role: 'executor' as const },
    ],
    conversation: {
      adapter: 'slack', endpoint: 'main', kind: 'channel' as const,
      id: 'project-1-room', agent: 'software.orchestrator',
    },
  };
}
