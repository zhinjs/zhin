import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RootRuntime, type ModuleRuntime } from '@zhin.js/runtime';
import { definePlugin, pluginVerificationToken } from '@zhin.js/plugin-runtime';
import { createConfigDocument } from '@zhin.js/config-file';
import { createConsoleEventHub, createHttpHost, type PluginManagementState, type PluginVerificationPlan, type PluginVerificationResult } from '@zhin.js/host-http';
import { PLUGIN_RPC } from '@zhin.js/console-protocol';
import { registerConsoleRpcRoute } from '../src/plugin-runtime/console/rpc-route.js';
import { ConsoleConfigurationStore } from '../src/plugin-runtime/console/configuration.js';
import { createPluginLifecycleStore, resolvePluginLifecycleFile } from '../src/plugin-runtime/plugin-lifecycle-store.js';
import { PluginManagementWorkflow } from '../src/plugin-management/workflow.js';
import { requestPluginConsole } from '../src/plugin-management/console-client.js';
import { packagesCommand } from '../src/commands/packages.js';
import type { ConsoleRuntime } from '@zhin.js/pagemanager/plugin-runtime';

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});
describe('CLI uses the running Console control plane', () => {
  it('runs status, explicit plan and approved business verification through a real owner and full-scope HTTP endpoint', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'zhin-plugin-console-client-')));
    roots.push(root);
    const manifest = { protocol: 1, type: 'plugin', entry: './plugin.js', platformFeatures: false };
    await mkdir(join(root, 'node_modules/reminder'), { recursive: true });
    await mkdir(join(root, '.zhin'));
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'fixture-root', version: '1.0.0', dependencies: { reminder: '1.0.0' }, zhin: { ...manifest, plugins: [{ package: 'reminder', instanceKey: 'reminder' }] } }));
    await writeFile(join(root, 'plugin.js'), 'export default {};');
    await writeFile(join(root, 'node_modules/reminder/package.json'), JSON.stringify({ name: 'reminder', version: '1.0.0', zhin: manifest }));
    await writeFile(join(root, 'node_modules/reminder/plugin.js'), 'export default {};');
    await writeFile(join(root, 'zhin.config.json'), JSON.stringify({ plugins: { reminder: {} } }));
    const run = vi.fn(async () => {
      const task = join(root, '.zhin/probe.json');
      await writeFile(task, JSON.stringify({ task: 'probe', send: false }));
      const stored = JSON.parse(await readFile(task, 'utf8'));
      await rm(task);
      return { status: stored.send === false ? 'passed' as const : 'failed' as const, summary: 'Local task created/read/cancelled; platform delivery not tested', evidence: ['stored task matches', 'temporary task cancelled'] };
    });
    const files = new Map([
      [join(root, 'plugin.js'), { default: definePlugin({ name: 'root' }) }],
      [join(root, 'node_modules/reminder/plugin.js'), { default: definePlugin({ name: 'reminder', setup({ resources }) { resources.provide(pluginVerificationToken, { checks: () => [{ id: 'local-task', title: 'Local task probe', scope: 'local' as const, effects: ['Create/read/cancel a temporary local task; no IM send'] }], run }); } }) }],
    ]);
    const modules: ModuleRuntime = { async load<T>(file: string) { return files.get(file) as T; }, async close() {} };
    const runtime = new RootRuntime({ projectRoot: root, modules, environment: { name: 'test', mode: 'test', platform: 'node' }, config: { plugins: { reminder: {} } } });
    const http = createHttpHost({ host: '127.0.0.1', port: 0, token: 'fixture-full-token', tokens: [{ token: 'fixture-demo-token', scope: 'demo' }] });
    try {
      await runtime.start();
      const restart = vi.fn();
      const workflow = new PluginManagementWorkflow(root, { snapshots: runtime.snapshots, requestRestart: restart });
      registerConsoleRpcRoute({ http, base: '/api', projectRoot: root, consoleRuntime: { runView: async () => ({ pages: [] }) } as unknown as ConsoleRuntime,
        hub: createConsoleEventHub(), pluginLifecycleFile: resolvePluginLifecycleFile(root), pluginLifecycleStore: createPluginLifecycleStore(),
        configuration: new ConsoleConfigurationStore({ projectRoot: root, document: createConfigDocument(join(root, 'zhin.config.json')) }),
        pluginManagement: workflow, snapshots: runtime.snapshots,
      });
      const address = await http.listen();
      const host = `http://127.0.0.1:${address.port}`;
      vi.stubEnv('ZHIN_CONSOLE_TOKEN', 'fixture-full-token');
      const state = await requestPluginConsole<PluginManagementState>(host, { type: PLUGIN_RPC.INSPECT, instanceKey: 'reminder' });
      expect(state).toMatchObject({ status: 'enabled', published: true, readiness: 'ready', verification: 'available' });
      const output = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        await packagesCommand.parseAsync(['node', 'zhin', 'status', 'reminder', '--live', host]);
        expect(JSON.parse(String(output.mock.calls.at(-1)?.[0]))).toMatchObject({ status: 'enabled', published: true });
      } finally { output.mockRestore(); }
      const plan = await requestPluginConsole<PluginVerificationPlan>(host, { type: PLUGIN_RPC.PLAN_VERIFICATION, instanceKey: 'reminder' });
      expect(plan.checks[0]?.effects).toEqual(['Create/read/cancel a temporary local task; no IM send']);
      expect(run).not.toHaveBeenCalled();
      const result = await requestPluginConsole<PluginVerificationResult>(host, { type: PLUGIN_RPC.VERIFY, instanceKey: 'reminder', checkId: 'local-task', expectedGeneration: plan.generation, expectedProjectRevision: plan.projectRevision, expectedCheckRevision: plan.checkRevision });
      expect(result).toMatchObject({ status: 'passed', scope: 'local', current: true });
      expect(run).toHaveBeenCalledTimes(1);
      vi.stubEnv('ZHIN_CONSOLE_TOKEN', 'fixture-demo-token');
      await expect(requestPluginConsole(host, { type: PLUGIN_RPC.PLAN_VERIFICATION, instanceKey: 'reminder' })).rejects.toThrow();
      await expect(requestPluginConsole(host, { type: PLUGIN_RPC.VERIFY, instanceKey: 'reminder', checkId: 'local-task', expectedGeneration: plan.generation, expectedProjectRevision: plan.projectRevision, expectedCheckRevision: plan.checkRevision })).rejects.toThrow();
      expect(run).toHaveBeenCalledTimes(1);
      await expect(readFile(join(root, '.zhin/probe.json'))).rejects.toMatchObject({ code: 'ENOENT' });
      vi.stubEnv('ZHIN_CONSOLE_TOKEN', 'fixture-full-token');
      await writeFile(join(root, 'zhin.config.json'), JSON.stringify({ plugins: { reminder: { commandNamespace: 'updated' } } }));
      const pending = await requestPluginConsole<PluginManagementState>(host, { type: PLUGIN_RPC.INSPECT, instanceKey: 'reminder' });
      expect(pending.status).toBe('pending-restart');
      const applied = await requestPluginConsole<{ requested: boolean; state: PluginManagementState }>(host, { type: PLUGIN_RPC.APPLY, instanceKey: 'reminder', expectedProjectRevision: pending.projectRevision });
      expect(applied.requested).toBe(true);
      expect(applied.state.status).toBe('pending-restart');
      expect(restart).toHaveBeenCalledTimes(1);
    } finally { await http.close(); await runtime.stop(); await rm(root, { recursive: true, force: true }); }
  });

  it('rejects a credential-bearing or redirect-style host URL before any request', async () => {
    for (const host of ['http://user:pass@localhost', 'http://localhost?token=secret', 'file:///tmp/project']) {
      await expect(requestPluginConsole(host, { type: PLUGIN_RPC.INSPECT })).rejects.toThrow('base URL');
    }
  });

  it('never transmits a token over remote HTTP while supporting HTTPS and literal loopback', async () => {
    vi.stubEnv('ZHIN_CONSOLE_TOKEN', 'fixture-secret');
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ data: {} }) }));
    vi.stubGlobal('fetch', fetch);
    for (const host of ['http://console.example', 'http://192.168.1.1', 'http://localhost.example']) {
      await expect(requestPluginConsole(host, { type: PLUGIN_RPC.INSPECT })).rejects.toThrow('require HTTPS');
    }
    expect(fetch).not.toHaveBeenCalled();
    for (const host of ['https://console.example', 'http://127.0.0.1', 'http://127.1.2.3', 'http://localhost', 'http://[::1]']) {
      await expect(requestPluginConsole(host, { type: PLUGIN_RPC.INSPECT })).resolves.toEqual({});
    }
    expect(fetch).toHaveBeenCalledTimes(5);
  });
});
