import { describe, expect, it } from 'vitest';
import {
  createAssignmentExecutionEnvelope,
  executeAssignment,
  validateAssignmentExecutionObservation,
  type AssignmentExecutorPort,
  type AssignmentExecutionEnvelopeInput,
} from '../../src/workroom/assignment-executor.js';

describe('Assignment Executor boundary', () => {
  it('materializes one deeply immutable role-scoped execution envelope', () => {
    const envelope = createAssignmentExecutionEnvelope(envelopeInput());

    expect(envelope).toMatchObject({
      version: 1,
      projectId: 'project-1',
      runId: 'run-1',
      taskKey: 'build',
      taskRevision: 2,
      assignmentId: 'assignment-1',
      assignmentRevision: 3,
      attempt: 1,
      fence: 7,
      principalId: 'agent:developer-1',
      role: 'executor',
    });
    expect(envelope.digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(Object.isFrozen(envelope)).toBe(true);
    expect(Object.isFrozen(envelope.capabilitySnapshot)).toBe(true);
    expect(Object.isFrozen(envelope.policySnapshot)).toBe(true);
    expect(Object.isFrozen(envelope.workspace)).toBe(true);
  });

  it('pins exact Agent Definition, Plan, Context Policy and fact anchor authority', () => {
    const envelope = createAssignmentExecutionEnvelope({
      ...envelopeInput(),
      agentDefinition: {
        ref: 'agent-definition:developer:5',
        revision: 5,
        digest: `sha256:${'1'.repeat(64)}`,
      },
      plan: {
        ref: 'workflow-plan:run-1:2',
        revision: 2,
        digest: `sha256:${'2'.repeat(64)}`,
      },
      contextPolicy: {
        ref: 'context-policy:project-1:4',
        revision: 4,
        digest: `sha256:${'3'.repeat(64)}`,
      },
      factAnchor: {
        ref: 'workroom-facts:run-1:23',
        sequence: 23,
        digest: `sha256:${'4'.repeat(64)}`,
      },
    } as AssignmentExecutionEnvelopeInput);

    expect(envelope).toMatchObject({
      agentDefinition: { ref: 'agent-definition:developer:5', revision: 5 },
      plan: { ref: 'workflow-plan:run-1:2', revision: 2 },
      contextPolicy: { ref: 'context-policy:project-1:4', revision: 4 },
      factAnchor: { ref: 'workroom-facts:run-1:23', sequence: 23 },
    });
  });

  it.each(['agentDefinition', 'plan', 'contextPolicy', 'factAnchor'] as const)(
    'fails closed when required authority reference %s is missing',
    (field) => {
      const input = { ...envelopeInput() } as Record<string, unknown>;
      delete input[field];
      expect(() => createAssignmentExecutionEnvelope(
        input as unknown as AssignmentExecutionEnvelopeInput,
      )).toThrow('must be an object');
    },
  );

  it.each(['agentDefinition', 'plan', 'contextPolicy', 'factAnchor'] as const)(
    'rejects post-issuance tampering of authority reference %s',
    (field) => {
      const envelope = createAssignmentExecutionEnvelope(envelopeInput());
      const corrupted = Object.freeze({
        ...envelope,
        [field]: Object.freeze({ ...envelope[field], ref: `${envelope[field].ref}:tampered` }),
      });
      expect(() => validateAssignmentExecutionObservation(corrupted, {
        version: 1,
        type: 'heartbeat',
        observationId: `tampered-${field}`,
        envelopeDigest: corrupted.digest,
      })).toThrow('Envelope digest does not match');
    },
  );

  it('rejects Reviewer or arbitrary domain role on the Executor seam', () => {
    expect(() => createAssignmentExecutionEnvelope({
      ...envelopeInput(),
      role: 'reviewer',
    } as unknown as AssignmentExecutionEnvelopeInput)).toThrow('executor or integration');
  });

  it('accepts a progress observation only when it is bound to the exact envelope', () => {
    const envelope = createAssignmentExecutionEnvelope(envelopeInput());
    const observation = validateAssignmentExecutionObservation(envelope, {
      version: 1,
      type: 'progress',
      observationId: 'observation-1',
      envelopeDigest: envelope.digest,
      progress: {
        summary: 'Implemented the journal adapter',
        completedUnits: 2,
        totalUnits: 5,
      },
    });

    expect(observation).toEqual({
      version: 1,
      type: 'progress',
      observationId: 'observation-1',
      envelopeDigest: envelope.digest,
      progress: {
        summary: 'Implemented the journal adapter',
        completedUnits: 2,
        totalUnits: 5,
      },
    });
    expect(Object.isFrozen(observation.progress)).toBe(true);
  });

  it('accepts a heartbeat without letting the Executor choose a clock or lease', () => {
    const envelope = createAssignmentExecutionEnvelope(envelopeInput());

    expect(validateAssignmentExecutionObservation(envelope, {
      version: 1,
      type: 'heartbeat',
      observationId: 'observation-2',
      envelopeDigest: envelope.digest,
    })).toEqual({
      version: 1,
      type: 'heartbeat',
      observationId: 'observation-2',
      envelopeDigest: envelope.digest,
    });
  });

  it('accepts an immutable checkpoint reference for the current attempt', () => {
    const envelope = createAssignmentExecutionEnvelope(envelopeInput());
    const observation = validateAssignmentExecutionObservation(envelope, {
      version: 1,
      type: 'checkpoint',
      observationId: 'observation-3',
      envelopeDigest: envelope.digest,
      checkpoint: {
        ref: 'artifact:checkpoint-1',
        digest: `sha256:${'c'.repeat(64)}`,
      },
    });

    expect(observation).toMatchObject({
      type: 'checkpoint',
      checkpoint: { ref: 'artifact:checkpoint-1' },
    });
    expect(Object.isFrozen(observation.checkpoint)).toBe(true);
  });

  it('accepts typed execution completion without granting acceptance authority', () => {
    const envelope = createAssignmentExecutionEnvelope(envelopeInput());
    const observation = validateAssignmentExecutionObservation(envelope, {
      version: 1,
      type: 'execution_completed',
      observationId: 'observation-4',
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
    });

    expect(observation).toMatchObject({
      type: 'execution_completed',
      completion: {
        report: { ref: 'task-report:assignment-1:1' },
        candidate: { ref: 'candidate:assignment-1:1' },
      },
    });
    expect('accepted' in observation).toBe(false);
    expect(Object.isFrozen(observation.completion)).toBe(true);
  });

  it('fails closed when an untrusted envelope tries to smuggle additional authority', () => {
    expect(() => createAssignmentExecutionEnvelope({
      ...envelopeInput(),
      runStatus: 'completed',
    } as AssignmentExecutionEnvelopeInput)).toThrow('forbidden field runStatus');
  });

  it.each(['claim', 'advance_clock', 'accept', 'replan', 'cancel'])(
    'rejects the non-Executor action %s',
    (type) => {
      const envelope = createAssignmentExecutionEnvelope(envelopeInput());
      expect(() => validateAssignmentExecutionObservation(envelope, {
        version: 1,
        type,
        observationId: 'forged-observation',
        envelopeDigest: envelope.digest,
      })).toThrow('unsupported observation type');
    },
  );

  it('rejects another target and Executor-selected lease fields', () => {
    const envelope = createAssignmentExecutionEnvelope(envelopeInput());
    expect(() => validateAssignmentExecutionObservation(envelope, {
      version: 1,
      type: 'heartbeat',
      observationId: 'forged-target',
      envelopeDigest: `sha256:${'f'.repeat(64)}`,
    })).toThrow('not bound to the current Envelope');
    expect(() => validateAssignmentExecutionObservation(envelope, {
      version: 1,
      type: 'heartbeat',
      observationId: 'forged-lease',
      envelopeDigest: envelope.digest,
      assignmentId: 'assignment-other',
      leaseExpiresAt: Number.MAX_SAFE_INTEGER,
    })).toThrow('forbidden field assignmentId');
  });

  it('rejects a corrupted trusted envelope before accepting observations', () => {
    const envelope = createAssignmentExecutionEnvelope(envelopeInput());
    const corrupted = { ...envelope, role: 'integration' as const };

    expect(() => validateAssignmentExecutionObservation(corrupted, {
      version: 1,
      type: 'heartbeat',
      observationId: 'observation-corrupt-envelope',
      envelopeDigest: corrupted.digest,
    })).toThrow('Envelope digest does not match');
  });

  it('does not start an Executor or emit observations when caller cancellation already won', async () => {
    const envelope = createAssignmentExecutionEnvelope(envelopeInput());
    const controller = new AbortController();
    const cancelled = new DOMException('Sponsor cancelled the Assignment', 'AbortError');
    controller.abort(cancelled);
    let calls = 0;
    const observations: unknown[] = [];
    const port: AssignmentExecutorPort = {
      async *execute() {
        calls += 1;
        yield {
          version: 1,
          type: 'heartbeat',
          observationId: 'must-not-escape',
          envelopeDigest: envelope.digest,
        };
      },
    };

    await expect(async () => {
      for await (const observation of executeAssignment(port, envelope, controller.signal)) {
        observations.push(observation);
      }
    }).rejects.toBe(cancelled);
    expect(calls).toBe(0);
    expect(observations).toEqual([]);
  });

  it('caller abort wins even when Executor next and return never settle', async () => {
    const envelope = createAssignmentExecutionEnvelope(envelopeInput());
    const controller = new AbortController();
    const cancelled = new DOMException('Sponsor cancelled the stuck Assignment', 'AbortError');
    let startNext!: () => void;
    const nextStarted = new Promise<void>((resolve) => { startNext = resolve; });
    let returnCalls = 0;
    const port: AssignmentExecutorPort = {
      execute() {
        return {
          [Symbol.asyncIterator]() { return this; },
          next() {
            startNext();
            return new Promise<IteratorResult<never>>(() => undefined);
          },
          return() {
            returnCalls += 1;
            return new Promise<IteratorResult<never>>(() => undefined);
          },
        };
      },
    };
    const observations: unknown[] = [];
    const consumption = (async () => {
      for await (const observation of executeAssignment(port, envelope, controller.signal)) {
        observations.push(observation);
      }
    })();
    await nextStarted;
    controller.abort(cancelled);

    const settlement = consumption.then(
      () => ({ kind: 'completed' as const }),
      (error: unknown) => ({ kind: 'rejected' as const, error }),
    );
    const result = await Promise.race([
      settlement,
      new Promise<{ kind: 'timeout' }>((resolve) => {
        setTimeout(() => resolve({ kind: 'timeout' }), 100);
      }),
    ]);
    expect(result).toEqual({ kind: 'rejected', error: cancelled });
    expect(returnCalls).toBe(1);
    expect(observations).toEqual([]);
  });
});

function envelopeInput(
  overrides: Partial<AssignmentExecutionEnvelopeInput> = {},
): AssignmentExecutionEnvelopeInput {
  return {
    projectId: 'project-1',
    runId: 'run-1',
    taskKey: 'build',
    taskRevision: 2,
    assignmentId: 'assignment-1',
    assignmentRevision: 3,
    attempt: 1,
    fence: 7,
    principalId: 'agent:developer-1',
    role: 'executor',
    agentDefinition: {
      ref: 'agent-definition:developer:5',
      revision: 5,
      digest: `sha256:${'1'.repeat(64)}`,
    },
    plan: {
      ref: 'workflow-plan:run-1:2',
      revision: 2,
      digest: `sha256:${'2'.repeat(64)}`,
    },
    contextPolicy: {
      ref: 'context-policy:project-1:4',
      revision: 4,
      digest: `sha256:${'3'.repeat(64)}`,
    },
    factAnchor: {
      ref: 'workroom-facts:run-1:23',
      sequence: 23,
      digest: `sha256:${'4'.repeat(64)}`,
    },
    capabilitySnapshot: {
      ref: 'capability-snapshot:assignment-1:3',
      revision: 3,
      digest: `sha256:${'a'.repeat(64)}`,
    },
    policySnapshot: {
      ref: 'policy-snapshot:project-1:4',
      revision: 4,
      digest: `sha256:${'b'.repeat(64)}`,
    },
    workspace: {
      leaseRef: 'workspace-lease:assignment-1:1',
      mountRef: 'workspace-mount:opaque-7',
      baseRevision: 'git:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      fence: 7,
    },
    ...overrides,
  };
}
