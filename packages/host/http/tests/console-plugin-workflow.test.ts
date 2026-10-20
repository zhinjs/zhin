import { describe, expect, it, vi } from 'vitest';
import { dispatchPluginConsoleRpc } from '../src/console-plugin-rpc.js';
import { PLUGIN_RPC, DEMO_RPC_ALLOWLIST } from '@zhin.js/console-protocol';
import type { RuntimeConsoleRpcContext, PluginManagementPort, PluginManagementState } from '../src/console-rpc.js';

function fixture(scope: RuntimeConsoleRpcContext['authScope'] = 'full') {
  const state: PluginManagementState = { packageName: 'reminder', instanceKey: 'reminder', installed: true, plugin: true, declared: true, version: '1.0.0', revision: 'config', projectRevision: 'project', status: 'pending-restart', dependencies: 'passed', validation: { valid: true, errors: [], missingEnv: [] }, generation: 1, published: false, readiness: 'unknown', restartRequired: true, disabled: false, issues: [], verification: 'available' };
  const port: PluginManagementPort = {
    planInstall: vi.fn(async () => ({ packageName: 'reminder', instanceKey: 'reminder', alreadyDeclared: false, alreadyInstalled: false, restartRequired: true, changes: { packageManifest: 'add-plugin', config: 'create-entry' }, warnings: [] })),
    inspect: vi.fn(async () => state),
    apply: vi.fn(async () => ({ requested: true, state })),
    verificationPlan: vi.fn(async () => ({ packageName: 'reminder', instanceKey: 'reminder', generation: 1, projectRevision: 'project', checkRevision: 'checks', checks: [{ id: 'local-task', title: 'Write/read/cancel task', effects: ['Local temporary task; no IM send'], scope: 'local' }] } as const)),
    verify: vi.fn(async () => ({ packageName: 'reminder', instanceKey: 'reminder', checkId: 'local-task', generation: 1, current: true, status: 'passed', scope: 'local', summary: 'Task roundtrip; delivery not tested', evidence: ['read/cancel succeeded'] })),
  };
  return { state, port, context: { authScope: scope, listPages: async () => [], pluginManagement: port } satisfies RuntimeConsoleRpcContext };
}
describe('Plugin workflow Console RPC', () => {
  it('exposes inspect evidence and explicit verification effects without running any check', async () => {
    const { context, port, state } = fixture();
    expect(await dispatchPluginConsoleRpc(PLUGIN_RPC.INSPECT, { instanceKey: 'reminder' }, context)).toEqual({ requestId: undefined, data: state });
    expect(await dispatchPluginConsoleRpc(PLUGIN_RPC.PLAN_VERIFICATION, { instanceKey: 'reminder' }, context)).toMatchObject({ data: { checks: [{ scope: 'local', effects: ['Local temporary task; no IM send'] }] } });
    expect(port.verify).not.toHaveBeenCalled();
    expect(port.apply).not.toHaveBeenCalled();
  });
  it('requires full scope before invoking plan callbacks, apply or business verification', async () => {
    expect(DEMO_RPC_ALLOWLIST.has(PLUGIN_RPC.PLAN_VERIFICATION)).toBe(false);
    const { context, port } = fixture('demo');
    await expect(dispatchPluginConsoleRpc(PLUGIN_RPC.APPLY, { instanceKey: 'reminder' }, context)).resolves.toMatchObject({ error: 'Full scope required' });
    await expect(dispatchPluginConsoleRpc(PLUGIN_RPC.VERIFY, { instanceKey: 'reminder', checkId: 'local-task', expectedGeneration: 1, expectedProjectRevision: 'project', expectedCheckRevision: 'checks' }, context)).resolves.toMatchObject({ error: 'Full scope required' });
    await expect(dispatchPluginConsoleRpc(PLUGIN_RPC.PLAN_VERIFICATION, { instanceKey: 'reminder' }, context)).resolves.toMatchObject({ error: 'Full scope required' });
    expect(port.verificationPlan).not.toHaveBeenCalled();
    expect(port.verify).not.toHaveBeenCalled();
    expect(port.apply).not.toHaveBeenCalled();
  });
  it('forwards optimistic revision to apply and reports restart requested separately from enabled', async () => {
    const { context, port } = fixture();
    expect(await dispatchPluginConsoleRpc(PLUGIN_RPC.APPLY, { instanceKey: 'reminder', expectedProjectRevision: 'project' }, context)).toMatchObject({ data: { requested: true, state: { status: 'pending-restart' } } });
    expect(port.apply).toHaveBeenCalledWith('reminder', 'project');
  });
  it('runs only an explicitly selected business check and reports its actual scope', async () => {
    const { context, port } = fixture();
    await expect(dispatchPluginConsoleRpc(PLUGIN_RPC.VERIFY, { instanceKey: 'reminder' }, context)).resolves.toMatchObject({ error: 'checkId is required' });
    expect(port.verify).not.toHaveBeenCalled();
    await expect(dispatchPluginConsoleRpc(PLUGIN_RPC.VERIFY, { instanceKey: 'reminder', checkId: 'local-task', expectedGeneration: 1, expectedProjectRevision: 'project', expectedCheckRevision: 'checks' }, context)).resolves.toMatchObject({ data: { status: 'passed', current: true, scope: 'local', generation: 1 } });
    expect(port.verify).toHaveBeenCalledWith('reminder', 'local-task', 1, 'project', 'checks');
  });
});
