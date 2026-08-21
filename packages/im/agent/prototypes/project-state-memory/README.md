# Project State Memory prototype

> THROWAWAY PROTOTYPE for decision-map ticket #4. Delete the TUI after the memory projection contract is absorbed.

Question: can accepted Task Reports create provenance-rich Task Memory and Project State, release hot execution context, preserve disputes/staleness and rebuild from accepted sources without recursively summarizing old summaries?

Run:

```bash
pnpm prototype:project-memory
```

Run the deterministic scenarios:

```bash
pnpm prototype:project-memory:check
```

Useful paths:

1. `u`: submit an unsafe `execution_completed` report. Project State and Task Memory remain empty. `x` rejects it without semantic memory side effects.
2. `1 → a`: acceptance creates Task Memory, applies a State Patch, updates the Project snapshot, then releases hot execution context.
3. `2 → a`: a contradictory accepted Node claim produces `disputed`; confidence or recency never overwrites the earlier fact.
4. `r`: a Sponsor-accepted conflict resolution selects one source and marks the loser stale. Alternatively, `3 → a` accepts rework with explicit supersession and produces the verified `20,22` fact.
5. `4 → a → t`: an accepted working assumption is recalled as `assumed`, then becomes `stale` after its validity condition expires.
6. `s`: recall returns current status/provenance plus accepted Task Memories and Evidence refs—not a free-form summary blob.
7. `R`: removes all derived memory events and deterministically rebuilds them from report, acceptance, accepted resolution and clock source events.

Task Memory is generated directly from the accepted Task Report and Acceptance Record, and its display summary is derived only from accepted claims. Project State Patch reads accepted structured claims, never Task Memory text, free-form report summary or a previous Project snapshot.
