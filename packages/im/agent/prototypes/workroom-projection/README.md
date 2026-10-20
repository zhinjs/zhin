# Workroom / Sponsor Room projection prototype

> THROWAWAY PROTOTYPE for decision-map ticket #5. Delete the TUI after the routing and projection contract is absorbed.

Question: can Interaction Space be resolved before Agent trigger, while Kernel facts become curated named-Agent Workroom messages and a lossless Console timeline, replies/mentions become provenance-rich TaskInput proposals, Sponsor writes require an exact Project target, and no IM delivery becomes state authority?

Run:

```bash
pnpm prototype:workroom-projection
```

Run deterministic scenarios:

```bash
pnpm prototype:workroom-projection:check
```

Useful paths:

1. `d → r`: deliver Architect's milestone, then reply to it. The durable message index resolves the exact Assignment, but ingress still goes to Orchestrator as a TaskInput proposal.
2. `m` / `a`: a unique logical alias resolves through the Project Agent Directory; duplicate aliases require clarification.
3. `u`: unaddressed Workroom text enters only Orchestrator's inbox.
4. `e`: an echoed outbound bot message is suppressed before ingress.
5. `f → f`: a failed Sponsor delivery retries the same outbox item; Kernel facts do not change.
6. `s` / `p`: an untargeted Sponsor control is ambiguous; replying to a single-project card yields a Project-scoped control proposal.
7. `c`: an unbound canonical conversation remains ordinary chat.

The prototype deliberately models one logical Bot account rendering named Agent identities. Multiple platform Bot identities may be selected by a delivery adapter, but they do not alter Agent authority, target resolution or Kernel state.
