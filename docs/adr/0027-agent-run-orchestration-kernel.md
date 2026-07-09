# ADR 0027: Agent Run Orchestration Kernel

## Status

Accepted.

## Context

Zhin had several competing orchestration paths: subagent spawning, remote mesh delegation, group-cell pipeline state, and five-agent AOP. They all needed the same capabilities: create a run, split work into tasks, assign tasks to executors, listen for progress, recover results, and expose status to Console.

## Decision

Introduce `OrchestrationKernel` as the only state transition authority for agent work.

| Concept | Meaning |
| --- | --- |
| `Run` | A user-visible unit of work, often sourced from an IM session or IM cell |
| `Task` | A stateful work item inside a run |
| `Assignment` | The chosen executor and target for a task |
| `Executor` | A local agent, group mention peer, or remote mesh worker |
| `RunEvent` | Append-only event describing run/task progress |
| `Projection` | Console, REST, IM group messages, or logs derived from kernel state |

### State Model

```ts
type RunStatus = 'open' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled'
type TaskStatus = 'pending' | 'assigned' | 'running' | 'waiting_result' | 'completed' | 'failed' | 'cancelled'
```

### Events

The event log includes at least:

- `run.started`
- `run.status_changed`
- `task.created`
- `task.assigned`
- `task.started`
- `task.thinking`
- `task.progress`
- `task.completed`
- `task.failed`
- `result.returned`

`task.thinking` stores only displayable summaries or progress notes. It must not store raw chain-of-thought.

### Executors

The kernel supports multiple executor kinds:

| Kind | Purpose |
| --- | --- |
| `local` | Execute a local `ZhinAgent` or subagent |
| `scene_mention` | Send a task into an IM group/channel as an `@` assignment and wait for handback ([ADR 0028](./0028-generic-im-scene-agent.md); legacy name `group_mention`) |
| `remote_mesh` | Delegate to a remote agent over **A2A** |

Executors emit execution events. They do not directly mutate task status.

### Workflow Strategies

`WorkflowStrategy` is optional planning logic that returns task specs. The kernel owns task creation, dependency resolution, execution, and snapshots.

Five-agent is implemented as one built-in strategy, not the default architecture.

## Consequences

- `spawn_task` creates or uses kernel tasks.
- Inbound group routing creates `scene_mention` tasks instead of directly advancing collaboration scene pipeline state.
- Console and REST should read kernel snapshots/event streams for run status.
- `CollaborationScene` remains valuable as member context and IM projection, but no longer owns orchestration state.

## Related

- [ADR 0028](./0028-generic-im-scene-agent.md)
- [ADR 0024](./0024-five-agent-aop-pipeline.md)

## Implementation

IM 组合层与 Kernel Port 的模块边界与调用表见 [`packages/im/agent/src/orchestrator/PORTS.md`](../../packages/im/agent/src/orchestrator/PORTS.md)。入站编排 wiring 在 `collaboration/inbound-turn-pipeline.ts`；路由与出站阶段分别为 `inbound-turn-route.ts` / `inbound-turn-outbound-stage.ts`（阶段 4）。
