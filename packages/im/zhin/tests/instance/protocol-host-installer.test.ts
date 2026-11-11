import { describe, expect, it, vi } from 'vitest';
import {
  DisposeStack,
  GenerationHandoffStack,
  Scope,
  SnapshotStore,
  rootPluginId,
} from '@zhin.js/plugin-runtime';
import { httpHostToken } from '@zhin.js/host-http';
import { agentHostToken } from '@zhin.js/agent/runtime';
import type { RootResourceContext } from '@zhin.js/runtime';
import {
  a2aMailboxTransportToken,
  installProtocolHosts,
} from '../../src/instance/protocol-host-installer.js';

describe('Protocol Host composition', () => {
  it('mounts the A2A remote mailbox transport when a2a.mailbox is configured', async () => {
    const resources = new Scope(rootPluginId());
    const lifecycle = new DisposeStack();
    const handoff = new GenerationHandoffStack();
    const routes: string[] = [];
    const unregisterRoute = vi.fn();

    resources.provide(httpHostToken, {
      route: (_method: string, path: string) => {
        routes.push(path);
        return unregisterRoute;
      },
    } as never);
    resources.provide(agentHostToken, {
      protocol: { listBindings: () => [], execute: vi.fn() },
      introspection: { listMcpServers: () => [] },
      console: {} as never,
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
          mailbox: {
            enabled: true,
            path: '/a2a/mailbox',
            peers: [
              {
                name: 'remote-coder',
                url: 'https://remote.example/a2a/mailbox',
                secret: 'shared-secret',
              },
            ],
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
    expect(routes).toContain('/a2a/mailbox');
    expect(resources.has(a2aMailboxTransportToken)).toBe(true);
    expect(resources.use(a2aMailboxTransportToken).hasPeer('remote-coder')).toBe(true);

    await lifecycle.dispose();
    expect(unregisterRoute).toHaveBeenCalledTimes(1);
    await snapshots.close();
  });

  it('rejects removed a2a.workroomCallbacks and a2a.workroomRemoteExecutors with a migration error', async () => {
    const resources = new Scope(rootPluginId());
    const lifecycle = new DisposeStack();
    const handoff = new GenerationHandoffStack();
    resources.provide(httpHostToken, {
      route: () => () => undefined,
    } as never);

    const snapshots = new SnapshotStore({
      root: rootPluginId(),
      tree: new Map(),
      config: new Map(),
      resources: new Map(),
      capabilities: new Map(),
      projections: new Map(),
    });

    await expect(
      installProtocolHosts({
        config: {
          a2a: {
            enabled: false,
            workroomCallbacks: { enabled: true },
          } as never,
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
      } as RootResourceContext),
    ).rejects.toThrow('a2a.mailbox');

    await snapshots.close();
  });
});
