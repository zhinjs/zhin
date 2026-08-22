import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import {
  createWorkroomRemoteDispatchOutboxItem,
  digestRemoteCallbackPollSnapshot,
  WORKROOM_A2A_EXTENSION_URI,
} from '@zhin.js/agent';
import { WorkroomA2aAuthRegistry } from '../src/workroom-auth-registry.js';
import { WorkroomA2aHttpRemoteTransport } from '../src/workroom-remote-transport.js';
import { remoteDisclosureFixture } from '../../../im/agent/tests/workroom/remote-disclosure-fixture.js';

const CARD = `sha256:${'a'.repeat(64)}`;
const EXTENSION = `sha256:${createHash('sha256').update(WORKROOM_A2A_EXTENSION_URI).digest('hex')}`;

describe('WorkroomA2aHttpRemoteTransport', () => {
  it('dispatches an exact persisted envelope with callback authority and polls a typed snapshot', async () => {
    const requests: Array<{
      url: string;
      address: string;
      body: unknown;
      authorization: string | undefined;
    }> = [];
    const network = {
      resolve: vi.fn(async () => [{ address: '93.184.216.34', family: 4 as const }]),
      request: vi.fn(async (input: {
        url: URL;
        address: string;
        headers: Readonly<Record<string, string>>;
        body: string;
      }) => {
      const url = input.url.toString();
      const body = JSON.parse(input.body) as Record<string, unknown>;
      requests.push({
        url,
        address: input.address,
        body,
        authorization: input.headers.authorization,
      });
      if (url.endsWith('/dispatch')) {
        return Response.json({
          version: 1,
          receiptId: 'receipt-1',
          remoteTaskId: 'remote-task-1',
          remoteContextId: 'remote-context-1',
        }, { status: 202 });
      }
      const snapshotInput = {
        version: 1 as const,
        endpointId: 'remote-primary',
        cardDigest: CARD,
        authBindingId: 'auth-primary',
        linkId: 'link-1',
        fromCursor: 0,
        snapshotCursor: 0,
        polledAt: 10,
        callbacks: [],
      };
      return Response.json({
        ...snapshotInput,
        digest: digestRemoteCallbackPollSnapshot(snapshotInput),
      });
      }),
    };
    const authRegistry = new WorkroomA2aAuthRegistry({
      generation: 4,
      bindings: [{
        endpointId: 'remote-primary',
        tenantId: 'tenant-1',
        cardDigest: CARD,
        authBindingId: 'auth-primary',
        trustDomain: 'remote.example',
        extensionDigest: EXTENSION,
        credentialId: 'remote-primary-callback',
        credential: { source: 'config', value: 'callback-secret' },
        enabled: true,
      }],
    });
    const transport = new WorkroomA2aHttpRemoteTransport({
      authRegistry,
      callbackUrl: 'https://local.example/workroom-a2a/callback',
      bindings: [{
        endpointId: 'remote-primary',
        cardDigest: CARD,
        authBindingId: 'auth-primary',
        dispatchUrl: 'https://remote.example/workroom-a2a/dispatch',
        pollUrl: 'https://remote.example/workroom-a2a/poll',
        credential: { source: 'config', value: 'remote-secret' },
        authority: {
          workroomExtension: WORKROOM_A2A_EXTENSION_URI,
          idempotentDispatch: true,
          typedCompletionEnvelope: true,
          workspaceProviders: ['github_pull_request'],
        },
        enabled: true,
      }],
      network,
    });
    const item = createWorkroomRemoteDispatchOutboxItem(dispatchInput());

    expect(transport.resolve('remote-primary')).toMatchObject({
      generation: 4,
      endpoint: {
        id: 'remote-primary', owner: 'tenant-1', cardDigest: CARD,
        authBindingId: 'auth-primary', workroomExtension: WORKROOM_A2A_EXTENSION_URI,
        idempotentDispatch: true, typedCompletionEnvelope: true,
        workspaceProviders: ['github_pull_request'],
      },
    });

    await expect(transport.dispatch(
      item, new AbortController().signal, new TextEncoder().encode('governed body'),
    )).resolves.toEqual({
      outcome: 'delivered',
      receiptId: 'receipt-1',
      remoteTaskId: 'remote-task-1',
      remoteContextId: 'remote-context-1',
    });
    const pollRequest = {
      version: 1 as const,
      linkId: 'link-1',
      endpointId: 'remote-primary',
      cardDigest: CARD,
      authBindingId: 'auth-primary',
      remoteTaskId: 'remote-task-1',
      remoteContextId: 'remote-context-1',
      fromCursor: 0,
      reconcileDeadline: 20,
    };
    await expect(transport.poll(pollRequest, new AbortController().signal))
      .resolves.toMatchObject({ linkId: 'link-1', snapshotCursor: 0 });

    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({
      url: 'https://remote.example/workroom-a2a/dispatch',
      address: '93.184.216.34',
      authorization: 'Bearer remote-secret',
      body: {
        version: 1,
        callback: {
          url: 'https://local.example/workroom-a2a/callback',
          authorization: 'Bearer callback-secret',
        },
        item,
      },
    });
    expect(requests[1]).toMatchObject({
      url: 'https://remote.example/workroom-a2a/poll',
      address: '93.184.216.34',
      authorization: 'Bearer remote-secret',
      body: pollRequest,
    });
  });

  it('fails closed before I/O when endpoint authority drifts', async () => {
    const network = {
      resolve: vi.fn(async () => [{ address: '93.184.216.34', family: 4 as const }]),
      request: vi.fn(),
    };
    const authRegistry = new WorkroomA2aAuthRegistry({
      generation: 1,
      bindings: [{
        endpointId: 'remote-primary', tenantId: 'tenant-1', cardDigest: CARD,
        authBindingId: 'auth-primary', trustDomain: 'remote.example',
        extensionDigest: EXTENSION, credentialId: 'callback',
        credential: { source: 'config', value: 'callback-secret' }, enabled: true,
      }],
    });
    const transport = new WorkroomA2aHttpRemoteTransport({
      authRegistry,
      callbackUrl: 'https://local.example/workroom-a2a/callback',
      bindings: [{
        endpointId: 'remote-primary', cardDigest: CARD, authBindingId: 'auth-primary',
        dispatchUrl: 'https://remote.example/dispatch', pollUrl: 'https://remote.example/poll',
        credential: { source: 'config', value: 'remote-secret' }, enabled: true,
      }],
      network,
    });
    const item = createWorkroomRemoteDispatchOutboxItem({
      ...dispatchInput(),
      endpoint: { ...dispatchInput().endpoint, authBindingId: 'forged-auth' },
    });

    await expect(transport.dispatch(
      item, new AbortController().signal, new TextEncoder().encode('governed body'),
    ))
      .rejects.toThrow('endpoint authority');
    expect(network.resolve).not.toHaveBeenCalled();
    expect(network.request).not.toHaveBeenCalled();
  });

  it('pins the approved DNS result and rejects any private or metadata answer before I/O', async () => {
    const network = {
      resolve: vi.fn(async () => [
        { address: '93.184.216.34', family: 4 as const },
        { address: '169.254.169.254', family: 4 as const },
      ]),
      request: vi.fn(),
    };
    const authRegistry = new WorkroomA2aAuthRegistry({
      generation: 1,
      bindings: [{
        endpointId: 'remote-primary', tenantId: 'tenant-1', cardDigest: CARD,
        authBindingId: 'auth-primary', trustDomain: 'remote.example',
        extensionDigest: EXTENSION, credentialId: 'callback',
        credential: { source: 'config', value: 'callback-secret' }, enabled: true,
      }],
    });
    const transport = new WorkroomA2aHttpRemoteTransport({
      authRegistry,
      callbackUrl: 'https://local.example/workroom-a2a/callback',
      bindings: [{
        endpointId: 'remote-primary', cardDigest: CARD, authBindingId: 'auth-primary',
        dispatchUrl: 'https://remote.example/dispatch', pollUrl: 'https://remote.example/poll',
        credential: { source: 'config', value: 'remote-secret' }, enabled: true,
      }],
      network,
    });

    await expect(transport.dispatch(
      createWorkroomRemoteDispatchOutboxItem(dispatchInput()),
      new AbortController().signal,
      new TextEncoder().encode('governed body'),
    )).rejects.toThrow('private or dangerous');
    expect(network.request).not.toHaveBeenCalled();
  });

  it('joins transport URLs to the exact callback Card/Auth trust domain before I/O', () => {
    const authRegistry = new WorkroomA2aAuthRegistry({
      generation: 1,
      bindings: [{
        endpointId: 'remote-primary', tenantId: 'tenant-1', cardDigest: CARD,
        authBindingId: 'auth-primary', trustDomain: 'remote.example',
        extensionDigest: EXTENSION, credentialId: 'callback',
        credential: { source: 'config', value: 'callback-secret' }, enabled: true,
      }],
    });
    const network = { resolve: vi.fn(), request: vi.fn() };

    expect(() => new WorkroomA2aHttpRemoteTransport({
      authRegistry,
      callbackUrl: 'https://local.example/workroom-a2a/callback',
      bindings: [{
        endpointId: 'remote-primary', cardDigest: CARD, authBindingId: 'auth-primary',
        dispatchUrl: 'https://attacker.example/dispatch',
        pollUrl: 'https://remote.example/poll',
        credential: { source: 'config', value: 'remote-secret' }, enabled: true,
      }],
      network,
    })).toThrow('outside the trusted destination');
    expect(network.resolve).not.toHaveBeenCalled();
    expect(network.request).not.toHaveBeenCalled();
  });
});

