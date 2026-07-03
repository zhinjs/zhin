/**
 * RosterRound WorkflowStrategy — sequential "轮流发言" over kernel tasks.
 *
 * Replaces the ADR 0026 RosterRound post-turn harness. Instead of mutating
 * cell-level round state, the roster round is expressed as a chain
 * of `group_mention` tasks (one per member, in pipeline-role order), each
 * depending on the previous. The kernel owns the state; the IM group is a
 * projection.
 */
import type { WorkflowStrategy, WorkflowTaskSpec } from '../../orchestrator/kernel-types.js';
import type { OrchestrationRunSource } from '@zhin.js/ai';
import type { Message } from '@zhin.js/core';
import { resolveIMSessionIdFromMessage } from '@zhin.js/ai';
import { getOrchestrationService } from '../../orchestrator/orchestration-service.js';
import { getCollaborationCellService } from '../../collaboration/cell-service.js';
import type { CollaborationCell } from '../../collaboration/types.js';

export const ROSTER_ROUND_WORKFLOW_STRATEGY_NAME = 'roster-round';

const ROSTER_ORDER = ['researcher', 'evaluator', 'executor', 'reviewer'] as const;

export function resolveRosterEndpointIds(cell: CollaborationCell): string[] {
  const ids: string[] = [];
  for (const role of ROSTER_ORDER) {
    const ep = cell.members.find((m) => m.pipelineRole === role)?.endpointId;
    if (ep) ids.push(ep);
  }
  return ids;
}

function rosterPingText(cell: CollaborationCell, endpointId: string, goal: string): string {
  const member = cell.members.find((m) => m.endpointId === endpointId);
  const role = member?.pipelineRole ?? member?.primary ?? '成员';
  if (/自我介绍|介绍一下/i.test(goal)) {
    return `请向大家做一段简短的自我介绍（2–4 句），说完后再 handback @Planner。`;
  }
  return `${role}，请按顺序发言（2–4 句公开回复），说完后再 handback @Planner。`;
}

function resolveCellFromSource(source: OrchestrationRunSource | undefined): CollaborationCell | undefined {
  if (source?.kind !== 'im_cell') return undefined;
  const cells = getCollaborationCellService().listCells();
  return cells.find((c) => c.id === source.cellId);
}

/**
 * WorkflowStrategy: returns a chain of group_mention tasks in roster order.
 * Each task depends on the previous, so a dependency-aware runner executes
 * them sequentially.
 */
export function createRosterRoundWorkflowStrategy(): WorkflowStrategy {
  return {
    name: ROSTER_ROUND_WORKFLOW_STRATEGY_NAME,
    plan(input): WorkflowTaskSpec[] {
      const cell = resolveCellFromSource(input.run.source);
      if (!cell) return [];
      const order = resolveRosterEndpointIds(cell);
      const goal = input.goal;
      const specs: WorkflowTaskSpec[] = [];
      let prevKey: string | undefined;
      for (const endpointId of order) {
        const key = `roster:${endpointId}`;
        specs.push({
          key,
          name: `@${endpointId}`,
          description: rosterPingText(cell, endpointId, goal),
          goal: rosterPingText(cell, endpointId, goal),
          role: 'worker',
          executorKind: 'group_mention',
          assignedTo: endpointId,
          dependsOn: prevKey ? [prevKey] : undefined,
          context: { workflow: ROSTER_ROUND_WORKFLOW_STRATEGY_NAME, endpointId },
        });
        prevKey = key;
      }
      return specs;
    },
  };
}

/**
 * Practical driver: run a roster round sequentially against the kernel.
 * Dispatches one group_mention task at a time, waits for handback, then
 * proceeds to the next member. Used by /collab and ceremony detection.
 */
export async function runRosterRound(input: {
  message: Message;
  cell: CollaborationCell;
  goal: string;
}): Promise<{ runId: string; taskIds: string[] }> {
  const { message, cell, goal } = input;
  const orch = getOrchestrationService();
  if (!orch) throw new Error('OrchestrationKernel not initialized');

  const sessionKey = resolveIMSessionIdFromMessage(message);
  const source: OrchestrationRunSource = {
    kind: 'im_cell',
    cellId: cell.id,
    adapter: cell.adapter,
    sceneId: cell.sceneId,
  };
  const run = await orch.findOrCreateRun({
    sessionKey,
    title: goal.slice(0, 80) || 'roster round',
    source,
  });

  const order = resolveRosterEndpointIds(cell);
  const taskIds: string[] = [];
  for (const endpointId of order) {
    const text = rosterPingText(cell, endpointId, goal);
    const dispatched = await orch.dispatchTask({
      runId: run.id,
      name: `@${endpointId}`,
      description: text,
      role: 'worker',
      goal: text,
      executorKind: 'group_mention',
      assignedTo: endpointId,
      context: { workflow: ROSTER_ROUND_WORKFLOW_STRATEGY_NAME, endpointId },
      message,
      autoStart: false,
    });
    taskIds.push(dispatched.task.id);
    // Execute via the registered group_mention executor; the task ends in
    // waiting_result after the @ is sent. Handback completes it asynchronously
    // when the peer responds.
    await orch.runTask(dispatched.task.id, message);
    // Wait for the peer handback before advancing to the next member.
    await orch.waitForTask(dispatched.task.id, 300_000);
  }

  return { runId: run.id, taskIds };
}
