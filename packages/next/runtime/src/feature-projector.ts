import {
  DisposeStack,
  createSnapshotView,
  type Dispose,
  type FeatureId,
  type SnapshotState,
} from '@zhin.js/next-kernel';
import type { FeatureProvider } from '@zhin.js/next-feature-kit';

export type ProjectionState = Omit<SnapshotState, 'projections'>;

export interface ProjectedFeatures {
  readonly state: SnapshotState;
  readonly disposers: readonly Dispose[];
}

/** Builds every Feature projection against one coherent candidate snapshot. */
export class FeatureProjector {
  constructor(private readonly providers: Iterable<FeatureProvider>) {}

  async project(generation: number, base: ProjectionState): Promise<ProjectedFeatures> {
    const projections = new Map<FeatureId, unknown>();
    const disposers: Dispose[] = [];
    const state: SnapshotState = { ...base, projections };

    try {
      // A projection may capture its snapshot. Rebuilding every projection
      // prevents unchanged Features from retaining an older generation.
      for (const provider of this.providers) {
        const slots = [...base.capabilities.values()].filter(
          (slot) => slot.feature === provider.id,
        );
        const projection = await provider.runtime.project(slots, {
          snapshot: createSnapshotView(generation, state),
        });
        projections.set(provider.id, projection.value);
        if (projection.dispose) disposers.push(projection.dispose);
      }
      return { state, disposers: Object.freeze(disposers) };
    } catch (error) {
      await rollback(disposers, error);
      throw error;
    }
  }
}

async function rollback(disposers: readonly Dispose[], prepareError: unknown): Promise<void> {
  const stack = new DisposeStack();
  for (const dispose of disposers) stack.add(dispose);
  try {
    await stack.dispose();
  } catch (disposeError) {
    throw new AggregateError(
      [prepareError, disposeError],
      'Feature projection and rollback both failed',
      { cause: disposeError },
    );
  }
}
