# ADR 0023: CollaborationScene multi-endpoint agent collaboration

## Status

Accepted, revised by [ADR 0027](./0027-agent-run-orchestration-kernel.md) and [ADR 0028](./0028-generic-im-scene-agent.md).

## Context

Zhin needs a first-class experience where multiple real bots in the same IM group can collaborate visibly. Earlier designs stored pipeline state on the collaboration unit and used group chat as the orchestration plane. That coupled IM projection, task state, and five-agent workflow too tightly.

## Decision

`CollaborationScene` (formerly `CollaborationCell`) is **not** the orchestration state machine. It is the **collaboration plane** over one or more IM scenes:

| Concept | Owner | Responsibility |
| --- | --- | --- |
| Transport Actor | Endpoint | Platform identity used for outbound messages |
| Cognitive Profile | `ai.agents` / `.agent.md` | Model, prompt, tools, and policy |
| Runtime | `ZhinAgent` per endpoint | Executes local turns and local tasks |
| Collaboration Scene | `CollaborationScene` | Logical unit, member directory, endpoint/profile mapping, group projection context |
| IM Scene | `IMSceneRef` | Platform group/channel/private identity ([ADR 0028](./0028-generic-im-scene-agent.md)) |
| Run State | `OrchestrationKernel` | Runs, tasks, assignments, events, state transitions |

Run-to-scene linkage:

```ts
run.source = {
  kind: 'im_scene',
  scene: { platform, endpointId, sceneId, kind },
  collaborationSceneId, // optional CollaborationScene.id
}
```

### Invariants

1. Identity follows outbound: when a peer endpoint should speak, the scene executor sends an actual IM mention instead of making the planner impersonate that peer.
2. Cognition follows profile: agent configuration does not imply transport identity.
3. Coordination follows the kernel: runs, tasks, assignments, handback, progress, and result recovery are kernel events.
4. Platform remains a projection bus: group messages are a visible projection of assignments and results, not the source of truth for task state.

### Scene Mention Executor

Group collaboration uses `scene_mention` (`group_mention` is a read-time alias only).

- Assignment emits a group/channel mention containing `#taskId`.
- Handback first matches an explicit `#taskId`.
- If no `#taskId` exists and the `(collaborationSceneId, endpoint)` pair has exactly one active assignment, the reply is attributed to that task.
- Private scenes **cannot** use `scene_mention`.

### Persistence

Tables (new installs, [ADR 0028](./0028-generic-im-scene-agent.md)):

- `collaboration_scenes` — id, adapter, scene_id (IM), goal, optional legacy pipeline fields
- `collaboration_scene_members` — collaboration_scene_id, endpoint_id, roles
- `collaboration_scene_aliases` — logical_scene_id ↔ adapter/scene_id
- `collaboration_scene_member_channels` — cross-adapter identity edges

Host REST: `/api/collaboration/scenes*` (members, pipeline, artifacts sub-resources).

### User commands

`/collab init`, `bind`, `status`, etc. remain the in-chat management surface. Master endpoint gate unchanged.

## Consequences

- Console collaboration REST manages scenes and members; run snapshots and event streams come from the kernel.
- Existing group-chat collaboration remains visible to users; implementation evolves independently of the core run state machine.
- Five-agent collaboration is a workflow strategy over kernel tasks, not a scene-level state machine.

### Passive Group Context（Amended 2026-07）

- 群/频道 **未 @** 入站写入进程内 passive buffer（**不持久化**）；`MAX_PASSIVE_LINES=50`、`PASSIVE_TTL_MS=30min`。
- Session key 与 `resolveAgentTurnSessionKey` 一致；`bindRun = delegationRunId ?? runId`。
- Pipeline **reset** 后新 run **不继承** 旧 passive buffer（与 run 隔离一致）。
- 实现：[`session/passive-group-session.ts`](../../packages/im/agent/src/session/passive-group-session.ts)、[`passive-group-buffer.ts`](../../packages/im/agent/src/session/passive-group-buffer.ts)。

## Related

- [ADR 0028](./0028-generic-im-scene-agent.md)
- [ADR 0027](./0027-agent-run-orchestration-kernel.md)
- [ADR 0024](./0024-five-agent-aop-pipeline.md)
- [ADR 0025](./0025-adapter-ai-outbound-json.md)
