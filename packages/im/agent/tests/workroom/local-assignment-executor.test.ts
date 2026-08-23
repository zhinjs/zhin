import { describe, expect, it } from 'vitest';
import { rootPluginId } from '@zhin.js/plugin-runtime';
import type { AgentCapabilities, ToolCapability } from '../../src/plugin-runtime/capability-ingress.js';
import { bindWorkroomCapabilityRealization } from '../../src/plugin-runtime/deferred-capability-plan.js';
import {
  createAssignmentExecutionEnvelope,
  type AssignmentExecutionObservation,
  type AssignmentExecutionEnvelopeInput,
} from '../../src/workroom/assignment-executor.js';
import {
  LocalAssignmentExecutor,
  type LocalAssignmentCapabilityProjectionPort,
  type LocalModelExecutionEvent,
  type LocalModelExecutionPort,
} from '../../src/workroom/local-assignment-executor.js';
import {
  createWorkroomRoleCapabilityReference,
  createWorkroomRoleCapabilitySnapshot,
  createWorkroomRoleCapabilitySupply,
  type WorkroomRoleCapabilitySnapshotInput,
} from '../../src/workroom/role-capability-snapshot.js';

describe('Local Assignment Executor', () => {
  it('starts the local model only with the Envelope-bound physical capability plan', async () => {
    const envelope = createAssignmentExecutionEnvelope(envelopeInput());
    let releases = 0;
    let received: unknown;
    const model: LocalModelExecutionPort = {
      async *execute(request) {
        received = request;
        yield completedEvent('model-event-1');
      },
    };

    await collect(new LocalAssignmentExecutor(model, capabilityProjection(() => {
      releases += 1;
    })).execute(
      envelope,
      new AbortController().signal,
    ));

    expect(received).toMatchObject({
      envelope,
      capabilityPlan: {
        allTools: [
          { name: 'read_repo' },
          { name: 'discover' },
          { name: 'load_tool' },
          { name: 'load_skill' },
        ],
      },
    });
    expect((received as { capabilityPlan: { controller: { loadedToolNames(): string[] } } })
      .capabilityPlan.controller.loadedToolNames()).toEqual(['read_repo']);
    expect(releases).toBe(1);
  });

  it('does not start the model when the active generation cannot realize the snapshot', async () => {
    const envelope = createAssignmentExecutionEnvelope(envelopeInput());
    let releases = 0;
    const trusted = capabilityProjection(() => { releases += 1; });
    let modelCalls = 0;
    const model: LocalModelExecutionPort = {
      async *execute() {
        modelCalls += 1;
        yield completedEvent('must-not-run');
      },
    };
    const missing: LocalAssignmentCapabilityProjectionPort = {
      async resolve(input, signal) {
        const projection = await trusted.resolve(input, signal);
        return Object.freeze({
          ...projection,
          capabilities: Object.freeze({
            ...projection.capabilities,
            tools: Object.freeze([]),
          }),
        });
      },
    };

    await expect(collect(new LocalAssignmentExecutor(model, missing).execute(
      envelope,
      new AbortController().signal,
    ))).rejects.toThrow('trusted generation realization');
    expect(modelCalls).toBe(0);
    expect(releases).toBe(1);
  });

  it('projects local model events into immutable observations bound to the trusted Envelope', async () => {
    const envelope = createAssignmentExecutionEnvelope(envelopeInput());
    const controller = new AbortController();
    let receivedEnvelope: unknown;
    let receivedSignal: unknown;
    const model: LocalModelExecutionPort = {
      async *execute(request, signal) {
        receivedEnvelope = request.envelope;
        receivedSignal = signal;
        yield {
          version: 1,
          type: 'progress',
          eventId: 'model-event-1',
          progress: {
            summary: 'Implemented the local adapter',
            completedUnits: 1,
            totalUnits: 2,
          },
        };
        yield {
          version: 1,
          type: 'heartbeat',
          eventId: 'model-event-2',
        };
        yield {
          version: 1,
          type: 'checkpoint',
          eventId: 'model-event-3',
          checkpoint: {
            ref: 'artifact:checkpoint-1',
            digest: `sha256:${'c'.repeat(64)}`,
          },
        };
        yield {
          version: 1,
          type: 'execution_completed',
          eventId: 'model-event-4',
          completion: {
            report: {
              ref: 'task-report:assignment-1:1',
              digest: `sha256:${'d'.repeat(64)}`,
            },
            candidate: {
              ref: 'candidate:assignment-1:1',
              hash: `sha256:${'e'.repeat(64)}`,
            },
          },
        };
      },
    };

    const observations = await collect(
      new LocalAssignmentExecutor(model, capabilityProjection()).execute(envelope, controller.signal),
    );

    expect(receivedEnvelope).toBe(envelope);
    expect(receivedSignal).toBe(controller.signal);
    expect(observations).toEqual([
      {
        version: 1,
        type: 'progress',
        observationId: 'local/assignment-1/1/7/model-event-1',
        envelopeDigest: envelope.digest,
        progress: {
          summary: 'Implemented the local adapter',
          completedUnits: 1,
          totalUnits: 2,
        },
      },
      {
        version: 1,
        type: 'heartbeat',
        observationId: 'local/assignment-1/1/7/model-event-2',
        envelopeDigest: envelope.digest,
      },
      {
        version: 1,
        type: 'checkpoint',
        observationId: 'local/assignment-1/1/7/model-event-3',
        envelopeDigest: envelope.digest,
        checkpoint: {
          ref: 'artifact:checkpoint-1',
          digest: `sha256:${'c'.repeat(64)}`,
        },
      },
      {
        version: 1,
        type: 'execution_completed',
        observationId: 'local/assignment-1/1/7/model-event-4',
        envelopeDigest: envelope.digest,
        completion: {
          report: {
            ref: 'task-report:assignment-1:1',
            digest: `sha256:${'d'.repeat(64)}`,
          },
          candidate: {
            ref: 'candidate:assignment-1:1',
            hash: `sha256:${'e'.repeat(64)}`,
          },
        },
      },
    ]);
    expect(observations.every(Object.isFrozen)).toBe(true);
    expect(Object.isFrozen(observations[0]?.progress)).toBe(true);
    expect(Object.isFrozen(observations[2]?.checkpoint)).toBe(true);
    expect(Object.isFrozen(observations[3]?.completion)).toBe(true);
  });

  it('fails closed when local model execution ends without one typed completion', async () => {
    const envelope = createAssignmentExecutionEnvelope(envelopeInput());
    let releases = 0;
    const model: LocalModelExecutionPort = {
      async *execute() {
        yield {
          version: 1,
          type: 'heartbeat',
          eventId: 'model-event-1',
        };
      },
    };

    await expect(collect(
      new LocalAssignmentExecutor(model, capabilityProjection(() => { releases += 1; })).execute(
        envelope,
        new AbortController().signal,
      ),
    )).rejects.toThrow('ended without execution_completed');
    expect(releases).toBe(1);
  });

  it('rejects model events that smuggle Workroom command authority', async () => {
    const envelope = createAssignmentExecutionEnvelope(envelopeInput());
    const model: LocalModelExecutionPort = {
      async *execute() {
        yield {
          version: 1,
          type: 'heartbeat',
          eventId: 'model-event-1',
          cancel: true,
        } as unknown as LocalModelExecutionEvent;
      },
    };

    await expect(collect(
      new LocalAssignmentExecutor(model, capabilityProjection()).execute(
        envelope,
        new AbortController().signal,
      ),
    )).rejects.toThrow('contains forbidden field cancel');
  });

  it.each(['claim', 'clock', 'accept', 'replan', 'cancel'])(
    'rejects the non-Executor local model event %s',
    async (type) => {
      const envelope = createAssignmentExecutionEnvelope(envelopeInput());
      const model: LocalModelExecutionPort = {
        async *execute() {
          yield {
            version: 1,
            type,
            eventId: 'forged-event',
          } as unknown as LocalModelExecutionEvent;
        },
      };

      await expect(collect(
        new LocalAssignmentExecutor(model, capabilityProjection()).execute(
          envelope,
          new AbortController().signal,
        ),
      )).rejects.toThrow('unsupported event type');
    },
  );

  it('aborts and stops a pending local model execution without waiting for next', async () => {
    const envelope = createAssignmentExecutionEnvelope(envelopeInput());
    const controller = new AbortController();
    const cancelled = new DOMException('Sponsor cancelled the Assignment', 'AbortError');
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    let stopCalls = 0;
    let releases = 0;
    const model: LocalModelExecutionPort = {
      execute(_input, signal) {
        expect(signal).toBe(controller.signal);
        return {
          [Symbol.asyncIterator]() { return this; },
          next() {
            markStarted();
            return new Promise<IteratorResult<LocalModelExecutionEvent>>(() => undefined);
          },
          return() {
            stopCalls += 1;
            return Promise.resolve({ done: true, value: undefined });
          },
        };
      },
    };
    const pending = collect(new LocalAssignmentExecutor(
      model,
      capabilityProjection(() => { releases += 1; }),
    ).execute(
      envelope,
      controller.signal,
    ));
    await started;

    controller.abort(cancelled);

    await expect(Promise.race([
      pending,
      new Promise<never>((_, reject) => setTimeout(
        () => reject(new Error('Local model execution did not stop')),
        100,
      )),
    ])).rejects.toBe(cancelled);
    expect(stopCalls).toBe(1);
    expect(releases).toBe(1);
  });

  it('does not let a completion escape when the model emits another event after it', async () => {
    const envelope = createAssignmentExecutionEnvelope(envelopeInput());
    const model: LocalModelExecutionPort = {
      async *execute() {
        yield completedEvent('model-event-1');
        yield {
          version: 1,
          type: 'heartbeat',
          eventId: 'model-event-2',
        };
      },
    };
    const escaped: AssignmentExecutionObservation[] = [];

    const consume = async (): Promise<void> => {
      for await (const observation of new LocalAssignmentExecutor(
        model,
        capabilityProjection(),
      ).execute(
        envelope,
        new AbortController().signal,
      )) {
        escaped.push(observation);
      }
    };

    await expect(consume()).rejects.toThrow('event after execution_completed');
    expect(escaped).toEqual([]);
  });

  it('rejects a repeated eventId even when the duplicate changes event type', async () => {
    const envelope = createAssignmentExecutionEnvelope(envelopeInput());
    const model: LocalModelExecutionPort = {
      async *execute() {
        yield { version: 1, type: 'heartbeat', eventId: 'model-event-1' };
        yield {
          version: 1,
          type: 'progress',
          eventId: 'model-event-1',
          progress: { summary: 'forged duplicate', completedUnits: 1, totalUnits: 1 },
        };
      },
    };

    await expect(collect(new LocalAssignmentExecutor(model, capabilityProjection()).execute(
      envelope,
      new AbortController().signal,
    ))).rejects.toThrow('repeated eventId model-event-1');
  });
});

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of source) values.push(value);
  return values;
}

