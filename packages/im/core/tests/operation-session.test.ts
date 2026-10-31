import { bindOperationInput, readOperationSession } from '@zhin.js/feature-kit';
import { createSnapshotView, rootPluginId, childPluginId, type SnapshotState } from '@zhin.js/plugin-runtime';
import { RuntimeMessage } from '../src/plugin-runtime/im/contracts.js';

function fixture() {
  const root = rootPluginId();
  const owner = childPluginId(root, 'command');
  const state: SnapshotState = { root,
    tree: new Map([[root, { id: root, instanceKey: 'root', packageName: 'fixture', packageRoot: '/fixture', children: [owner] }],
      [owner, { id: owner, parent: root, instanceKey: 'command', packageName: 'command', packageRoot: '/fixture/command', children: [] }]]),
    config: new Map(), resources: new Map(), capabilities: new Map(), projections: new Map() };
  const snapshot = createSnapshotView(0, state);
  const adapter = { getEndpoint: () => endpoint };
  const endpoint = { native: () => 'native-client' };
  class NativeEvent { readonly marker = Symbol('event'); method() { return 'native-event'; } }
  const event = new NativeEvent();
  const reply = vi.fn(async () => ({ status: 'sent' as const }));
  let active = true;
  const message = new RuntimeMessage(
    {
      conversation: {
        endpoint: { adapter: 'icqq', id: 'account-id' },
        kind: 'group',
        id: 'room',
        parent: { kind: 'channel', id: 'parent' },
        threadId: 'thread',
      },
      content: 'hello',
      sender: { id: 'sender', name: 'Alice', roles: ['master', 'admin'] },
      metadata: {},
      segments: [{ type: 'text', data: { text: 'hello' } }],
      endpointId: 'account',
      mentioned: true,
    },
    {
      generation: snapshot.generation,
      reply: reply,
      client: () => endpoint,
      clientAdapter: 'icqq',
      snapshot,
      assertActive: () => {
        if (!active) throw new Error('operation ended');
      },
      session: {
        adapter,
        endpoint,
        adapterName: 'icqq',
        event,
        scene: {
          endpoint: { adapter: 'icqq', id: 'account-id' },
          kind: 'group',
          id: 'room',
          parent: { kind: 'channel', id: 'parent' },
          threadId: 'thread',
        },
        message: Object.freeze({
          text: 'hello',
          receivedAt: 200,
          platformSentAt: 100,
          mentioned: true,
        }),
        sender: Object.freeze({
          id: 'sender',
          name: 'Alice',
          platformRoles: ['admin'],
          authorizationRoles: ['master'],
        }),
        signal: new AbortController().signal,
      },
    },
  );
  return { message, adapter, endpoint, event, reply, snapshot, owner, end: () => { active = false; } };
}

it('binds one read-only Session view to real adapter/client/native references without serializing them', async () => {
  const f = fixture();
  const session = readOperationSession(f.message, 'icqq');
  expect(session).toBeDefined();
  expect(readOperationSession(f.message)).toBe(session);
  expect(session?.adapter).toBe(f.adapter);
  expect(session?.endpoint).toBe(f.endpoint);
  expect(session?.event).toBe(f.event);
  expect(f.event.method()).toBe('native-event');
  expect(Object.isFrozen(f.endpoint)).toBe(false);
  expect(Object.isFrozen(f.event)).toBe(false);
  expect(session?.scene).toMatchObject({ kind: 'group', id: 'room', parent: { id: 'parent' }, threadId: 'thread' });
  expect(session?.sender).toEqual({ id: 'sender', name: 'Alice', platformRoles: ['admin'], authorizationRoles: ['master'] });
  expect(session?.message).toMatchObject({ text: 'hello', receivedAt: 200, platformSentAt: 100, mentioned: true });
  expect(session?.message.id).toBeUndefined();
  expect(Object.isFrozen(session)).toBe(true);
  expect(Object.isFrozen(session?.message)).toBe(true);
  await session!.reply('answer');
  expect(f.reply).toHaveBeenCalledWith('answer');
});

it('rebinds reply authorship to the command operation without replacing the captured account or native event', async () => {
  const f = fixture();
  const bound = bindOperationInput(f.message, f.owner, f.snapshot);
  const session = readOperationSession(bound)!;
  expect(session).toBeDefined();
  expect(session.endpoint).toBe(f.endpoint);
  expect(session.event).toBe(f.event);
  const original = readOperationSession(f.message)!;
  expect(session.scene).toBe(original.scene);
  expect(session.sender).toBe(original.sender);
  expect(session.message).toBe(original.message);
  expect(bound.conversation).toBe(f.message.conversation);
  expect(bound.segments).toBe(f.message.segments);
  await session.reply('command reply');
  expect(f.reply).toHaveBeenCalledWith('command reply', f.owner);
  f.end();
  expect(() => readOperationSession(bound)).toThrow('operation ended');
});

it('does not fabricate a Session from a synthetic Message or metadata', () => {
  const message = new RuntimeMessage(
    {
      conversation: { endpoint: { adapter: 'synthetic', id: 'none' }, kind: 'private', id: 'sender' },
      content: 'synthetic',
      metadata: { session: { adapterName: 'icqq', endpoint: {} } },
    },
    { generation: 0, reply: async () => ({ status: 'unsupported' }) },
  );
  expect(readOperationSession(message)).toBeUndefined();
});
