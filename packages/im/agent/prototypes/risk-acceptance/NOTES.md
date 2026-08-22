# Verdict

Decision-map ticket #7 is answered.

- Acceptance is a Kernel-owned projection over immutable Candidate, Acceptance Contract, Risk Facts, Check Results, Reviewer Verdict and Sponsor Gate facts. The Orchestrator may request evaluation, but its model output is not the acceptor; the recorded acceptor is the pinned policy snapshot.
- Kernel derives a hash-bound Risk Assessment from trusted Plan/capability/Artifact/Effect metadata; an Executor cannot submit its own authoritative risk. Classification is a conservative lattice over side effect, reversibility, data class, blast radius, capability tags and uncertainty. A high dimension cannot be hidden by several low dimensions. Missing risk/evidence/check facts fail closed.
- The baseline routing matrix is: low + fully mechanical → policy auto-accept; medium or any qualitative criterion → independent Reviewer; high/critical mechanical → Sponsor; high/critical qualitative → Reviewer then Sponsor. Domain snapshots may add gates or deny capabilities, never weaken the baseline. Reviewer is therefore created only when policy requires it.
- Deterministic criterion failure is a hard rework result. Sponsor approval cannot waive it or grant new tool authority. Changing a criterion requires a new auditable contract/task revision.
- Executor may only submit a Candidate. It cannot invoke acceptance, record trusted checks, review itself or approve a gate. Reviewer is a separate Assignment/principal with candidate/evidence read access and no producer/effect authority.
- Reviewer verdicts disposition every criterion and claim. Reviewer recommendations are inputs to the policy projector, not direct state mutation. Acceptance Records preserve accepted/rejected claim IDs for Project State Memory.
- Sponsor approval binds candidate hash, contract revision, policy snapshot, scope owner and deadline. Candidate replacement makes prior Reviewer/Gate facts stale; late approval cannot cross the digest boundary.
- Task/Integration acceptance and Effect authorization are distinct. Approval of an Effect Intent means it may execute; it does not claim it executed, succeeded or can be rolled back.
- Reviewer and Sponsor waits have durable owner/deadline/allowed actions. Timeout becomes a recoverable blocked/expired state; re-open/reassign/replan/cancel never depends on the blocked Agent responding.
- Policy snapshots are immutable and pinned by Acceptance Contract, so HMR or a newly installed policy does not alter an in-flight replay.

Current-code audit: `ApprovalPort` and `tool-approval-gate.ts` are Turn-local security confirmations and cannot serve as durable Workroom acceptance. The current `workroom/kernel-state.ts` correctly separates `assignment.execution_completed` from `task.accepted`, but its public `accept_task` command has no acceptor, policy, evidence, claim disposition or separation-of-duty check. Production should replace that unconstrained command with an acceptance-policy decision port that emits the only valid `task.accepted`/`effect.authorized` facts.

Deferred without changing #7 facts: #8 maps Remote A2A reports to the same Candidate/contract/hash boundary; #9 owns migration of legacy orchestration APIs; #10 packages the matrix into versioned domain Profiles; #12 owns retention and disclosure of acceptance evidence.
