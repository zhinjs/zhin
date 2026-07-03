# ADR 0024: Five-agent AOP pipeline

## Status

Superseded by [ADR 0027](./0027-agent-run-orchestration-kernel.md).

## Context

The previous design made Planner / Researcher / Evaluator / Executor / Reviewer the default orchestration plane. It stored stage, todo, active delegations, artifacts, and handback behavior in `CollaborationCell.pipelineState`, and exposed tools such as `group_delegate` and `cell_advance_stage` directly to the model.

That design proved too rigid:

- It made every multi-agent interaction look like a five-role pipeline.
- It coupled IM group membership to task state.
- It made post-turn harness behavior part of the main path.
- It made local subagents, remote mesh agents, and group peers use different state machines.

## Decision

Five-agent is retained only as an optional `WorkflowStrategy`.

```ts
kernel.registerWorkflowStrategy(createFiveAgentWorkflowStrategy())
await kernel.runWorkflowStrategy('five-agent', input)
```

The strategy creates a task graph:

1. Planner decomposes the goal.
2. Researcher gathers facts.
3. Evaluator chooses an approach and records a concise decision summary.
4. Executor produces the deliverable.
5. Reviewer verifies the result.

Roles are task metadata. They do not write to `CollaborationCell`, and they do not own state transitions. The only state transition authority is `OrchestrationKernel`.

## Migration Notes

- `PipelineService`, pipeline tools, and post-turn harness are legacy implementation details.
- `group_delegate` is not a public model-facing orchestration tool in the default path.
- New strategies should emit `WorkflowTaskSpec[]` and let the kernel create tasks, resolve dependencies, run executors, and publish events.
- Visible reasoning must be stored as `task.thinking` summaries or `task.progress`, never raw chain-of-thought.

## Consequences

- The default agent path is simpler: user input becomes a run/task handled by a selected executor.
- Five-agent remains available for projects that explicitly opt into that workflow.
- Group-chat collaboration can use the same task graph, but appears through `GroupMentionExecutor` and IM projections.

## Related

- [ADR 0027](./0027-agent-run-orchestration-kernel.md)
- [ADR 0023](./0023-group-cell-multi-endpoint-agents.md)
