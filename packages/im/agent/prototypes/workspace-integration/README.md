# Workspace / Integration / Compensation prototype

> THROWAWAY PROTOTYPE for decision-map ticket #6. Delete the TUI after the workspace and side-effect contract is absorbed.

Question: can mutable Assignments receive fenced isolated workspaces, hand off immutable accepted Change Sets, integrate through a separate Task without auto-merging, and represent cancellation, irreversible effects and capability-declared compensation honestly?

Run:

```bash
pnpm prototype:workspace-integration
```

Run deterministic scenarios:

```bash
pnpm prototype:workspace-integration:check
```

Useful paths:

1. `1 → 2 → 3 → 4 → 5`: two Agents edit disjoint files from one base. Acceptance seals Change Sets but does not publish; a separately accepted/gated Integration Task commits by target revision CAS.
2. Restart, then `1 → x → 3 → 4 → r → 5`: same-file edits become an explicit Integration conflict. Resolution is a new candidate, not a silent last-writer merge.
3. `1 → k`: checkpoint rotates the fencing token; a replacement Assignment owns the same isolated state and stale writers are rejected.
4. `1 → c`: unpublished changes are discarded without pretending an external rollback occurred.
5. `e → e`: a committed PR is compensated only through the GitHub capability's declared `close_pr` operation; the original effect remains in history.
6. `i`: an irreversible email reaches `outcome_unknown`; it cannot be cancelled, blindly retried or compensated.

This prototype models Git worktree, overlay and sandbox volume as Workspace Provider backends behind one lease contract. Backend lifecycle is trusted Host work, not shell commands exposed to the Executor.
