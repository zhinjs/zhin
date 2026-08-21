# Prototype verdict

Decision-map ticket #3 is resolved: Workroom collaboration needs an immutable Fact layer and role-specific Context Views; a shared Session transcript with weighted trimming is not a safe or accurate execution context.

## Direction integrity

The prototype does not change the accepted #1/#2 facts:

- Kernel Journal remains the only Run/Task/Plan authority.
- Orchestrator still proposes Plan Revisions and cannot dispatch directly.
- Executor/Reviewer remain role-bound Assignments with minimal capabilities.
- `execution_completed` still is not `accepted`; Context Digest never updates Project State.
- Agent discussion and IM projections remain non-authoritative.
- Workroom remains the Project isolation boundary.

Current-code observations are kept separate from target decisions:

- `ConversationActor` and `ConversationTurnCause` already preserve participant/control-turn attribution.
- `renderUserMessageForLlm` treats first-class actor as authoritative over legacy sender extra.
- Interactive turns currently load one flat Session context; role-specific Workroom views do not yet exist.
- Current persisted compaction injects a plain conversation summary without fact-level provenance. It remains valid for ordinary chat, but is not a Workroom Task/Project memory primitive.
- Current `TurnExecutionProfile` distinguishes interactive/schedule, not orchestrator/executor/reviewer.

## What the prototype proved

- Alice's Sponsor discussion remains discussion, while her policy-authorized steer becomes mandatory Task context. Actor role alone never infers intent.
- Bob's relevant suggestion can enter Executor context as explicitly untrusted `accepted_context`; his rejected merge/deploy control remains visible to Orchestrator audit and cannot enter Executor/Reviewer directly or through a digest.
- Orchestrator, Executor and Reviewer select materially different facts from the same immutable source log.
- Other Task events, ordinary Workroom chatter, Agent discussion and Console-only execution traces do not pollute Executor/Reviewer views.
- Compaction preserves source IDs/hash and actor/disposition, is role/Task/Plan-specific, never summarizes a digest, and becomes stale after a Plan revision.
- Evidence indexes expose metadata only. Content drill-down rechecks the current envelope; Developer can inspect accepted dependency evidence, cannot open review-sealed candidate evidence, and Reviewer can.
- If mandatory authority/Task/acceptance context exceeds budget, execution is blocked instead of silently dropping constraints.
- JSON serialization of facts reconstructs the same selection, exclusions, evidence index and rendered view.

## Production contract

- Add an append-only Workroom Fact projection sourced from canonical conversation events and Kernel Journal; do not create a second mutable truth store.
- Add a pure Context View Builder plus versioned Context Policy Snapshot in the Agent layer. Keep `@zhin.js/ai` free of IM/Workroom concepts.
- Extend Kernel-issued workroom execution profiles/envelopes rather than routing specialists through the ordinary interactive Session path.
- Record the Context View revision/manifest on every Assignment model invocation for audit and deterministic resume.
- Add an Envelope-aware Evidence Port; Artifact bodies and raw tool outputs are never eagerly injected.
- Keep ordinary chat Session history/compaction intact as a separate Interaction Space path.

## Deferred

- Ticket #4 owns accepted Project State and Task memory projection.
- Ticket #5 owns conversion from Workroom ingress/projection replies to Workroom Facts and TaskInput.
- Ticket #7 owns acceptance policy and Reviewer admission.
- Ticket #12 owns domain data classification, retention and disclosure vocabulary.