function envelopeInput(): AssignmentExecutionEnvelopeInput {
  const scope = assignmentScope();
  const supplies = capabilitySupplies(scope);
  return {
    projectId: scope.projectId,
    runId: scope.runId,
    taskKey: scope.taskKey,
    taskRevision: scope.taskRevision,
    assignmentId: scope.assignmentId,
    assignmentRevision: scope.assignmentRevision,
    attempt: 1,
    fence: 7,
    principalId: 'agent:developer-1',
    role: scope.role,
    agentDefinition: snapshot('agent-definition:developer:1', 1, 'a'),
    plan: snapshot('workflow-plan:run-1:2', 2, 'b'),
    contextPolicy: snapshot('context-policy:project-1:1', 1, 'c'),
    factAnchor: {
      ref: 'workroom-facts:run-1:12',
      sequence: 12,
      digest: `sha256:${'d'.repeat(64)}`,
    },
    capabilitySnapshot: createWorkroomRoleCapabilityReference(supplies),
    policySnapshot: snapshot('policy-snapshot:run-1:1', 1, 'f'),
    workspace: {
      leaseRef: 'workspace-lease:assignment-1:1',
      mountRef: 'workspace-mount:assignment-1:1',
      baseRevision: 'git:base-sha',
      fence: 7,
    },
  };
}

