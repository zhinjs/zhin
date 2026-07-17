import {
  DisposeStack,
  GenerationHandoffStack,
  createSnapshotView,
  type Dispose,
  type FeatureId,
  type GenerationHandoff,
  type SnapshotState,
} from '@zhin.js/next-kernel';
import type { FeatureProvider } from '@zhin.js/next-feature-kit';

export type ProjectionState = Omit<SnapshotState, 'projections'>;

export interface ProjectedFeatures {
  readonly state: SnapshotState;
  readonly disposers: readonly Dispose[];
  readonly handoff?: GenerationHandoff;
}

/** Builds every Feature projection against one coherent candidate snapshot. */
export class FeatureProjector {
  constructor(private readonly providers: Iterable<FeatureProvider>) {}

  async project(generation: number, base: ProjectionState): Promise<ProjectedFeatures> {
    const projections = new Map<FeatureId, unknown>();
    const disposers: Dispose[] = [];
    const handoffs = new GenerationHandoffStack();
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
        if (projection.handoff) handoffs.add(projection.handoff);
      }
      return {
        state,
        disposers: Object.freeze(disposers),
        handoff: handoffs.seal(),
      };
    } catch (error) {
      await rollback(disposers, error);
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
