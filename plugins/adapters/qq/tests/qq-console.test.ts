import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PluginConsoleRpcError, rootPluginId, type PluginConsoleRpcCall } from 'zhin.js';
import { AdapterManagementError } from 'zhin.js/adapter';
import { createAdapterHarness } from '../../test-utils/endpoint.js';
import { MemoryDesiredRepository } from '../../test-utils/desired-repository.js';
import definition from '../adapters/qq/index.js';
import { cancelQqConsoleBind, completeQqConsoleBind, startQqConsoleBind } from '../src/qq-console.js';
import { createQqRuntimeState, type QqRuntimeState } from '../src/qq-runtime-state.js';
import { createQqConsoleRpc } from '../src/console.js';
import type { QqEndpointSavePort } from '../src/qq-endpoint-write.js';
import type { QqBindCallbacks } from '../src/qq-bind-flow.js';

const { startFlow } = vi.hoisted(() => ({ startFlow: vi.fn() }));
vi.mock('../src/qq-bind-flow.js', () => ({ startQqBindFlow: startFlow }));
const fixtures: Awaited<ReturnType<typeof createAdapterHarness>>[] = [];
beforeEach(() => { startFlow.mockReset(); startFlow.mockReturnValue(vi.fn()); });
afterEach(async () => { for (const f of fixtures.splice(0)) await f.stop(); });
async function fixture() {
  const repository = new MemoryDesiredRepository();
  const runtime = await createAdapterHarness(definition, { id: 'deferred', appid: 'synthetic-placeholder', secret: 'synthetic-placeholder' }, { name: 'qq', repository });
  fixtures.push(runtime); await runtime.start(); runtime.open();
  const revision = runtime.adapter.revision;
  const save: QqEndpointSavePort = vi.fn(config => runtime.adapter.add(revision, { endpointId: config.id, config: { ...config } }, { waitForExecution: false }));
  const call: PluginConsoleRpcCall = { signal: new AbortController().signal, runtime: { owner: rootPluginId(), generation: 1, operator: true, project: () => runtime.index.forOwner(rootPluginId()) } };
  const request = (input: Record<string, unknown> = {}) => ({ expectedGeneration: 1, expectedRevision: runtime.adapter.revision, ...input });
  return { runtime, adapter: runtime.adapter, index: runtime.index, get endpoint() { return runtime.endpoint; }, repository, save, call, request };
}
function stateWithPending(endpointId = 'bot-1'): QqRuntimeState {
  const state = createQqRuntimeState(); state.consoleBind = { state: 'scanned', startedAt: 1, pending: { endpointId, appId: 'synthetic-app', appSecret: 'synthetic-secret' } }; return state;
}
function callbacks(): QqBindCallbacks { return startFlow.mock.calls.at(-1)![0]; }

describe('QQ console binding saves through its actual owning Adapter', () => {
  it('saves the selected bot kind and intents in one CAS, without starting a Client or writing env/config files', async () => {
    const f = await fixture(), state = stateWithPending(); const result = await completeQqConsoleBind(state, f.save, 'private');
    expect(result).toMatchObject({ endpointId: 'bot-1', botKind: 'private' }); expect(result.intents).toContain('GUILD_MESSAGES'); expect(result.intents).not.toContain('PUBLIC_GUILD_MESSAGES');
    expect(f.repository.writes).toHaveLength(1); expect(f.repository.snapshot?.endpoints[0]).toMatchObject({ endpointId: 'bot-1', desiredEnabled: false, config: { id: 'bot-1', appid: 'synthetic-app', secret: 'synthetic-secret', botKind: 'private' } });
    expect(f.endpoint).toBeUndefined(); expect(state.consoleBind).toBeNull(); expect(state).not.toHaveProperty('endpoints');
  });
  it('rejects invalid/missing bot kind without saving or clearing pending credentials', async () => {
    const f = await fixture(), state = stateWithPending();
    await expect(completeQqConsoleBind(state, f.save, 'nope')).rejects.toBeInstanceOf(PluginConsoleRpcError); expect(state.consoleBind?.pending?.endpointId).toBe('bot-1'); expect(f.repository.writes).toHaveLength(0);
    state.consoleBind = null; await expect(completeQqConsoleBind(state, f.save, 'public')).rejects.toMatchObject({ code: 'conflict' });
  });
  it('cancels a pending console flow without deleting desired accounts', () => {
    const state = stateWithPending(); expect(cancelQqConsoleBind(state)).toBe(true); expect(state.consoleBind).toBeNull(); expect(cancelQqConsoleBind(state)).toBe(false);
  });
  it('refuses parallel QR/chat or bot-kind flows', () => {
    const state = createQqRuntimeState(); state.bindFlow = { stop() {} }; expect(() => startQqConsoleBind(state)).toThrow(PluginConsoleRpcError); state.bindFlow = null;
    state.pendingBotKind = { endpointId: 'x', appId: 'a', appSecret: 's', sessionKey: '', save: async () => { throw new Error('not called'); } };
    expect(() => startQqConsoleBind(state)).toThrow(PluginConsoleRpcError); expect(startFlow).not.toHaveBeenCalled();
  });
  it('preserves a pending choice on an unknown CAS outcome and does not automatically retry', async () => {
    const f = await fixture(), state = stateWithPending();
    vi.spyOn(f.repository, 'compareAndSet').mockRejectedValue(new AdapterManagementError('commit_unknown', 'synthetic unknown outcome'));
    await expect(completeQqConsoleBind(state, f.save, 'public')).rejects.toMatchObject({ code: 'commit_unknown' });
    expect(state.consoleBind?.pending?.endpointId).toBe('bot-1'); expect(f.repository.compareAndSet).toHaveBeenCalledTimes(1); expect(f.adapter.list()).toEqual([]);
  });
});

