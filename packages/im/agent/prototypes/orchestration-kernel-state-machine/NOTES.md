# Prototype verdict

Decision-map ticket #1 is resolved: replace the current orchestration state model with one event-sourced Kernel state machine.

## What the prototype proved

- Replaying a serialized event journal reconstructs the same Run, Task, Assignment and Blocker state without an in-memory waiter or Dispatcher authority.
- Execution completion and acceptance remain separate transitions.
- A Task revision and an Assignment attempt are different counters. Reviewer rework starts a new revision with a fresh retry budget and globally unique Assignment IDs.
- Cooperative preemption persists a checkpoint. If an Executor ignores preemption, the control deadline still releases the Task as retryable (or failed when attempts are exhausted).
- Run cancellation settles even when an Executor never acknowledges it; the Assignment records `outcome_unknown` instead of claiming a clean rollback.
- Human/external blocking retains explicit owner, reason, deadline and `resolve/replan/cancel` actions after the deadline, so a timeout never removes human control.
- A Task reaches `accepted` only through the acceptance transition. Project memory must not consume `execution_completed` reports.

## Production boundary

- Absorb `decide/evolve/replay` into a versioned Kernel domain module.
- Replace arbitrary repository status updates with transactional `append(expectedSequence, events)` plus snapshot/replay reads.
- Make AgentDispatcher a disposable executor/availability projection.
- Remove TaskQueue as a competing state machine; ticket #2 replaces it with a Scheduler over Kernel facts.
- Resolve generation-owned repositories, schedulers and executors through the current operation's Resource snapshot; do not introduce another `createGenerationStore`.
- Delete this TUI after the production transition tests encode the same scenarios.

## Intentionally deferred to ticket #2

- Required versus optional Tasks and the exact Run close rule.
- Priority, aging, capacity, dependency readiness and safe-point preemption policy.
- Deadline escalation policy for Blockers and control requests.
