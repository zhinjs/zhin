# Portfolio Admission prototype

> THROWAWAY PROTOTYPE for decision-map ticket #11. Delete it after the contract is absorbed into production.

This prototype tests a Portfolio control plane that arbitrates shared model,
executor, rate and cost capacity without merging Project queues or memory.

```bash
pnpm prototype:portfolio-admission
pnpm prototype:portfolio-admission:check
```

The executable scenarios cover opaque atomic Resource Bundles, weighted fair
service, bounded starvation, budget reservation, unknown usage, grant fencing,
offer expiry, Project pause and two-phase checkpoint reclaim.

The important negative guarantee is deliberate: the Portfolio state has no
Task, Plan, prompt, message, Artifact or Context field. It grants a leased
resource reservation; the owning Workroom Kernel alone may claim an Assignment
or change Task/Run state.
