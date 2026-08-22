import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import {
  DisposeStack,
  GenerationHandoffStack,
  Scope,
  SnapshotStore,
  rootPluginId,
} from '@zhin.js/plugin-runtime';
import { httpHostToken } from '@zhin.js/host-http';
import {
  agentHostToken,
  remoteAssignmentDispatchServiceToken,
  remoteAssignmentDispatchSchedulerToken,
  remoteAssignmentDispatchCommandServiceToken,
  workroomRemoteAssignmentAuthorityToken,
  workroomRemoteCallbackRuntimeToken,
  workroomRemoteExecutorToken,
  workroomSchedulerAssignmentRouteRegistryToken,
  workroomAssignmentAuthorityGrantRepositoryToken,
  workroomAssignmentGrantClaimPreviewToken,
} from '@zhin.js/agent/runtime';
import {
  MemoryAssignmentAuthorityGrantRepository,
  WORKROOM_A2A_EXTENSION_URI,
} from '@zhin.js/agent';
import type { RootResourceContext } from '@zhin.js/runtime';
import { installProtocolHosts } from '../../src/plugin-runtime/protocol-host-installer.js';

describe('Protocol Host composition', () => {
  it.each([true, false])(
    'defers recovery and publishes claim producer only with Profile authority: %s',
    async (hasRemoteAuthority) => {
    const resources = new Scope(rootPluginId());
    const lifecycle = new DisposeStack();
    const handoff = new GenerationHandoffStack();
    const routes: string[] = [];
    const listRegistered = vi.fn(async () => []);
    const createApplication = vi.fn(() => ({
      runOnce: vi.fn(async () => ({ status: 'noop', reason: 'inbox_not_registered' })),
    }));
    const createDispatchService = vi.fn(() => ({ admit: vi.fn(), runOnce: vi.fn() }));
    const dispatchScheduler = { start: vi.fn(), stop: vi.fn(async () => undefined) };
    const createDispatchScheduler = vi.fn(() => dispatchScheduler);
    const dispatchCommand = {
      issue: vi.fn(),
      recover: vi.fn(async () => [{ operationId: 'operation-1', status: 'admitted' }]),
    };
    const createDispatchCommandService = vi.fn(() => dispatchCommand);
    const unregisterRoute = vi.fn();
    const registerRoute = vi.fn(() => unregisterRoute);
    resources.provide(httpHostToken, {
      route: (_method: string, path: string) => {
        routes.push(path);
        return () => undefined;
      },
    } as never);
    resources.provide(agentHostToken, {
      protocol: { listBindings: () => [], execute: vi.fn() },
      introspection: { listTools: () => [], listMcpServers: () => [] },
      console: {} as never,
    });
    resources.provide(workroomSchedulerAssignmentRouteRegistryToken, {
      generation: 1,
      register: registerRoute,
      resolve: vi.fn(),
    } as never);
    if (hasRemoteAuthority) {
      resources.provide(workroomRemoteAssignmentAuthorityToken, { resolve: vi.fn() });
      resources.provide(
        workroomAssignmentAuthorityGrantRepositoryToken,
        new MemoryAssignmentAuthorityGrantRepository(),
      );
      resources.provide(workroomAssignmentGrantClaimPreviewToken, {
        resolve: vi.fn(async request => ({
          generation: 1,
          projectId: request.projectId,
          runId: request.runId,
          taskKey: request.taskKey,
          taskRevision: 1,
          assignmentId: 'assignment-1',
          assignmentRevision: 1,
          attempt: 1,
          fence: 1,
          operationId: request.operationId,
          agentDefinitionId: request.agentDefinitionId,
          endpointId: request.endpointId,
          profileRevisionId: 'profile-1',
          profileDigest: digest('profile'),
          catalogRevision: 'c'.repeat(64),
          catalogBindingDigest: digest('catalog'),
          role: 'executor' as const,
          plan: { ref: 'plan-1', revision: 1, digest: digest('plan') },
          taskCapabilityRequirements: { tools: [], skills: [], integrations: [], authorities: [] },
          factAnchor: { ref: 'journal-1', sequence: 1, digest: digest('journal') },
        })),
      });
    }
    resources.provide(workroomRemoteCallbackRuntimeToken, {
      linkRegistry: { listRegistered } as never,
      inboxRepository: {} as never,
      createApplication,
      createDispatchService,
      createDispatchScheduler,
      createDispatchCommandService,
    });
    const snapshots = new SnapshotStore({
      root: rootPluginId(),
      tree: new Map(),
      config: new Map(),
      resources: new Map(),
      capabilities: new Map(),
      projections: new Map(),
    });

    await installProtocolHosts({
      config: {
        a2a: {
          enabled: false,
          workroomCallbacks: {
            enabled: true,
            bindings: [{
              endpointId: 'endpoint-1',
              tenantId: 'tenant-1',
              cardDigest: digest('card'),
              authBindingId: 'auth-1',
              trustDomain: 'remote.example',
              extensionDigest: extensionDigest(),
              credentialId: 'credential-1',
              credential: { source: 'config', value: 'callback-secret' },
              enabled: true,
            }],
          },
          workroomRemoteExecutors: {
            enabled: true,
            bindings: [{
              endpointId: 'endpoint-1',
              cardDigest: digest('card'),
              authBindingId: 'auth-1',
              dispatchUrl: 'https://remote.example/workroom-a2a/dispatch',
              pollUrl: 'https://remote.example/workroom-a2a/poll',
              credential: { source: 'config', value: 'remote-secret' },
              authority: {
                workroomExtension: WORKROOM_A2A_EXTENSION_URI,
                idempotentDispatch: true,
                typedCompletionEnvelope: true,
                workspaceProviders: ['workspace://remote'],
              },
              enabled: true,
            }],
          },
        },
      },
      http: { host: '127.0.0.1', port: 0 },
      snapshots,
      production: false,
      projectRoot: '/tmp/zhin-protocol-host-test',
    })({
      generation: 1,
      resources,
      lifecycle,
      handoff,
    } as RootResourceContext);

    expect(routes).not.toContain('/a2a/*');
    expect(routes).toContain('/workroom-a2a/callback');
    expect(createApplication).toHaveBeenCalledWith(32, expect.any(Object));
    expect(createDispatchService).toHaveBeenCalledWith(expect.any(Object));
    expect(createDispatchScheduler).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ ownerId: 'generation:1' }),
    );
    expect(resources.has(workroomRemoteExecutorToken)).toBe(true);
    expect(resources.has(remoteAssignmentDispatchServiceToken)).toBe(true);
    expect(resources.has(remoteAssignmentDispatchSchedulerToken)).toBe(true);
    expect(resources.has(remoteAssignmentDispatchCommandServiceToken)).toBe(hasRemoteAuthority);
    expect(registerRoute).toHaveBeenCalledTimes(hasRemoteAuthority ? 1 : 0);
    if (hasRemoteAuthority) {
      expect(registerRoute).toHaveBeenCalledWith(expect.objectContaining({
        providerId: 'remote-a2a-bindings:generation:1',
        generation: 1,
      }));
      const provider = registerRoute.mock.calls[0]![0];
      await expect(provider.resolve({
        decision: { projectId: 'project-1', role: 'executor' },
        catalog: {
          definitions: {
            'project-1': {
              members: [{ agent: 'developer', role: 'executor' }],
            },
          },
        },
      })).resolves.toBeNull();
      await expect(provider.resolve({
        decision: { projectId: 'project-1', role: 'executor' },
        catalog: {
          definitions: {
            'project-1': {
              members: [{
                agent: 'developer', role: 'executor',
                assignmentRoute: { kind: 'remote', endpointId: 'endpoint-1' },
              }],
            },
          },
        },
      })).resolves.toEqual(expect.objectContaining({
        kind: 'remote', agentDefinitionId: 'developer', endpointId: 'endpoint-1',
      }));
    }
    if (hasRemoteAuthority) {
      const request = {
        operationId: 'operation-live', projectId: 'project-1', runId: 'run-1',
        taskKey: 'build', agentDefinitionId: 'developer', endpointId: 'endpoint-1',
      };
      await expect(resources.use(remoteAssignmentDispatchCommandServiceToken).issue(request))
        .rejects.toThrow('durably blocked');
      expect(dispatchCommand.issue).not.toHaveBeenCalled();
    }
    expect(listRegistered).not.toHaveBeenCalled();
    expect(dispatchScheduler.start).not.toHaveBeenCalled();
    expect(dispatchCommand.recover).not.toHaveBeenCalled();

    const activation = handoff.seal();
    await activation?.activateNext(new AbortController().signal);
    expect(listRegistered).toHaveBeenCalledTimes(1);
    expect(dispatchCommand.recover).toHaveBeenCalledTimes(1);
    expect(dispatchScheduler.start).toHaveBeenCalledTimes(1);

    await lifecycle.dispose();
    expect(dispatchScheduler.stop).toHaveBeenCalledTimes(1);
    expect(unregisterRoute).toHaveBeenCalledTimes(hasRemoteAuthority ? 1 : 0);
    },
  );
});

function digest(seed: string): string {
  return `sha256:${(seed === 'card' ? 'a' : 'b').repeat(64)}`;
}

function extensionDigest(): string {
  return `sha256:${createHash('sha256').update(WORKROOM_A2A_EXTENSION_URI).digest('hex')}`;
}
