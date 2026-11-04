import { Scope, createFeaturePrivateToken, createRootPrivateToken, createToken, featureId, rootPluginId,
  type SnapshotState } from '@zhin.js/plugin-runtime';
import { defineFeatureProvider } from '@zhin.js/feature-kit';
import { FeatureProjector } from '../src/feature-projector.js';

it('supplies only the designated Feature with its private Host resource and never publishes it', async () => {
  const owner = rootPluginId(), feature = featureId('test.feature');
  const token = createFeaturePrivateToken<{ value: string }>('test.private.resource', feature);
  const ordinaryRootSecret = createRootPrivateToken<string>('test.private.unrelated');
  const scope = new Scope(owner), secret = { value: 'synthetic-private' };
  scope.provide(token, secret); scope.provide(ordinaryRootSecret, 'other'); scope.seal();
  const base: Omit<SnapshotState, 'projections'> = { root: owner, tree: new Map(), config: new Map(),
    resources: new Map([[owner, scope.snapshot()]]), capabilities: new Map() };
  const provider = defineFeatureProvider({ protocol: 1, id: feature, authoring: { conventions: [], validate: value => value },
    runtime: { project(_slots, context) {
      expect(context.snapshot.resources.get(owner)?.has(token.id)).toBe(false);
      expect(context.featureResource?.(token)).toBe(secret);
      expect(() => context.featureResource?.(ordinaryRootSecret)).toThrow(/Feature cannot access/);
      expect(() => context.featureResource?.(createToken(token.id))).toThrow(/Feature cannot access/);
      expect(context.featureResource?.(createFeaturePrivateToken(token.id, feature))).toBeUndefined();
      return { value: 'safe-projection' };
    } } });
  const projected = await new FeatureProjector([provider], scope).project(0, base, new AbortController().signal);
  expect(projected.state.resources.get(owner)?.has(token.id)).toBe(false);
  expect(JSON.stringify([...projected.state.projections])).not.toContain('synthetic-private');
  const other = defineFeatureProvider({ protocol: 1, id: featureId('other'), authoring: { conventions: [], validate: value => value },
    runtime: { project(_slots, context) { expect(() => context.featureResource?.(token)).toThrow(/Feature cannot access/); return { value: null }; } } });
  await new FeatureProjector([other], scope).project(0, base, new AbortController().signal);
});
