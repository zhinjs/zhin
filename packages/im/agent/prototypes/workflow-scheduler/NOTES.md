# Prototype verdict

Decision-map ticket #2 is resolved: replace the mutable TaskQueue with a persisted Workroom Inbox, immutable Plan Revisions and a pure deterministic Scheduler over Kernel facts.

## What the prototype proved

- A Task with dependencies remains `waiting_dependency`; only an accepted dependency emits readiness and allows dispatch.
- A new Inbox item or child Task enters execution only through a Plan Revision. Orchestrator proposals use base-revision CAS and cannot mutate the current queue directly.
- Sponsor lane and Orchestrator local rank are separate. Cross-lane escalation creates a bounded approval gate; Sponsor can approve or reject it, expiration defaults to rejection, and unrelated applied work keeps running.
- If another revision advances the Plan, older pending proposals become `stale` instead of leaving an impossible approval blocker.
- Required failures produce `needs_replan`; a replacement revision can supersede the logical Task. Optional work may settle by skip/failure without making the Run fail.
- A higher-priority or starvation-bounded Task can reserve a slot. Only checkpointable work is preempted; cooperative checkpoint and missed-deadline `outcome_unknown` paths both release capacity deterministically.
- Scheduler policy is part of the replayed Run snapshot. JSON serialization/replay produces the same readiness, ordering, reservation and Plan projection.

## Production contract

- Persist Inbox, Plan proposals/revisions, Scheduler policy and decisions in the Kernel Journal.
- Use stable logical task keys plus Task revisions; the prototype's raw `supersedes` IDs are only a shorthand.
- Implement Scheduler as a pure decision module. Competing schedulers append with expected sequence; an outbox dispatches idempotent Assignment commands.
- Keep deadlines as events/facts, not process-local timers. A wake-up service may prompt evaluation but owns no state.
- Delete `TaskQueue` rather than adapt its embedded execute callbacks, queue array, timer and competing statuses.
- Preserve #1's two-phase preemption/cancellation and Assignment lease semantics; Scheduler only consumes their projected facts.

## Deferred

- Ticket #5 owns how Inbox/control events are projected into Workroom and Sponsor Room.
- Ticket #7 owns risk-based acceptance gates.
- Ticket #11 owns cross-Project capacity admission and fairness; this Scheduler remains Project-local.