function dispatchInput() {
  return {
    projectId: 'project-1', runId: 'run-1', taskKey: 'task-1', taskRevision: 1,
    assignmentId: 'assignment-1', attempt: 1, fence: 1,
    endpoint: {
      id: 'remote-primary', owner: 'remote-agent', cardDigest: CARD,
      authBindingId: 'auth-primary', workroomExtension: WORKROOM_A2A_EXTENSION_URI,
      idempotentDispatch: true, typedCompletionEnvelope: true,
      workspaceProviders: ['github_pull_request'],
    },
    contextView: { ref: 'context-1', hash: CARD },
    acceptanceContract: { ref: 'acceptance-1', hash: CARD },
    capabilitySnapshot: { ref: 'capability-1', hash: CARD, grantRef: 'grant-1' },
    disclosureManifest: remoteDisclosureFixture({
      endpointId: 'remote-primary', principalId: 'remote-agent',
      sourceRef: 'context-1', sourceDigest: CARD,
    }),
    workspace: {
      provider: 'github_pull_request' as const,
      repositoryId: 'repo-1', integrationBindingId: 'github-1', baseSha: 'a'.repeat(40),
      targetRef: 'refs/heads/main', branchRef: 'refs/heads/agent/attempt-1',
      pathScope: ['src'], mode: 'branch_only' as const, fence: 1,
    },
  };
}
