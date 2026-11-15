import type { ConfigApplicationGroup, ConfigApplicationResult, RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import type { GatewayToInstanceMessage, InstanceToGatewayMessage } from '@zhin.js/host-http/bridge';
import { applyPluginToggle, installPluginApplyChannel, PLUGIN_APPLY_FEATURE, type PluginApplyRuntime } from '../../src/instance/plugin-apply-channel.js';

/** zhinjs/zhin#1250: the instance answers the gateway's `plugins.apply` from its committed generation. */
function runtime(options: { instances: string[]; groups?: ConfigApplicationGroup[]; error?: Error; after?: string[] }): PluginApplyRuntime & { revisions: (string | undefined)[] } {
  let instances = options.instances;
  let generation = 1;
  const revisions: (string | undefined)[] = [];
  return {
    revisions,
    get snapshot() {
      const tree = new Map<string, unknown>([['root', { id: 'root', instanceKey: 'root', children: [] }]]);
      for (const key of instances) tree.set(`root/${key}`, { id: `root/${key}`, instanceKey: key, parent: 'root', children: [] });
      return { generation, root: 'root', tree } as unknown as RuntimeSnapshot;
    },
    async applyConfiguration(revision) {
      revisions.push(revision);
      if (options.error) throw options.error;
      if (options.after) { instances = options.after; generation += 1; }
      return { operationId: 'op', sourceRevision: revision ?? '', saved: true, generation, applicationRevision: 1, groups: options.groups ?? [] } satisfies ConfigApplicationResult;
    },
  };
}

const group = (id: string, status: ConfigApplicationGroup['status'], paths: string[][], reasonCode?: string): ConfigApplicationGroup =>
  ({ id, paths, effect: 'restart-process', status, dependsOn: [], ...(reasonCode ? { reasonCode } : {}) });

describe('plugins.apply (instance side)', () => {
  it('reports applied once the committed tree has (or no longer has) the instance', async () => {
    const disable = runtime({ instances: ['game', 'keeper'], after: ['keeper'] });
    await expect(applyPluginToggle(disable, { instanceKey: 'game', enabled: false, revision: 'r2' })).resolves.toEqual({ outcome: 'applied', generation: 2 });
    expect(disable.revisions).toEqual(['r2']);
    const enable = runtime({ instances: ['keeper'], after: ['keeper', 'game'] });
    await expect(applyPluginToggle(enable, { instanceKey: 'game', enabled: true, revision: 'r3' })).resolves.toMatchObject({ outcome: 'applied' });
  });

  it('reports restart-required with the Runtime reason codes when the change was kept for a restart', async () => {
    const subject = runtime({ instances: ['keeper'], groups: [
      group('plugin-host:game', 'restart-pending', [['game'], ['plugins', 'game']], 'host-owned-plugin'),
      group('host:http', 'restart-pending', [['http']], 'host-update-unavailable'),
    ] });
    await expect(applyPluginToggle(subject, { instanceKey: 'game', enabled: true, revision: 'r' }))
      .resolves.toEqual({ outcome: 'restart-required', generation: 1, reasons: ['host-owned-plugin'] });
  });

  it('reports failed for a rejected transaction or a state that did not change', async () => {
    const onError = vi.fn();
    await expect(applyPluginToggle(runtime({ instances: [], error: new Error('game setup failed') }), { instanceKey: 'game', enabled: true, revision: 'r' }, onError))
      .resolves.toMatchObject({ outcome: 'failed', generation: 1, message: 'Error: game setup failed' });
    expect(onError).toHaveBeenCalledOnce();
    await expect(applyPluginToggle(runtime({ instances: ['game'] }), { instanceKey: 'game', enabled: false, revision: 'r' }))
      .resolves.toMatchObject({ outcome: 'failed', message: expect.stringContaining('still enabled') });
  });

  it('answers each request on the channel with its id, one at a time', async () => {
    const listeners: ((message: GatewayToInstanceMessage) => void)[] = [];
    const sent: InstanceToGatewayMessage[] = [];
    const subject = runtime({ instances: ['game'], after: [] });
    installPluginApplyChannel({ channel: { onMessage: listener => { listeners.push(listener); return () => undefined; }, send: message => { sent.push(message); } }, runtime: subject });
    listeners[0]!({ type: 'shutdown', payload: { reason: 'stop', budgetMs: 1 } });
    listeners[0]!({ type: 'plugins.apply', id: 'a1', payload: { instanceKey: 'game', enabled: false, revision: 'r9' } });
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({ type: 'plugins.apply.result', id: 'a1', payload: { outcome: 'applied', generation: 2 } });
    expect(PLUGIN_APPLY_FEATURE).toBe('plugins.apply');
  });
});
