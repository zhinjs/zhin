# Orchestration Kernel v2 prototype

> THROWAWAY PROTOTYPE for decision-map ticket #1. Delete or absorb it after the state-model decision is captured.

Question: can a single event-sourced Kernel represent blocking, role-bound assignments, lease recovery, safe preemption, cancellation and acceptance without a second mutable Dispatcher/TaskQueue authority?

Run from the repository root:

```bash
pnpm prototype:orchestration-kernel
```

The terminal redraws the complete replayed state after each command. Useful paths to try:

1. `n → c → s → f → a`: execution completion remains non-terminal until acceptance.
2. `n → c → s → p → k → u → c → s`: safe preemption persists a checkpoint and resume creates a new Assignment attempt.
3. `n → c → s → t → t`: lease expiry makes the first attempt retryable; expiration of the second attempt fails the Task.
4. `n → c → s → X → t`: Run cancellation remains controllable even if the Executor never acknowledges it.
5. `n → b`: every blocker exposes owner, reason, deadline and allowed actions.
6. `R`: serialize and replay the journal to confirm that no in-memory projection is authoritative.
