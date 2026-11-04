import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocketServer } from 'ws';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import { type EndpointDesiredRepository, type EndpointDesiredSnapshot } from 'zhin.js/adapter';
import { createAdapterHarness } from '../../test-utils/endpoint.js';
import definition from '../adapters/onebot12/index.js';
import { probeOnebot12Identity } from '../src/identity.js';
import { resolveOneBot12Config } from '../src/protocol.js';
import { probeOnebot11Identity } from '../../onebot11/src/identity.js';
import { resolveOneBot11Config } from '../../onebot11/src/protocol.js';
import { probeNapcatIdentity } from '../../napcat/src/identity.js';
import { resolveNapCatConfig } from '../../napcat/src/protocol.js';

const servers: WebSocketServer[] = [];
afterEach(async () => { for (const server of servers.splice(0)) { for (const client of server.clients) client.terminate(); await new Promise<void>(resolve => server.close(() => resolve())); } });
async function peer(mode: 'same' | 'different' | 'multiple' | 'failed' | 'pending' = 'same') {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' }); servers.push(server);
  const actions: string[] = [];
  server.on('connection', (socket, request) => socket.on('message', raw => {
    const frame = JSON.parse(String(raw)) as { action: string; echo: string; self?: { platform: string; user_id: string } }; actions.push(frame.action);
    if (frame.action === 'get_status' || frame.action === 'get_self_info') expect(frame.self).toEqual({ platform: 'qq', user_id: '777' });
    if (mode === 'pending') return;
    const next = new URL(request.url ?? '/', 'http://local').searchParams.get('access_token') === 'rotated';
    const user = mode === 'different' && next ? '888' : '777';
    const data = frame.action === 'get_status' ? { bots: [ { self: { platform: 'qq', user_id: user } }, ...(mode === 'multiple' ? [{ self: { platform: 'qq', user_id: 'other' } }] : []) ] }
      : { user_id: user };
    socket.send(JSON.stringify({ echo: frame.echo, status: mode === 'failed' ? 'failed' : 'ok', retcode: mode === 'failed' ? 100 : 0, data }));
  }));
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing local protocol address');
  return { url: `ws://127.0.0.1:${address.port}`, server, actions };
}
async function controller(mode: Parameters<typeof peer>[0]) {
  const remote = await peer(mode);
  const config = { id: 'bot', platform: 'qq', userId: '777', url: remote.url, access_token: 'original' };
  let state: EndpointDesiredSnapshot = { revision: 1, endpoints: [{ instanceId: 'original-instance',
    canonicalId: capabilityId(rootPluginId(), featureId('zhin.adapter'), 'onebot12'), endpointId: 'bot',
    revision: 1, desiredEnabled: false, config }] };
  const compareAndSet = vi.fn<EndpointDesiredRepository['compareAndSet']>(async (_adapter, expected, endpoints, commitId) => {
    expect(expected).toBe(state.revision); state = structuredClone({ revision: state.revision + 1, endpoints, commitId }); return state;
  });
  const harness = await createAdapterHarness(definition, config, { name: 'onebot12', repository: { load: async () => state, compareAndSet } });
  await harness.start(); harness.open();
  return { ...remote, harness, compareAndSet, state: () => state };
}
describe('isolated read-only protocol identity probes', () => {
  it('uses the actual OneBot11 and NapCat login-info protocol and closes both temporary connections', async () => {
    const f = await peer(); const signal = new AbortController().signal;
    const onebot = resolveOneBot11Config({ id: 'onebot', connection: 'ws', url: f.url });
    const napcat = resolveNapCatConfig({ id: 'napcat', connection: 'ws', url: f.url });
    if (onebot.connection !== 'ws' || napcat.connection !== 'ws') throw new Error('Expected forward WS');
    await expect(probeOnebot11Identity(onebot, signal)).resolves.toBe('qq:777');
    await expect(probeNapcatIdentity(napcat, signal)).resolves.toBe('qq:777');
    expect(f.actions).toEqual(['get_login_info', 'get_login_info']);
    await vi.waitFor(() => expect(f.server.clients.size).toBe(0));
  });
  it('cancels an in-flight readonly lookup and releases its temporary socket', async () => {
    const f = await peer('pending'), abort = new AbortController();
    const config = resolveOneBot12Config({ id: 'bot', platform: 'qq', userId: '777', url: f.url }); if (config.connection !== 'ws') throw new Error('Expected forward WS');
    const lookup = probeOnebot12Identity(config, abort.signal); const rejected = expect(lookup).rejects.toThrow();
    await vi.waitFor(() => expect(f.actions).toEqual(['get_status'])); abort.abort(new Error('account operation canceled'));
    await rejected; await vi.waitFor(() => expect(f.server.clients.size).toBe(0));
  });
  it.each(['same', 'multiple'] as const)('verifies the selected account in a %s service before the real Adapter CAS', async mode => {
    const f = await controller(mode);
    try {
      expect(f.harness.endpoint).toBeUndefined(); expect(f.actions).toHaveLength(0);
      await f.harness.adapter.patchConfiguration('original-instance', f.harness.adapter.revision, { access_token: 'rotated' });
      expect(f.actions).toEqual(['get_status', 'get_self_info', 'get_status', 'get_self_info']);
      expect(f.compareAndSet).toHaveBeenCalledOnce();
      const saved = f.state().endpoints[0]; expect(saved.desiredEnabled).toBe(false);
      expect(saved.instanceId).toBe('original-instance');
      expect(f.harness.endpoint).toBeUndefined();
    } finally { await f.harness.stop(); }
  });
  it.each(['different', 'failed'] as const)('does not save a %s selected-account lookup or choose another service bot', async mode => {
    const f = await controller(mode);
    try {
      await expect(f.harness.adapter.patchConfiguration('original-instance', f.harness.adapter.revision, { access_token: 'rotated' })).rejects.toThrow();
      expect(f.compareAndSet).not.toHaveBeenCalled(); expect(f.state().endpoints[0].config.access_token).toBe('original');
      if (mode === 'different') expect(f.actions).toEqual(['get_status', 'get_self_info', 'get_status']);
    } finally { await f.harness.stop(); }
  });
});
