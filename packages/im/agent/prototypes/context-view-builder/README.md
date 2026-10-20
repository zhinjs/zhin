# Role-specific Context View prototype

> THROWAWAY PROTOTYPE for decision-map ticket #3. Delete the TUI after the Context View contract is absorbed.

Question: can one immutable Workroom fact log build bounded, role-specific views for Orchestrator, Executor and Reviewer without treating shared chat, summaries or Agent discussion as authority?

Run:

```bash
pnpm prototype:context-view
```

Useful paths:

1. Press `v` to compare the three roles. Orchestrator sees Plan/Inbox/status summaries; Executor sees only its Task contract, accepted dependencies and targeted TaskInput; Reviewer sees acceptance contract, candidate report and evidence index.
2. Press `b`: Bob's unauthorized control attempt remains auditable in the Orchestrator routing view but never becomes an Executor directive.
3. Press `s`: Alice's policy-authorized steering becomes mandatory Task context and a Reviewer-visible requirement change.
4. Press `n` repeatedly: unrelated group chatter consumes only optional Orchestrator budget and never enters Executor/Reviewer views.
5. Press `c`: role-specific digests replace older eligible facts while retaining source IDs/hash. Applied controls, policies and Task contracts are never compacted.
6. Press `p`: a new Plan revision invalidates old digests instead of recursively summarizing them.
7. Press `t`: mandatory authority/acceptance context is never silently dropped; an insufficient budget returns `context_budget_exceeded`.
8. Press `d`: evidence content is resolved only after re-authorizing the reference against the current Execution Envelope.
9. Press `R`: serialized facts reconstruct the identical view.
