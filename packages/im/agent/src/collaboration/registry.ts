/**
 * Process-wide registry of live collaboration harnesses (ADR 0048 H2).
 *
 * A turn's harness outlives the turn while delegated work is still running.
 * The engine registers each harness here; hosts and tests await
 * {@link collaborationIdle} to know when background collaboration settled,
 * and {@link closeCollaborations} stops it on shutdown.
 */
import type { Harness } from '@zhin.js/harness';

const live = new Set<Harness>();

/** Tracks `harness` until `release` is called (normally when its engagement closes). */
export function registerCollaboration(harness: Harness): () => void {
  live.add(harness);
  return () => { live.delete(harness); };
}

/** Resolves when every registered harness is idle (repeats until no new work appears). */
export async function collaborationIdle(): Promise<void> {
  for (let round = 0; round < 100; round += 1) {
    const pending = [...live];
    if (pending.length === 0) return;
    await Promise.all(pending.map((harness) => harness.idle()));
    if ([...live].every((harness) => pending.includes(harness))) return;
  }
}

/** Closes every registered harness (process shutdown, tests). */
export async function closeCollaborations(reason = 'shutdown'): Promise<void> {
  const pending = [...live];
  live.clear();
  await Promise.all(pending.map((harness) => harness.close(reason)));
}
