import { createSnapshotView, createToken, rootPluginId } from '@zhin.js/plugin-runtime';
import { createCapabilityContext, type OperationResourceView } from '../src/index.js';

it('uses only explicit operation resources before owner resources without opening a provider or closing a borrowed view', () => {
  const root = rootPluginId(), token = createToken<string>('fixture.operation'), fallback = createToken<string>('fixture.owner');
  const snapshot = createSnapshotView(1, { root,
    tree: new Map([[root, { id: root, instanceKey: 'root', packageName: 'fixture', packageRoot: '/fixture', children: [] }]]),
    config: new Map([[root, {}]]), resources: new Map([[root, new Map([[token.id, 'owner'], [fallback.id, 'fallback']])]]),
    capabilities: new Map(), projections: new Map() });
  const close = vi.fn(async () => undefined), uses = vi.fn();
  const resources: OperationResourceView = { has: value => value.id === token.id,
    use: <T>(value: import('@zhin.js/plugin-runtime').Token<T>) => { uses(value.id); return 'operation' as T; }, close };
  const controller = new AbortController();
  const context = createCapabilityContext({ snapshot, ownerId: root, operation: { signal: controller.signal, resources } });
  expect(context.has?.(token)).toBe(true); expect(uses).not.toHaveBeenCalled();
  expect(context.use(token)).toBe('operation'); expect(context.use(fallback)).toBe('fallback');
  expect(uses).toHaveBeenCalledOnce(); expect(close).not.toHaveBeenCalled();
  expect(context.signal).toBe(controller.signal);
  expect(createCapabilityContext({ snapshot, ownerId: root }).use(token)).toBe('owner');
});
