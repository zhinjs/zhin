import {
  DisposeStack,
  GenerationHandoffStack,
  createSnapshotView,
  type Dispose,
  type FeatureId,
  type GenerationHandoff,
  type SnapshotState,
} from '@zhin.js/plugin-runtime';
import type { FeatureProvider } from '@zhin.js/feature-kit';

export type ProjectionState = Omit<SnapshotState, 'projections'>;

export interface ProjectedFeatures {
  readonly state: SnapshotState;
  readonly disposers: ReadonlyMap<FeatureId, Dispose>;
  readonly handoff?: GenerationHandoff;
}

/** Builds selected Feature projections against one coherent candidate snapshot. */
export class FeatureProjector {
  constructor(private readonly providers: Iterable<FeatureProvider>) {}

  async project(
    generation: number,
    base: ProjectionState,
    retained: ReadonlyMap<FeatureId, unknown> = new Map(),
  ): Promise<ProjectedFeatures> {
    // Slot HMR seeds this map with the committed projections. Only providers
    // passed to this projector replace their entry; every other Feature keeps
    // its live instance and therefore keeps its external resources running.
    const projections = new Map<FeatureId, unknown>(retained);
    const disposers = new Map<FeatureId, Dispose>();
    const handoffs = new GenerationHandoffStack();
    const state: SnapshotState = { ...base, projections };

    try {
      for (const provider of this.providers) {
        const slots = [...base.capabilities.values()].filter(
          (slot) => slot.feature === provider.id,
        );
        const projection = await provider.runtime.project(slots, {
          snapshot: createSnapshotView(generation, state),
        });
        projections.set(provider.id, projection.value);
        if (projection.dispose) disposers.set(provider.id, projection.dispose);
        if (projection.handoff) handoffs.add(projection.handoff);
      }
      return {
        state,
        disposers,
        handoff: handoffs.seal(),
      };
    } catch (error) {
      await rollback(disposers.values(), error);
      throw error;
    }
  }
}

export function composeGenerationHandoffs(
  ...handoffs: readonly (GenerationHandoff | undefined)[]
): GenerationHandoff | undefined {
  const stack = new GenerationHandoffStack();
  for (const handoff of handoffs) {
    if (handoff) stack.add(handoff);
  }
  return stack.seal();
}

async function rollback(disposers: Iterable<Dispose>, prepareError: unknown): Promise<void> {
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
