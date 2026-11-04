import { createSnapshotView, rootPluginId, childPluginId } from '@zhin.js/plugin-runtime';
import { readOperationInputResources, type OperationResourceView } from '@zhin.js/feature-kit';
import { RuntimeMessage } from '../../src/plugin-runtime/im/contracts.js';

function fixture() {
  const root = rootPluginId(), child = childPluginId(root, 'command');
  const state = { root,
    tree: new Map([[root, { id: root, instanceKey: 'root', packageName: 'root', packageRoot: '/fixture', children: [child] }],
      [child, { id: child, parent: root, instanceKey: 'command', packageName: 'command', packageRoot: '/fixture/command', children: [] }]]),
    resources: new Map([[root, new Map()], [child, new Map()]]), config: new Map(), capabilities: new Map(), projections: new Map() };
  const snapshot = createSnapshotView(1, state), lifetime = new AbortController();
  let active = true;
  const view: OperationResourceView = { has: () => false, use: () => { throw new Error('Missing'); }, close: async () => undefined };
  const open = vi.fn(() => view);
  const message = new RuntimeMessage({ conversation: { endpoint: { adapter: 'fixture', id: 'entry' }, kind: 'private', id: 'alice' },
    content: 'synthetic', metadata: { owner: root, operation: { resources: 'forged' } } }, {
    generation: 1, snapshot, signal: lifetime.signal,
    reply: async () => { throw new Error('No send'); },
    assertActive: () => { if (!active) throw new Error('Expired actual operation'); },
    createOperationResources: open,
  });
  return { state, snapshot, lifetime, message, open, child, view, expire: () => { active = false; } };
}

it('passes a controlled source and owner only when the authorized execution asks for an operation', () => {
  const f = fixture(); const factory = readOperationInputResources(f.message, f.snapshot)!;
  expect(f.open).not.toHaveBeenCalled();
  const caller = new AbortController();
  const operation = factory.create({ owner: f.child, signal: caller.signal });
  expect(operation.resources).toBe(f.view); expect(f.open).toHaveBeenCalledOnce();
  expect(f.open.mock.calls[0][0]).toMatchObject({ message: f.message, owner: f.child });
  f.lifetime.abort(); expect(operation.signal.aborted).toBe(true);
  expect(readOperationInputResources({ metadata: { operation: factory }, operation: factory }, f.snapshot)).toBeUndefined();
});

it('rejects cross-snapshot and escaped source factories instead of resolving a newer root', () => {
  const f = fixture(); const factory = readOperationInputResources(f.message, f.snapshot)!;
  expect(() => readOperationInputResources(f.message, createSnapshotView(2, f.state))).toThrow('another generation');
  f.expire();
  expect(() => factory.create({ owner: f.child, signal: new AbortController().signal })).toThrow('Expired actual operation');
  expect(f.open).not.toHaveBeenCalled();
});
