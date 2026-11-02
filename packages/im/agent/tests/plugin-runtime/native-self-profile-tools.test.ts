import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SelfProfilePort, SelfProfileSnapshot } from '@zhin.js/im-contract';
import { rootPluginId } from '@zhin.js/plugin-runtime';
import type { ToolExecutionContext } from '@zhin.js/tool';
import { createNativeSelfProfileToolFeatures, type NativeSelfProfileToolOptions } from '../../src/plugin-runtime/native-self-profile-tools.js';
import { createTurnIngress, type TurnOrigin } from '../../src/turn/turn-ingress.js';
import { TurnToolRuntime } from '../../src/tool/turn-tool-runtime.js';
import type { TurnEvent } from '../../src/event/turn-event.js';
import { LocalImageAssetStore } from '../../src/media/local-image-assets.js';
import type { NetworkTransport } from '../../src/security/turn-network-client.js';
import { toolInvocationFromTurn } from '../../src/plugin-runtime/capability-tools.js';

const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
let directory: string;
beforeEach(async () => { directory = await realpath(await mkdtemp(join(tmpdir(), 'zhin-self-profile-'))); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

function fixture(options: NativeSelfProfileToolOptions = {}, approved = true, scope?: Readonly<{ origin: TurnOrigin; sessionKey: string }>) {
  const snapshot: SelfProfileSnapshot = { values: { nickname: 'Real account' }, sources: { nickname: 'platform' },
    writableFields: ['nickname', 'gender', 'age', 'birthday', 'signature', 'avatar', 'bio', 'interests'], platformStatus: 'available' };
  const profile = { peek: () => snapshot, read: vi.fn(async () => snapshot),
    write: vi.fn<NonNullable<SelfProfilePort['write']>>(async () => ({ status: 'updated' })) } satisfies SelfProfilePort;
  const approval = vi.fn(async () => approved);
  const events: TurnEvent[] = [];
  const turn = createTurnIngress({
    identity: { rootId: 'root', generation: 1, traceId: 'trace', turnId: 'turn' }, intent: { kind: 'new' },
    origin: scope?.origin ?? { kind: 'im', platform: 'icqq', endpoint: 'source-account', scope: 'private', sceneId: 'member' },
    principal: { subjectId: 'member', roles: ['master'] }, input: { text: 'profile' }, session: { key: scope?.sessionKey ?? 'session' },
    policy: { permissions: ['master'], unattended: false, filesystem: { workspaceRoot: directory }, network: { enabled: false } },
    capabilities: { tools: ['get_self_profile', 'set_self_profile'], skills: [] }, signal: new AbortController().signal,
    ports: { selfProfile: profile, journal: { append: event => { events.push(event); } }, approval: { requestApproval: approval } },
  });
  const tools = createNativeSelfProfileToolFeatures(options).map(native => ({ ...native.definition,
    name: native.name, qualifiedName: native.name, owner: rootPluginId(), source: 'builtin',
    execute: (input: unknown, context: unknown) => native.definition.execute(input as Record<string, unknown>, context as ToolExecutionContext),
  }));
  return { profile, approval, events, turn, invocation: toolInvocationFromTurn(turn), runtime: new TurnToolRuntime(turn, tools) };
}

it('refreshes only the bound current account without asking for read approval', async () => {
  const f = fixture();
  await expect(f.runtime.execute('get_self_profile', {}, 'read')).resolves.toMatchObject({ status: 'completed', output: { values: { nickname: 'Real account' } } });
  expect(f.profile.read).toHaveBeenCalledExactlyOnceWith({ signal: f.turn.signal, refresh: true });
  expect(f.approval).not.toHaveBeenCalled();
});

it('requires a fresh identity approval for each single field update', async () => {
  const f = fixture();
  await expect(f.runtime.execute('set_self_profile', { field: 'nickname', value: 'New name' }, 'one')).resolves.toMatchObject({ status: 'completed' });
  expect(f.approval).toHaveBeenCalledTimes(1);
  await expect(f.runtime.execute('set_self_profile', { field: 'bio', value: 'New bio' }, 'two')).resolves.toMatchObject({ status: 'completed' });
  expect(f.approval).toHaveBeenCalledTimes(2);
  expect(f.profile.write.mock.calls[0]?.[0]).toMatchObject({ change: { field: 'nickname', value: 'New name' }, signal: f.turn.signal });
});

it('does not read an avatar or submit any update after approval is denied', async () => {
  const f = fixture({}, false);
  await expect(f.runtime.execute('set_self_profile', { field: 'avatar', file_path: 'missing.png' }, 'deny')).resolves.toMatchObject({ status: 'denied' });
  expect(f.profile.write).not.toHaveBeenCalled();
});

it('does not convert unsupported fields or an age into a birthday request', async () => {
  const f = fixture();
  const snapshot = f.profile.peek();
  vi.spyOn(f.profile, 'peek').mockReturnValue({ ...snapshot, writableFields: ['nickname'] });
  await expect(f.runtime.execute('set_self_profile', { field: 'age', value: 20 }, 'age')).resolves.toMatchObject({ status: 'denied', policy: 'capability' });
  await expect(f.runtime.execute('set_self_profile', { field: 'birthday', value: '2000-01-01' }, 'birthday')).resolves.toMatchObject({ status: 'denied', policy: 'capability' });
  expect(f.approval).not.toHaveBeenCalled();
  expect(f.profile.write).not.toHaveBeenCalled();
});

it('preserves rejection and unknown outcomes without reporting success or retrying', async () => {
  for (const status of ['rejected', 'unknown'] as const) {
    const f = fixture();
    f.profile.write.mockResolvedValue({ status });
    await expect(f.runtime.execute('set_self_profile', { field: 'signature', value: 'Hello' }, status)).resolves.toMatchObject({ status: 'completed', output: { status } });
    expect(f.profile.write).toHaveBeenCalledTimes(1);
  }
});

it('loads an authorized local avatar internally, keeping bytes out of tool results and journal', async () => {
  await writeFile(join(directory, 'avatar.gif'), gif);
  const f = fixture();
  await expect(f.runtime.execute('set_self_profile', { field: 'avatar', file_path: 'avatar.gif' }, 'avatar')).resolves.toMatchObject({ status: 'completed', output: { status: 'updated' } });
  expect(f.profile.write.mock.calls[0]?.[0]).toMatchObject({ change: { field: 'avatar', value: { kind: 'base64', value: gif.toString('base64'), mime_type: 'image/gif', size: gif.length } } });
  expect(JSON.stringify(f.events)).not.toContain(gif.toString('base64'));
});

it('denies sensitive and outside files before native execution', async () => {
  await writeFile(join(directory, '.env'), gif);
  const f = fixture();
  for (const file_path of ['.env', '../outside.gif']) {
    await expect(f.runtime.execute('set_self_profile', { field: 'avatar', file_path }, file_path)).resolves.toMatchObject({ status: 'denied', policy: 'workspace-access' });
  }
  expect(f.profile.write).not.toHaveBeenCalled();
});

it('enforces private asset caller scope before publishing it as an avatar', async () => {
  const store = new LocalImageAssetStore(join(directory, 'assets'));
  const f = fixture({ localAssets: store });
  const image = await store.capture(gif.toString('base64'), f.invocation, 'test');
  await expect(f.runtime.execute('set_self_profile', { field: 'avatar', asset_id: image.asset_id }, 'private')).resolves.toMatchObject({ status: 'completed' });
  const other = await store.capture(gif.toString('base64'), { ...f.invocation, principal: { subjectId: 'other', roles: [] } }, 'test');
  await expect(f.runtime.execute('set_self_profile', { field: 'avatar', asset_id: other.asset_id }, 'foreign')).resolves.toMatchObject({ status: 'failed' });
  expect(f.profile.write).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(f.events)).not.toContain(gif.toString('base64'));
});

it('never publishes a private image captured under another canonical parent channel', async () => {
  const store = new LocalImageAssetStore(join(directory, 'assets'));
  const origin = (guild: string): TurnOrigin => ({ kind: 'im', platform: 'icqq', endpoint: 'source-account', scope: 'channel', sceneId: 'channel',
    conversation: { endpoint: { id: 'canonical-account', adapter: 'icqq' }, kind: 'channel', id: 'channel', parent: { kind: 'channel', id: guild } } });
  const a = fixture({ localAssets: store }, true, { origin: origin('guild-a'), sessionKey: 'session-guild-a' });
  const b = fixture({ localAssets: store }, true, { origin: origin('guild-b'), sessionKey: 'session-guild-b' });
  const image = await store.capture(gif.toString('base64'), a.invocation, 'private screenshot');
  await expect(b.runtime.execute('set_self_profile', { field: 'avatar', asset_id: image.asset_id }, 'foreign-parent')).resolves.toMatchObject({ status: 'failed' });
  expect(b.profile.write).not.toHaveBeenCalled();
  expect((await store.read(image.asset_id, a.invocation)).bytes).toEqual(gif);
});

it('keeps generated image URL authority while arbitrary avatar URLs require current network permission', async () => {
  const requestBytes = vi.fn<NonNullable<NetworkTransport['requestBytes']>>(async () => ({ status: 200, statusText: 'OK', headers: {}, body: gif }));
  const transport = { request: vi.fn(), requestBytes };
  const f = fixture({ networkTransport: transport, imageAssets: { ownsUrl: url => url === 'https://images.example.test/generated/avatar.gif', publish: vi.fn() } });
  await expect(f.runtime.execute('set_self_profile', { field: 'avatar', image_url: 'https://images.example.test/generated/avatar.gif' }, 'owned')).resolves.toMatchObject({ status: 'completed' });
  await expect(f.runtime.execute('set_self_profile', { field: 'avatar', image_url: 'https://other.example.test/avatar.gif' }, 'unowned')).resolves.toMatchObject({ status: 'denied', policy: 'network-access' });
  expect(requestBytes).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(f.events)).not.toContain(gif.toString('base64'));
});
