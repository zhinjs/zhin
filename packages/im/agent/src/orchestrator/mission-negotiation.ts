/**
 * Mission Negotiation — phase gate decisions (ADR 0011 D5).
 */
import type { AgentResult } from './agent-dispatcher.js';
import type { OrchestrationTaskRecord } from '@zhin.js/ai';
import {
  appendDecisionLog,
  type MissionState,
} from './mission-state.js';
import type { OrchestrationService } from './orchestration-service.js';

export interface NegotiationOutcome {
  action: 'continue' | 'retry_dev' | 'replan_spec' | 'skip_negotiate' | 'fail_run';
  reason: string;
  statePatch?: Partial<MissionState>;
  skipTaskIds?: string[];
  retryTaskIds?: string[];
}

export async function evaluateMissionNegotiation(
  service: OrchestrationService,
  runId: string,
  completedTask: OrchestrationTaskRecord,
  result: AgentResult,
  tasks: OrchestrationTaskRecord[],
): Promise<NegotiationOutcome> {
  const state = await service.getMissionState(runId);
  if (!state) {
    return { action: 'continue', reason: 'no mission state' };
  }

  if (completedTask.phase === 'validate') {
    if (result.success) {
      const negotiate = tasks.find((t) => t.phase === 'negotiate');
      return {
        action: 'skip_negotiate',
        reason: 'validation passed',
        skipTaskIds: negotiate ? [negotiate.id] : [],
        statePatch: { phase: 'done' },
      };
    }

    const remaining = state.retry_budget.validate;
    if (remaining > 0) {
      const dev = tasks.find((t) => t.phase === 'develop');
      return {
        action: 'retry_dev',
        reason: `validation failed, ${remaining - 1} retries left`,
        retryTaskIds: dev ? [dev.id] : [],
        statePatch: appendDecisionLog(
          {
            ...state,
            retry_budget: { ...state.retry_budget, validate: remaining - 1 },
            phase: 'develop',
          },
          { actor: 'negotiation', action: 'retry_dev', reason: result.summary.slice(0, 200) },
        ),
      };
    }

    return {
      action: 'replan_spec',
      reason: 'validation retry budget exhausted',
      retryTaskIds: tasks.filter((t) => t.phase === 'spec' || t.phase === 'develop').map((t) => t.id),
      statePatch: appendDecisionLog(state, {
        actor: 'negotiation',
        action: 'replan_spec',
        reason: 'validate retries exhausted',
      }),
    };
  }

  if (completedTask.phase === 'negotiate') {
    if (result.success) {
      return { action: 'continue', reason: 'negotiation completed' };
    }
    return {
      action: 'fail_run',
      reason: result.error ?? result.summary,
      statePatch: appendDecisionLog(state, {
        actor: 'negotiation',
        action: 'fail_run',
        reason: result.error ?? result.summary,
      }),
    };
  }

  if (completedTask.phase === 'spec' && result.success) {
    return {
      action: 'continue',
      reason: 'spec phase done',
      statePatch: { phase: 'develop' },
    };
  }

  if (completedTask.phase === 'plan' && result.success) {
    return {
      action: 'continue',
      reason: 'plan phase done',
      statePatch: { phase: 'spec' },
    };
  }

  return { action: 'continue', reason: 'default' };
}

export async function applyNegotiationOutcome(
  service: OrchestrationService,
  runId: string,
  outcome: NegotiationOutcome,
): Promise<void> {
  if (outcome.statePatch) {
    await service.patchMissionState(runId, outcome.statePatch, { skipAcl: true });
  }
  for (const taskId of outcome.skipTaskIds ?? []) {
    await service.skipTask(taskId, outcome.reason);
  }
  for (const taskId of outcome.retryTaskIds ?? []) {
    const task = await service.repositoryHandle.getTask(taskId);
    if (task && (task.status === 'completed' || task.status === 'failed')) {
      await service.retryTask(taskId);
    }
  }
  if (outcome.action === 'fail_run') {
    await service.completeRun(runId, true);
  }
}