function capabilityProjection(
  release: () => void = () => undefined,
): LocalAssignmentCapabilityProjectionPort {
  const capabilities = assignmentCapabilities();
  return Object.freeze({
    async resolve(envelope) {
      const supplies = capabilitySupplies(assignmentScope());
      const capabilitySnapshot = createWorkroomRoleCapabilitySnapshot({ envelope, ...supplies });
      return Object.freeze({
        capabilities,
        capabilitySnapshot,
        realization: bindWorkroomCapabilityRealization(
          capabilities,
          envelope,
          capabilitySnapshot,
        ),
        sessionSnapshot: {
          loadedTools: {
            read_repo: 3,
            spawn_task: 2,
            plugin__workroom_executor_report_progress: 1,
          },
          loadedSkills: ['research', 'deploy'],
        },
        config: {
          deferredTools: {
            alwaysLoadedTools: [
              'discover', 'load_tool', 'load_skill', 'read_repo', 'spawn_task',
              'plugin__workroom_executor_report_progress',
            ],
          },
        },
        persistSnapshot: async () => undefined,
        release,
      });
    },
  });
}

function assignmentScope() {
  return {
    projectId: 'project-1',
    runId: 'run-1',
    taskKey: 'build',
    taskRevision: 2,
    assignmentId: 'assignment-1',
    assignmentRevision: 3,
    role: 'executor' as const,
    capabilitySnapshotRef: 'capability-snapshot:assignment-1:1',
    capabilitySnapshotRevision: 1,
  };
}

