/**
 * Process-wide registry of live collaboration hosts (ADR 0048 H2/H3).
 *
 * Delegated work outlives the turn that started it. Each host Mailbox
 * registers here; hosts and tests await {@link collaborationIdle} to know
 * when background collaboration settled, and {@link closeCollaborations}
 * stops it on shutdown. A host's `idle` covers its collaboration
 * engagements only, never the ordinary human turns of its long-lived
 * Mailbox (D3), so it may be awaited from inside another turn.
 */
export interface CollaborationHost {
  idle(): Promise<void>;
  close(reason?: string): Promise<void>;
}

const live = new Set<CollaborationHost>();

/** Tracks `harness` until `release` is called (normally when its host closes). */
export function registerCollaboration(harness: CollaborationHost): () => void {
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
