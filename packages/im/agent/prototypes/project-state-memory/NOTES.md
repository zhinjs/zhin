# Prototype verdict

Decision-map ticket #4 is answered.

- Direction remains consistent with #1–#3: Kernel events stay authoritative; `execution_completed` is not acceptance; Context Digest and chat/session summaries remain non-authoritative; Evidence access is re-authorized through the role-bound envelope.
- The existing generic semantic memory repository is intentionally not reused: its free-form key/content upsert is last-write-wins and lacks Project/Acceptance provenance. Existing Session compaction remains a chat-context optimization.
- Accepted sources are report/acceptance records, accepted conflict decisions and persisted clock/validity facts. Task Memory, State Patch and Snapshot are deterministic projections, never sources for later summaries.
- A Task acceptance dispositions every report claim as accepted or rejected. The task can be accepted without promoting every claim; free-form report summary is not copied into authoritative Task Memory.
- Contradictory accepted values become disputed. Accepted resolution or accepted rework with exact supersedes makes losers stale. Starting a new Plan/Task revision alone never rewrites accepted state.
- Execution context is released only after Task Memory and Project State projection; durable journal, evidence, artifacts and checkpoints remain.
- `scenarios.ts` passed unaccepted/rejected isolation, acceptance, conflict, resolution, corrective rework, expiry, recall, context release and accepted-source rebuild equality.

Deferred, without changing #4 facts: #7 owns who may accept/revoke at each risk tier; #10 owns schema/profile migration; #12 owns retention and disclosure of retained sources.
