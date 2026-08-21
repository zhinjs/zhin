# Prototype verdict

Decision-map ticket #6 is answered.

- Direction remains consistent with #1–#5: Kernel Journal owns state; Assignment, Task Acceptance and Integration are distinct; projection delivery and Agent discussion cannot publish changes.
- Current `workspaceRoot=projectRoot` and shared sub-agent workspace are insufficient. Existing file containment, ToolExecutionAuthority and sandbox limits remain useful only after filesystem authority is rebound to an Assignment Workspace Lease.
- Trusted Workspace Providers own worktree/overlay/sandbox-volume lifecycle. Worktree isolates writes but is not a security boundary. Fencing prevents a lost/old Assignment from continuing after checkpoint takeover.
- `execution_completed` seals an immutable Change Set. Producer acceptance does not merge. A separately planned Integration Task applies accepted Change Sets in deterministic order and emits an isolated candidate.
- Overlap/upstream conflicts become explicit Integration blockers; resolution produces a new candidate and requires acceptance. Canonical publication uses target revision CAS and becomes stale when the target moves.
- Unpublished cancellation means discard, not compensation. Durable Change Set/Report/checkpoint/audit survive workspace cleanup.
- External actions use a prepare-before-call Effect Ledger with idempotency, risk, reversibility and receipts. Once a call starts, cancellation cannot claim it did not happen; missing receipt becomes `outcome_unknown`.
- Compensation is capability-declared and recorded as a new effect. Success, failure and unknown remain visible; irreversible effects cannot be given an invented rollback.
- `scenarios.ts` passed isolated parallel edits, no auto-merge, clean integration, same-file conflict, CAS stale target, fenced recovery, discard, gated effect, irreversible unknown, compensation success and compensation failure.

Deferred without changing #6 facts: #7 decides deterministic/Reviewer/Sponsor acceptance and gate thresholds; #8 maps remote A2A workspaces to the same lease/change-set contract; #12 owns artifact/workspace/effect receipt retention and disclosure.
