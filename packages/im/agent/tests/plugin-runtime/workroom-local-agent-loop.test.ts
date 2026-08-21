import { vi } from 'vitest';
import {
  DurableReportLocalModelExecutionPort,
  type WorkroomLocalAgentTurnPort,
  type WorkroomEvidencePayloadWriterPort,
} from '../../src/plugin-runtime/workroom-local-agent-loop.js';
import type { DeferredCapabilityPlan } from '../../src/plugin-runtime/deferred-capability-plan.js';
import { createAssignmentExecutionEnvelope } from '../../src/workroom/assignment-executor.js';

const SHA = `sha256:${'a'.repeat(64)}`;

describe('Workroom local Agent loop adapter', () => {
  it('owns an isolated Assignment turn and persists evidence/report before emitting completion refs', async () => {
    const operations: string[] = [];
    const turn: WorkroomLocalAgentTurnPort = {
      run: vi.fn(async input => {
        operations.push(`turn:${input.turnId}:${input.principalId}`);
        expect(input.capabilityPlan).toBe(capabilityPlan);
        return {
          output: JSON.stringify({
            claims: [{
              label: 'implementation', key: 'task.result', value: 'implemented', status: 'verified',
              evidenceIds: ['test-output'], artifactRefs: ['git:abc123'],
            }],
            evidence: [{
              id: 'test-output', mediaType: 'text/plain', content: '42 tests passed',
              source: { kind: 'command', locator: 'pnpm test' },
            }],
          }),
        };
      }),
    };
    const reports = {
      writeEvidence: vi.fn(async evidence => {
        operations.push(`evidence:${evidence.ref}`);
        expect(evidence).not.toHaveProperty('content');
        expect(JSON.stringify(evidence)).not.toContain('42 tests passed');
        expect(JSON.stringify(evidence)).not.toContain('pnpm test');
        expect(evidence.descriptor).toEqual({
          vaultObjectId: 'vault-object:test-output',
          objectId: 'object:test-output',
          payloadHash: SHA,
          descriptorDigest: `sha256:${'b'.repeat(64)}`,
          locationManifestDigest: `sha256:${'c'.repeat(64)}`,
          bytes: 15,
        });
        expect(evidence.source).toEqual({
          kind: 'command',
          ref: 'command-execution:trusted-1',
          digest: `sha256:${'d'.repeat(64)}`,
          bindingDigest: `sha256:${'e'.repeat(64)}`,
          verification: 'verified',
        });
        return { ref: evidence.ref, digest: evidence.digest };
      }),
      writeReport: vi.fn(async report => {
        operations.push(`report:${report.ref}`);
        expect(report.claims[0]).toMatchObject({
          id: expect.stringMatching(/^workroom-claim:sha256:[a-f0-9]{64}$/u),
          label: 'implementation',
        });
        expect(report.claims[0]?.id).not.toBe('implementation');
        expect(report).toMatchObject({
          assignmentId: 'assignment-1', assignmentAttempt: 1, assignmentFence: 7,
        });
        return { ref: report.ref, digest: report.digest };
      }),
      read: vi.fn(),
    };
    const payloads: WorkroomEvidencePayloadWriterPort = {
      write: vi.fn(async (input, signal: AbortSignal) => {
        signal.throwIfAborted();
        operations.push(`payload:${input.claimedSource.locator}`);
        expect(input.content).toBe('42 tests passed');
        expect(input.attribution.assignmentId).toBe('assignment-1');
        const receipt = governedReceipt('test-output', 'command-execution:trusted-1', 'verified', 15);
        await input.publication.publish(receipt, signal);
        return receipt;
      }),
    };
    const model = new DurableReportLocalModelExecutionPort({ turn, reports, payloads });
    const envelope = createAssignmentExecutionEnvelope(envelopeInput());
    const events = [];

    for await (const event of model.execute({ envelope, capabilityPlan }, new AbortController().signal)) {
      operations.push(`event:${event.type}`);
      events.push(event);
    }

    expect(events.map(event => event.type)).toEqual(['heartbeat', 'progress', 'execution_completed']);
    expect(operations.findIndex(value => value.startsWith('payload:')))
      .toBeLessThan(operations.findIndex(value => value.startsWith('evidence:')));
    expect(operations.findIndex(value => value.startsWith('evidence:')))
      .toBeLessThan(operations.findIndex(value => value.startsWith('report:')));
    expect(operations.findIndex(value => value.startsWith('report:')))
      .toBeLessThan(operations.indexOf('event:execution_completed'));
    const completion = events.at(-1);
    expect(completion).toMatchObject({
      type: 'execution_completed',
      completion: {
        report: { ref: expect.stringMatching(/^workroom-report:sha256:/u) },
        candidate: { ref: expect.stringMatching(/^workroom-candidate:sha256:/u) },
      },
    });
    expect(turn.run).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'workroom:project-1:run-1:assignment-1:1:7',
      turnId: 'workroom-turn:assignment-1:1:7',
      principalId: 'agent:developer',
      journalAttribution: {
        projectId: 'project-1', runId: 'run-1', taskKey: 'build',
        taskRevision: 1, assignmentId: 'assignment-1', attempt: 1, fence: 7,
      },
    }), expect.any(AbortSignal));
  });

  it('fails closed without publishing completion when report JSON is invalid', async () => {
    const reports = { writeEvidence: vi.fn(), writeReport: vi.fn(), read: vi.fn() };
    const model = new DurableReportLocalModelExecutionPort({
      turn: { run: async () => ({ output: 'not json' }) },
      reports,
      payloads: { write: vi.fn() },
    });
    const consume = async () => {
      for await (const _event of model.execute({
        envelope: createAssignmentExecutionEnvelope(envelopeInput()), capabilityPlan,
      }, new AbortController().signal)) { /* consume */ }
    };

    await expect(consume()).rejects.toThrow('structured Task Report JSON');
    expect(reports.writeEvidence).not.toHaveBeenCalled();
    expect(reports.writeReport).not.toHaveBeenCalled();
  });

  it('fails closed without evidence headers, reports, or completion when the Payload Vault rejects', async () => {
    const reports = { writeEvidence: vi.fn(), writeReport: vi.fn(), read: vi.fn() };
    const model = new DurableReportLocalModelExecutionPort({
      turn: {
        run: async () => ({
          output: JSON.stringify({
            claims: [{
              label: 'implementation', key: 'task.result', value: 'implemented', status: 'verified',
              evidenceIds: ['secret'], artifactRefs: [],
            }],
            evidence: [{
              id: 'secret', mediaType: 'text/plain', content: 'model-sensitive-body',
              source: { kind: 'tool', locator: 'secret-tool' },
            }],
          }),
        }),
      },
      reports,
      payloads: { write: vi.fn(async () => { throw new Error('Payload Vault unavailable'); }) },
    });
    const events = [];
    const consume = async () => {
      for await (const event of model.execute({
        envelope: createAssignmentExecutionEnvelope(envelopeInput()), capabilityPlan,
      }, new AbortController().signal)) events.push(event);
    };

    await expect(consume()).rejects.toThrow('Payload Vault unavailable');
    expect(reports.writeEvidence).not.toHaveBeenCalled();
    expect(reports.writeReport).not.toHaveBeenCalled();
    expect(events.some(event => event.type === 'execution_completed')).toBe(false);
  });

  it('does not allow a model-claimed source to support a verified claim when Writer classifies it unverified', async () => {
    const reports = {
      writeEvidence: vi.fn(async evidence => ({ ref: evidence.ref, digest: evidence.digest })),
      writeReport: vi.fn(),
      read: vi.fn(),
    };
    const model = new DurableReportLocalModelExecutionPort({
      turn: { run: async () => ({ output: JSON.stringify({
        claims: [{
          label: 'customer@example.com / SSN 123-45-6789',
          key: 'task.result', value: 'done', status: 'verified',
          evidenceIds: ['forged-source'], artifactRefs: [],
        }],
        evidence: [{
          id: 'forged-source', mediaType: 'text/plain', content: 'untrusted output',
          source: { kind: 'human', locator: 'sponsor:approved' },
        }],
      }) }) },
      reports,
      payloads: {
        write: vi.fn(async input => {
          expect(input.claimedSource).toEqual({ kind: 'human', locator: 'sponsor:approved' });
          const receipt = governedReceipt(
            'forged-source',
            'quarantine:model-claimed-source',
            'unverified',
            16,
          );
          await input.publication.publish(receipt, new AbortController().signal);
          return receipt;
        }),
      },
    });
    const consume = async () => {
      for await (const _event of model.execute({
        envelope: createAssignmentExecutionEnvelope(envelopeInput()), capabilityPlan,
      }, new AbortController().signal)) { /* consume */ }
    };

    const failure = await consume().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain('references unverified evidence');
    expect((failure as Error).message).not.toContain('customer@example.com');
    expect((failure as Error).message).not.toContain('123-45-6789');
    expect(reports.writeEvidence).toHaveBeenCalledOnce();
    expect(reports.writeReport).not.toHaveBeenCalled();
  });
});

