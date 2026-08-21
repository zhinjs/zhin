import { describe, expect, it, vi } from 'vitest';
import { Scope, rootPluginId } from '@zhin.js/plugin-runtime';
import {
  createGenerationWorkroomRemoteExecutorPort,
  workroomRemoteExecutorToken,
} from '../../src/plugin-runtime/workroom-remote-executor.js';
import {
  WORKROOM_A2A_EXTENSION_URI,
  createWorkroomRemoteDispatchOutboxItem,
  type WorkroomRemoteDispatchOutboxItem,
} from '../../src/workroom/remote-dispatch.js';
import { remoteDisclosureFixture } from '../workroom/remote-disclosure-fixture.js';

describe('generation Workroom remote executor', () => {
  it('fails closed without a current provider and resolves after generation provision', async () => {
    const scope = new Scope(rootPluginId());
    const proxy = createGenerationWorkroomRemoteExecutorPort(() =>
      scope.has(workroomRemoteExecutorToken) ? scope.use(workroomRemoteExecutorToken) : undefined);
    const item = dispatchItem();
    const signal = new AbortController().signal;

    await expect(proxy.dispatch(item, signal)).rejects.toThrow('not installed');

    const dispatch = vi.fn(async (received: WorkroomRemoteDispatchOutboxItem) => Object.freeze({
      outcome: 'delivered' as const,
      receiptId: `receipt:${received.dispatchId}`,
      remoteTaskId: 'remote-task-1',
    }));
    scope.provide(workroomRemoteExecutorToken, { dispatch });

    await expect(proxy.dispatch(item, signal)).resolves.toEqual({
      outcome: 'delivered',
      receiptId: `receipt:${item.dispatchId}`,
      remoteTaskId: 'remote-task-1',
    });
    expect(dispatch).toHaveBeenCalledWith(item, signal);
    await expect(proxy.retry(item, item, signal)).resolves.toMatchObject({
      outcome: 'delivered', receiptId: `receipt:${item.dispatchId}`,
    });

    const drifted = { ...item, envelopeDigest: 'sha256:other' };
    await expect(proxy.retry(item, drifted, signal)).rejects.toThrow('digest');
  });

  it.each([
    { remoteTaskId: '' },
    { remoteTaskId: { forged: true } },
    { remoteContextId: '   ' },
    { remoteContextId: 42 },
    { reason: '' },
    { reason: ['not', 'text'] },
  ])('rejects malformed optional transport observation fields: %j', async (optional) => {
    const proxy = createGenerationWorkroomRemoteExecutorPort(() => ({
      dispatch: async () => ({
        outcome: 'delivered',
        receiptId: 'receipt:1',
        ...optional,
      } as never),
    }));

    await expect(proxy.dispatch(dispatchItem(), new AbortController().signal))
      .rejects.toThrow('invalid transport observation');
  });
});

function dispatchItem(): WorkroomRemoteDispatchOutboxItem {
  return createWorkroomRemoteDispatchOutboxItem({
    projectId: 'project-1', runId: 'run-1', taskKey: 'build', taskRevision: 1,
    assignmentId: 'assignment-1', attempt: 1, fence: 1,
    endpoint: {
      id: 'remote', owner: 'integration', cardDigest: 'sha256:card', authBindingId: 'auth:1',
      workroomExtension: WORKROOM_A2A_EXTENSION_URI,
      idempotentDispatch: true, typedCompletionEnvelope: true,
      workspaceProviders: ['github_pull_request'],
    },
    contextView: { ref: 'view:1', hash: 'sha256:view' },
    acceptanceContract: { ref: 'contract:1', hash: 'sha256:contract' },
    capabilitySnapshot: { ref: 'capability:1', hash: 'sha256:capability', grantRef: 'grant:1' },
    disclosureManifest: remoteDisclosureFixture({
      endpointId: 'remote', sourceRef: 'view:1', sourceDigest: 'sha256:view',
    }),
    workspace: {
      provider: 'github_pull_request', repositoryId: 'github:org/repo',
      integrationBindingId: 'github-app:1', baseSha: 'a'.repeat(40),
      targetRef: 'refs/heads/main', branchRef: 'refs/heads/workroom/assignment-1',
      pathScope: ['packages/im/agent'], mode: 'branch_and_pr', fence: 1,
    },
  });
}
