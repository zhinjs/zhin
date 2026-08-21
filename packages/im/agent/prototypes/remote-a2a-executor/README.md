# Remote A2A Executor prototype

> THROWAWAY PROTOTYPE for decision-map ticket #8. Delete the TUI after the contract is absorbed into production.

Question: can a remote A2A agent execute the same Kernel-owned Assignment as a local Executor, using a versioned GitHub workspace reference, while at-least-once delivery, duplicate/out-of-order callbacks, disconnects, cancellation and takeover remain replayable and idempotent?

Run the interactive model:

```bash
pnpm prototype:remote-a2a
```

Run the executable scenarios:

```bash
pnpm prototype:remote-a2a:check
```

Useful sequences:

1. `n → u → r → a`: dispatch outcome becomes unknown, then retries the exact persisted `dispatchId/messageId` before attaching one remote A2A task.
2. `d → p`: remote discussion and progress are observable but cannot complete the Workroom Task.
3. `g → s`: a push callback sequence gap pauses at reconciliation; a typed full-task poll snapshot seals `assignment.execution_completed`, not `task.accepted`.
4. `f → t`: one authenticated event ID with conflicting hashes fails closed; Kernel revokes the old lease and creates a higher-fence Assignment on a new attempt branch.
5. `k → e → t → l`: a typed checkpoint seals one immutable commit; after lease expiry takeover starts from that commit, while late completion from the prior fence is stale. Without `k`, takeover restarts from the original base.
6. `c → x`: an unreachable remote cancel expires into local `cancelled + outcome_unknown`, so the control plane never waits forever or claims the remote stopped.

The prototype assumes an A2A v1 extension at `https://zhin.dev/a2a/extensions/workroom-assignment/v1`. A compatible Agent Card must advertise idempotent dispatch, typed completion and the GitHub workspace provider. Standard text-only A2A agents remain useful for non-authoritative discussion, but cannot claim a Workroom Assignment.

No local path, GitHub token or other secret crosses the wire. The dispatch carries opaque Context/Contract/Capability/Disclosure refs and a versioned `repositoryId + baseSha + targetRef + unique attempt branch + path scope + fence`. Completion returns immutable Report/Evidence refs plus exact `headSha` and optional PR receipt; a PR moving after completion creates a new/stale candidate rather than silently changing the accepted input.