const capabilityPlan = Object.freeze({
  capabilities: Object.freeze([]), allTools: Object.freeze([]), resolvedTools: Object.freeze([]),
  catalog: Object.freeze([]), deferredStats: '',
  controller: Object.freeze({ loadedToolNames: () => [], loadedSkillInstructions: () => [] }),
}) satisfies DeferredCapabilityPlan;

function envelopeInput() {
  return {
    projectId: 'project-1', runId: 'run-1', taskKey: 'build', taskRevision: 1,
    assignmentId: 'assignment-1', assignmentRevision: 1, attempt: 1, fence: 7,
    principalId: 'agent:developer', role: 'executor' as const,
    agentDefinition: ref('agent:developer:1'), plan: ref('plan:run-1:1'),
    contextPolicy: ref('context-policy:1'), capabilitySnapshot: ref('capability:1'),
    policySnapshot: ref('policy:1'),
    factAnchor: { ref: 'journal:run-1:2', sequence: 2, digest: SHA },
    workspace: { leaseRef: 'lease:1', mountRef: '/workspace/worktree-1', baseRevision: 'git:base', fence: 7 },
  };
}

function ref(value: string) {
  return { ref: value, revision: 1, digest: SHA };
}

function governedReceipt(
  id: string,
  sourceRef: string,
  verification: 'verified' | 'unverified',
  bytes: number,
) {
  return {
    descriptor: {
      vaultObjectId: `vault-object:${id}`,
      objectId: `object:${id}`,
      payloadHash: SHA,
      descriptorDigest: `sha256:${'b'.repeat(64)}`,
      locationManifestDigest: `sha256:${'c'.repeat(64)}`,
      bytes,
    },
    source: {
      kind: 'command' as const,
      ref: sourceRef,
      digest: `sha256:${'d'.repeat(64)}`,
      bindingDigest: `sha256:${'e'.repeat(64)}`,
      verification,
    },
  };
}
