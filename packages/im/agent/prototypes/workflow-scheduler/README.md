# Workflow Plan and Scheduler prototype

> THROWAWAY PROTOTYPE for decision-map ticket #2. Delete the TUI after its decisions are absorbed into production contracts.

Question: can a persisted, versioned Workflow Plan plus a pure Scheduler provide deterministic DAG readiness, dynamic insertion, bounded starvation and safe preemption without letting the Orchestrator or an in-memory queue mutate execution truth?

Run from the repository root:

```bash
pnpm prototype:workflow-scheduler
```

Useful paths:

1. `i → p → d → s → a → s`: the dependent Task cannot dispatch before its dependency is accepted.
2. `i → p → s → I → p → s → k → s`: an urgent Sponsor item reserves the slot, safely checkpoints normal work, then dispatches first.
3. Replace `k` with `t → s`: a missed preemption deadline still releases the slot with an `outcome_unknown` explanation inherited from Kernel policy.
4. `i → p → e`: the Orchestrator's cross-lane priority escalation pauses at Sponsor approval; `A` applies it and `z` rejects it. If its deadline expires, `s` defaults to rejection instead of leaving an immortal gate.
5. Add optional work with `o`; it may be skipped with `x`, but a required Task may not be skipped.
6. Advance time with `t`: once a lane's persisted starvation bound is exceeded, it wins a safe scheduling opportunity without rewriting its Sponsor priority.
7. `R`: JSON serialization and replay produce the same Plan/Scheduler projection.

The prototype deliberately treats execution/acceptance as one TUI action because ticket #1 already separated those Kernel transitions. The Scheduler consumes only accepted/failed/paused facts.