describe('QQ console RPC exact runtime admission', () => {
  it('offers QR then kind actions without leaking transient or persisted credentials', async () => {
    const f = await fixture(), state = createQqRuntimeState(), rpc = createQqConsoleRpc(state, () => ({}));
    const status = () => rpc.methods.get('status')!.handler({}, f.call);
    expect(await status()).toMatchObject({ actions: [{ name: 'qq-bind-start' }] });
    state.consoleBind = stateWithPending().consoleBind;
    const pending = await status(); expect(pending).toMatchObject({ actions: [{ name: 'qq-bind-kind' }, { name: 'qq-bind-cancel' }], extra: { bindState: 'scanned', bindEndpoint: 'bot-1' } });
    expect(JSON.stringify(pending)).not.toContain('synthetic-secret'); expect(rpc.methods.get('qq-bind-kind')!.requiredPermissions).toEqual(['qq:write']);
  });
  it('captures the QR start revision and saves the chosen kind only through the same owning Adapter', async () => {
    const f = await fixture(), state = createQqRuntimeState(), rpc = createQqConsoleRpc(state, () => ({}));
    const starting = rpc.methods.get('qq-bind-start')!.handler(f.request(), f.call); callbacks().onQrDisplayed?.('https://example.test/synthetic-qr'); await starting;
    expect(state.consoleAdmission).toEqual({ adapterId: f.adapter.descriptor.id, generation: 1, revision: 1 }); expect(f.repository.writes).toHaveLength(0);
    await callbacks().onSuccess([{ appId: 'synthetic-app', appSecret: 'synthetic-secret' }]);
    expect(await rpc.methods.get('qq-bind-kind')!.handler(f.request({ value: 'private' }), f.call)).toMatchObject({ saved: true, restartRequired: false });
    expect(f.repository.writes).toHaveLength(1); expect(f.adapter.list()[0]?.desiredEnabled).toBe(false); expect(f.endpoint).toBeUndefined(); expect(state.consoleAdmission).toBeNull();
  });
  it('rejects missing runtime and stale generation/revision without persistence or starting QR IO', async () => {
    const f = await fixture(), state = createQqRuntimeState(), rpc = createQqConsoleRpc(state, () => ({})), method = rpc.methods.get('qq-bind-start')!;
    await expect(method.handler(f.request(), { signal: new AbortController().signal })).rejects.toMatchObject({ code: 'unsupported' });
    await expect(method.handler(f.request({ expectedGeneration: 2 }), f.call)).rejects.toMatchObject({ code: 'conflict' });
    await expect(method.handler(f.request({ expectedRevision: 99 }), f.call)).rejects.toMatchObject({ code: 'conflict' }); expect(startFlow).not.toHaveBeenCalled(); expect(f.repository.writes).toHaveLength(0);
  });
  it('cannot refresh an active QR flow’s captured revision through a rejected second start', async () => {
    const f = await fixture(), state = createQqRuntimeState(), rpc = createQqConsoleRpc(state, () => ({}));
    const starting = rpc.methods.get('qq-bind-start')!.handler(f.request(), f.call); callbacks().onQrDisplayed?.('https://example.test/synthetic-qr'); await starting;
    const captured = state.consoleAdmission;
    await f.adapter.add(f.adapter.revision, { endpointId: 'other', config: { id: 'other', appid: 'other-app', secret: 'synthetic-other' } });
    await expect(rpc.methods.get('qq-bind-start')!.handler(f.request(), f.call)).rejects.toMatchObject({ code: 'conflict' });
    expect(state.consoleAdmission).toEqual(captured); expect(startFlow).toHaveBeenCalledTimes(1);
  });
});