function capabilitySupplies(
  scope: ReturnType<typeof assignmentScope>,
): Omit<WorkroomRoleCapabilitySnapshotInput, 'envelope'> {
  const sources = [
    'generation', 'profile', 'agent_definition', 'role', 'task', 'policy',
  ] as const;
  return Object.fromEntries(sources.map((source, index) => [source,
    createWorkroomRoleCapabilitySupply({
      source,
      id: `authority-${index + 1}`,
      revision: 1,
      ...scope,
      tools: [{ name: 'read_repo', digest: sha('a') }],
      skills: [{
        name: 'research',
        digest: sha('b'),
        requiredTools: ['read_repo'],
      }],
    }),
  ])) as unknown as Omit<WorkroomRoleCapabilitySnapshotInput, 'envelope'>;
}

function assignmentCapabilities(): AgentCapabilities {
  const owner = rootPluginId();
  return Object.freeze({
    generation: 7,
    owner,
    tools: Object.freeze([
      testTool(owner, 'read_repo'),
      testTool(owner, 'spawn_task'),
      testTool(owner, 'plugin__workroom_executor_report_progress'),
    ]),
    skills: Object.freeze([
      testSkill(owner, 'research', 'Use primary sources.'),
      testSkill(owner, 'deploy', 'Deploy the application.'),
    ]),
    agents: Object.freeze([]),
    mcp: Object.freeze([]),
    promptSections: Object.freeze([]),
  });
}

function testTool(
  owner: ReturnType<typeof rootPluginId>,
  name: string,
): ToolCapability {
  return Object.freeze({
    owner,
    name,
    qualifiedName: name,
    description: name,
    approval: 'never',
    source: `/tools/${name}.ts`,
    execute: async <TInput = unknown, TResult = unknown>(input: TInput) => input as TResult,
  });
}

function testSkill(
  owner: ReturnType<typeof rootPluginId>,
  name: string,
  instructions: string,
) {
  return Object.freeze({
    $feature: 'zhin.skill/1' as const,
    owner,
    name,
    qualifiedName: name,
    description: name,
    instructions,
    source: `/skills/${name}/SKILL.md`,
  });
}

function sha(character: string): string {
  return `sha256:${character.repeat(64)}`;
}

function snapshot(ref: string, revision: number, hex: string) {
  return { ref, revision, digest: `sha256:${hex.repeat(64)}` };
}

function completedEvent(eventId: string): LocalModelExecutionEvent {
  return {
    version: 1,
    type: 'execution_completed',
    eventId,
    completion: {
      report: {
        ref: 'task-report:assignment-1:1',
        digest: `sha256:${'d'.repeat(64)}`,
      },
      candidate: {
        ref: 'candidate:assignment-1:1',
        hash: `sha256:${'e'.repeat(64)}`,
      },
    },
  };
}
