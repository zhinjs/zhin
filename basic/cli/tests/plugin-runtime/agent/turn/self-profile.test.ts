import { adapterFeatureId } from '@zhin.js/adapter';
import type { SelfProfilePort, SelfProfileSnapshot } from '@zhin.js/im-contract';
import { resolveRuntimeTurnContextState } from '../../../../src/plugin-runtime/agent/turn/request.js';

const signal = new AbortController().signal;
const conversation = { endpoint: { id: 'endpoint', adapter: 'telegram' }, kind: 'private' as const, id: 'friend' };
const snapshot = (selfUserId?: string) => ({ projections: new Map([[adapterFeatureId, {
  $projection: 'zhin.adapter-index/1',
  connection: () => ({ identity: conversation.endpoint, selfUserId }),
}]]) }) as never;
const facts = (nickname: string): SelfProfileSnapshot => ({
  values: { nickname, gender: 'female', age: 20, signature: 'hello', avatar: 'https://images.example.test/avatar.png', interests: ['music'], bio: 'A bot' },
  sources: { nickname: 'platform', gender: 'configured', age: 'configured', signature: 'platform', avatar: 'platform', interests: 'configured', bio: 'platform' },
  writableFields: ['nickname', 'signature', 'avatar'], platformStatus: 'available',
});

it('reads the captured account profile, preserving platform/configured sources and real id', async () => {
  const profile = facts('Actual account');
  const read = vi.fn(async () => profile);
  const port: SelfProfilePort = { peek: () => profile, read };
  const state = await resolveRuntimeTurnContextState({ snapshot: snapshot('real-platform-id'), conversation, signal, selfProfile: port });
  expect(state).toEqual({ bot: { id: 'real-platform-id', name: 'Actual account', profile } });
  expect(read).toHaveBeenCalledExactlyOnceWith({ signal });
});

it('does not require or invent a platform id to expose known profile facts', async () => {
  const profile = facts('Known name');
  const state = await resolveRuntimeTurnContextState({ snapshot: snapshot(), conversation, signal,
    selfProfile: { peek: () => profile, read: async () => profile } });
  expect(state?.bot?.id).toBeUndefined();
  expect(state?.bot?.profile).toEqual(profile);
});

it('marks a failed read while keeping provenance of configured/previous facts', async () => {
  const profile = { ...facts('Fallback'), platformStatus: 'unread' as const, sources: { nickname: 'configured' as const } };
  const state = await resolveRuntimeTurnContextState({ snapshot: snapshot('real-id'), conversation, signal,
    selfProfile: { peek: () => profile, read: async () => { throw new Error('read failed'); } } });
  expect(state?.bot).toMatchObject({ name: 'Fallback', profileError: 'lookup_failed', profile });
});

it('propagates caller cancellation instead of recording it as a lookup failure', async () => {
  const abort = new AbortController();
  const read = vi.fn(async () => { abort.abort(new Error('caller stopped')); throw abort.signal.reason; });
  await expect(resolveRuntimeTurnContextState({ snapshot: snapshot('real-id'), conversation, signal: abort.signal,
    selfProfile: { peek: () => facts('Fallback'), read } })).rejects.toThrow('caller stopped');
});

it('never borrows another endpoint profile or writes shared state across concurrent turns', async () => {
  const [a, b] = await Promise.all(['Alice account', 'Bob account'].map(nickname => resolveRuntimeTurnContextState({
    snapshot: snapshot(nickname), conversation, signal, selfProfile: { peek: () => facts(nickname), read: async () => facts(nickname) },
  })));
  expect(a?.bot?.name).toBe('Alice account');
  expect(b?.bot?.name).toBe('Bob account');
});
