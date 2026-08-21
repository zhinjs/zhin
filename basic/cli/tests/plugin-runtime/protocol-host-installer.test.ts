import { describe, expect, it, vi } from 'vitest';
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
  workroomRemoteCallbackRuntimeToken,
} from '@zhin.js/agent/runtime';
import type { RootResourceContext } from '@zhin.js/runtime';
import { installProtocolHosts } from '../../src/plugin-runtime/protocol-host-installer.js';

describe('Protocol Host composition', () => {
  it('defers durable callback recovery to generation handoff activation', async () => {
    const resources = new Scope(rootPluginId());
    const lifecycle = new DisposeStack();
    const handoff = new GenerationHandoffStack();
    const routes: string[] = [];
    const listRegistered = vi.fn(async () => []);
    const createApplication = vi.fn(() => ({
      runOnce: vi.fn(async () => ({ status: 'noop', reason: 'inbox_not_registered' })),
    }));
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
    resources.provide(workroomRemoteCallbackRuntimeToken, {
      linkRegistry: { listRegistered } as never,
      inboxRepository: {} as never,
      createApplication,
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
              trustDomain: 'example.test',
              extensionDigest: digest('extension'),
              credentialId: 'credential-1',
              credential: { source: 'config', value: 'callback-secret' },
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
      resources,
      lifecycle,
      handoff,
    } as RootResourceContext);

    expect(routes).not.toContain('/a2a/*');
    expect(routes).toContain('/workroom-a2a/callback');
    expect(createApplication).toHaveBeenCalledWith(32);
    expect(listRegistered).not.toHaveBeenCalled();

    const activation = handoff.seal();
    await activation?.activateNext(new AbortController().signal);
    expect(listRegistered).toHaveBeenCalledTimes(1);

    await lifecycle.dispose();
  });
});

function digest(seed: string): string {
  return `sha256:${(seed === 'card' ? 'a' : 'b').repeat(64)}`;
}
