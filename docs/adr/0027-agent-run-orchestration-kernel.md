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
| `group_mention` | Send a task into an IM group as an `@` assignment and wait for handback |
| `remote_mesh` | Delegate to a remote agent over MCP/HTTP |

Executors emit execution events. They do not directly mutate task status.

### Workflow Strategies

`WorkflowStrategy` is optional planning logic that returns task specs. The kernel owns task creation, dependency resolution, execution, and snapshots.

Five-agent is implemented as one built-in strategy, not the default architecture.

## Consequences

- `spawn_task` creates or uses kernel tasks.
- Inbound group routing creates `group_mention` tasks instead of directly advancing cell pipeline state.
- Console and REST should read kernel snapshots/event streams for run status.
- `CollaborationCell` remains valuable as IM scene and member context, but no longer owns orchestration state.

## Related

- [ADR 0023](./0023-group-cell-multi-endpoint-agents.md)
- [ADR 0024](./0024-five-agent-aop-pipeline.md)
