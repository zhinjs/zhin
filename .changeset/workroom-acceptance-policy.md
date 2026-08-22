---
'@zhin.js/agent': patch
---

Remove the unconstrained `accept_task` Workroom command. Task acceptance now enters through a trusted `WorkroomAcceptancePolicyDecisionPort`; the Kernel validates exact Task/Assignment/candidate bindings and permits automatic acceptance only for low-risk, fully deterministic, evidence-complete candidates before appending a structured Acceptance Record with Journal CAS.

Pre-policy `task.accepted` journal entries do not satisfy the new record schema and must be exported for audit and replanned instead of being silently promoted to accepted Project state.

Task revisions must now pin an immutable Acceptance Contract and Policy snapshot before an Executor can claim them. The standard Agent Host resolves the provider through the generation-owned `workroomAcceptancePolicyDecisionToken`, so hot reload cannot replace the contract already recorded in a Run.

Policy routes that require judgment or high-risk authority now append durable, candidate-hash-bound Reviewer Assignment or Sponsor Gate facts. Each wait records its pinned Contract/Policy, owner, deadline and recovery actions; expiry is replayable and can be reopened by a fresh policy evaluation, replanned or cancelled without waiting for an Agent response.

Reviewer claims/verdicts and Sponsor decisions now enter through typed Kernel methods backed by a generation-owned `WorkroomAcceptanceAuthorityPort`. Every authorization is rebound to the exact Project, Run, Task, target and Journal sequence; producer self-review, stale candidates, incomplete criterion/claim disposition and untrusted authority are rejected. Reviewer-only and Reviewer-then-Sponsor routes now produce replayable Acceptance Records with principal and control-target proof.
