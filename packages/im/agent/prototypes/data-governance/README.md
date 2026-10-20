# Data Governance prototype

> THROWAWAY PROTOTYPE for decision-map ticket #12. Delete the TUI after the contract is absorbed into production.

This prototype asks whether one policy module can govern disclosure and
retention for customer-support and investment-research Workrooms without
putting sensitive payloads in an immutable Journal.

```bash
pnpm prototype:data-governance
pnpm prototype:data-governance:check
```

The TUI lets you switch domain Profile, select a Data Object and send the same
object toward a model Context View, Workroom/Sponsor projection, Console or A2A
destination. You can apply a trusted deterministic transform, approve an exact
external disclosure, place/release Retention Holds, request erasure and drive a
multi-location Purge Plan.

The pure module has two deep interfaces: `evaluateDisclosure()` hides
classification/purpose/scope/recipient/residency/transform/approval rules, while
the Governance Journal handles retention, holds, erasure, purge receipts and
content-free audit history. The prototype is not a claim of legal compliance.
