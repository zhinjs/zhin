import { describe, expect, it } from 'vitest';
import {
  WORKROOM_A2A_EXTENSION_URI,
  assertWorkroomRemoteDispatchRetry,
  createWorkroomRemoteDispatchOutboxItem,
  type WorkroomRemoteDispatchInput,
} from '../../src/workroom/remote-dispatch.js';

describe('Workroom remote dispatch outbox boundary', () => {
  it('materializes stable transport identity and digest for replay', () => {
    const first = createWorkroomRemoteDispatchOutboxItem(input());
    const replayed = createWorkroomRemoteDispatchOutboxItem(input());

    expect(replayed).toEqual(first);
    expect(first.dispatchId).toContain('assignment-1:1:7');
    expect(first.messageId).toContain('assignment-1:1:7');
    expect(first.envelopeDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(Object.isFrozen(first.envelope.workspace.pathScope)).toBe(true);
    expect(() => assertWorkroomRemoteDispatchRetry(first, replayed)).not.toThrow();
  });

  it('rejects incompatible endpoints and retry payload drift', () => {
    expect(() => createWorkroomRemoteDispatchOutboxItem(input({
      endpoint: { ...input().endpoint, idempotentDispatch: false },
    }))).toThrow('cannot claim');

    const persisted = createWorkroomRemoteDispatchOutboxItem(input());
    const drifted = {
      ...persisted,
      envelope: { ...persisted.envelope, contextView: { ref: 'view:other', hash: 'sha256:view' } },
    } as typeof persisted;
    expect(() => assertWorkroomRemoteDispatchRetry(persisted, drifted)).toThrow('digest');
  });
});

function input(overrides: Partial<WorkroomRemoteDispatchInput> = {}): WorkroomRemoteDispatchInput {
  return {
    projectId: 'project-1',
    runId: 'run-1',
    taskKey: 'build',
    taskRevision: 2,
    assignmentId: 'assignment-1',
    attempt: 1,
    fence: 7,
    endpoint: {
      id: 'remote-main',
      owner: 'integration-plugin',
      cardDigest: 'sha256:card',
      authBindingId: 'auth:a2a',
      workroomExtension: WORKROOM_A2A_EXTENSION_URI,
      idempotentDispatch: true,
      typedCompletionEnvelope: true,
      workspaceProviders: ['github_pull_request'],
    },
    contextView: { ref: 'view:1', hash: 'sha256:view' },
    acceptanceContract: { ref: 'acceptance:1', hash: 'sha256:acceptance' },
    capabilitySnapshot: { ref: 'capability:1', hash: 'sha256:capability', grantRef: 'grant:1' },
    disclosureManifest: { ref: 'disclosure:1', hash: 'sha256:disclosure' },
    workspace: {
      provider: 'github_pull_request',
      repositoryId: 'github:org/repo',
      integrationBindingId: 'github-app:1',
      baseSha: 'a'.repeat(40),
      targetRef: 'refs/heads/main',
      branchRef: 'refs/heads/workroom/assignment-1',
      pathScope: ['packages/im/agent'],
      mode: 'branch_and_pr',
      fence: 7,
    },
    ...overrides,
  };
}
