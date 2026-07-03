# ADR 0023: GroupCell multi-endpoint agent collaboration

## Status

Accepted, revised by [ADR 0027](./0027-agent-run-orchestration-kernel.md).

## Context

Zhin needs a first-class experience where multiple real bots in the same IM group can collaborate visibly. Earlier designs made `CollaborationCell` carry pipeline state and made group chat the orchestration plane. That made the IM projection, task state machine, and five-agent workflow too tightly coupled.

## Decision

`CollaborationCell` is no longer the orchestration state machine. It is an IM scene abstraction:

| Concept | Owner | Responsibility |
| --- | --- | --- |
| Transport Actor | Endpoint | Platform identity used for outbound messages |
| Cognitive Profile | `ai.agents` / `.agent.md` | Model, prompt, tools, and policy |
| Runtime | `ZhinAgent` per endpoint | Executes local turns and local tasks |
| Collaboration Scene | `CollaborationCell` | Logical scene, member directory, endpoint/profile mapping, group projection context |
| Run State | `OrchestrationKernel` | Runs, tasks, assignments, events, state transitions |

Run-to-cell linkage is expressed by:

```ts
run.source = {
  kind: 'im_cell',
  cellId,
  adapter,
  sceneId,
}
```

### Invariants

1. Identity follows outbound: when a peer endpoint should speak, the group executor sends an actual IM mention instead of making the planner impersonate that peer.
2. Cognition follows profile: agent configuration does not imply transport identity.
3. Coordination follows the kernel: runs, tasks, assignments, handback, progress, and result recovery are kernel events.
4. Platform remains a projection bus: group messages are a visible projection of assignments and results, not the source of truth for task state.

### Group Mention Executor

The group collaboration feature is preserved through `GroupMentionExecutor`.

- Assignment emits a group mention containing `#taskId`.
- Handback first matches an explicit `#taskId`.
- If no `#taskId` exists and the `(cell, endpoint)` pair has exactly one active assignment, the reply is attributed to that task.
- If multiple active assignments exist and no `#taskId` is present, the kernel records `task.progress` and the bot asks the peer to include the task id.

### Cell Data

The cell store keeps scene and membership data only:

- `id`, `adapter`, `sceneId`
- logical scene aliases
- members and endpoint/profile mapping
- optional goal text for group context

Historical fields such as `pipelineState`, `missionRunId`, and `pipelineRole` may still exist during migration, but they are not the orchestration contract.

## Consequences

- Console collaboration REST manages cells and members; run snapshots and event streams come from the kernel.
- Existing group-chat collaboration remains visible to users, but implementation can evolve independently of the core run state machine.
- Five-agent collaboration is a workflow strategy over kernel tasks, not a cell-level state machine.

## Related

- [ADR 0027](./0027-agent-run-orchestration-kernel.md)
- [ADR 0024](./0024-five-agent-aop-pipeline.md)
- [ADR 0025](./0025-adapter-ai-outbound-json.md)
