/**
 * MissionRunner — 始终自动推进 missions run（ADR 0011 D6）。
 */
import { Logger } from '@zhin.js/logger';
import { createSyntheticMessage, type Message, type SendOptions } from '@zhin.js/core';
import type { SubagentManager } from '../subagent.js';
import { originFromMessage } from '../builtin/spawn-task-tool.js';
import {
  getAgentDispatcher,
  type AgentResult,
} from './agent-dispatcher.js';
import { getOrchestrationService } from './orchestration-service.js';
import { appendDecisionLog, isMissionsTemplate } from './mission-state.js';
import {
  applyNegotiationOutcome,
  evaluateMissionNegotiation,
} from './mission-negotiation.js';
import { deliverMissionMilestoneIm, sessionKeyToSubagentOrigin } from './mission-milestone-notify.js';
import { defaultMissionSpecPaths, validateMissionSpecBundle } from './mission-spec.js';

const logger = new Logger(null, 'MissionRunner');

export interface MissionRunnerDeps {
  subagentManager: SubagentManager;
  resolveSessionContext: (sessionKey: string) => Message | null;
  sendImMessage?: (options: SendOptions) => Promise<string>;
}

let runnerInstance: MissionRunner | null = null;

export class MissionRunner {
  private unsub?: () => void;

  constructor(private readonly deps: MissionRunnerDeps) {}

  start(): void {
    if (this.unsub) return;
    this.unsub = getAgentDispatcher().onResult((result) => {
      void this.handleResult(result);
    });
  }

  stop(): void {
    this.unsub?.();
    this.unsub = undefined;
  }

  async advanceRun(runId: string): Promise<void> {
    const orch = getOrchestrationService();
    if (!orch) return;
    const snapshot = await orch.getStatus(runId);
    if (!snapshot || !isMissionsTemplate(snapshot.run)) return;

    const dispatcher = getAgentDispatcher();
    await dispatcher.hydrateRun(runId);

    for (const task of snapshot.tasks) {
      if (task.status !== 'pending') continue;
      const gate = await dispatcher.canExecuteMissions(task.id);
      if (!gate.canExecute) continue;
      await this.spawnOrchestrationTask(runId, task.id, snapshot.run.session_key);
      return;
    }
  }

  private async handleResult(result: AgentResult): Promise<void> {
    const task = getAgentDispatcher().getTask(result.taskId);
    if (!task?.runId) return;

    const orch = getOrchestrationService();
    if (!orch) return;

    const snapshot = await orch.getStatus(task.runId);
    if (!snapshot || !isMissionsTemplate(snapshot.run)) return;

    const completed = snapshot.tasks.find((t) => t.id === result.taskId);
    if (!completed) return;

    const negotiation = await evaluateMissionNegotiation(
      orch,
      task.runId,
      completed,
      result,
      snapshot.tasks,
    );
    await applyNegotiationOutcome(orch, task.runId, negotiation);

    if (completed.phase === 'spec' && result.success) {
      const gateOk = await this.tryAutoSpecGate(task.runId);
      if (!gateOk) {
        await this.notifyMilestone(
          task.runId,
          'mission_spec_gate_failed',
          'Validation Spec dry-run / manifest 未通过，WriteSpec 需重试',
          snapshot.run.session_key,
        );
        return;
      }
    }

    if (negotiation.action === 'skip_negotiate' && result.success) {
      await this.notifyMilestone(
        task.runId,
        'mission_complete',
        'Mission 验证通过，可合并',
        snapshot.run.session_key,
      );
    }
    if (negotiation.action === 'fail_run') {
      await this.notifyMilestone(
        task.runId,
        'mission_failed',
        negotiation.reason,
        snapshot.run.session_key,
      );
    }

    await this.advanceRun(task.runId);
  }

  async notifyRunStarted(runId: string, sessionKey: string): Promise<void> {
    await this.notifyMilestone(
      runId,
      'mission_started',
      'Mission 编排已启动，MissionRunner 自动推进中',
      sessionKey,
    );
  }

  private async tryAutoSpecGate(runId: string): Promise<boolean> {
    const orch = getOrchestrationService();
    if (!orch) return false;

    const state = await orch.getMissionState(runId);
    if (!state || state.spec_dry_run_passed) return true;

    const defaults = defaultMissionSpecPaths(runId);
    const specPaths = state.validation_spec_paths.length
      ? [...state.validation_spec_paths, defaults.manifestPath]
      : [defaults.specTestPath, defaults.manifestPath];

    const result = await validateMissionSpecBundle(runId, specPaths, true);
    if (!result.ok) {
      const current = await orch.getMissionState(runId);
      if (current) {
        await orch.patchMissionState(runId, appendDecisionLog(
          { ...current, spec_dry_run_passed: false },
          {
            actor: 'mission-runner',
            action: 'spec_gate_fail',
            reason: result.reason ?? 'spec dry-run failed',
          },
        ), { skipAcl: true });
      }
      const specTask = (await orch.getStatus(runId))?.tasks.find((t) => t.phase === 'spec');
      if (specTask && specTask.status === 'completed') {
        await orch.retryTask(specTask.id);
      }
      return false;
    }

    await orch.patchMissionState(runId, {
      validation_spec_paths: specPaths.filter((p) => p.endsWith('.test.ts') || p.includes('spec')),
      assertion_count: result.assertionCount,
      spec_dry_run_passed: true,
      phase: 'develop',
    }, { skipAcl: true });
    return true;
  }

  private async spawnOrchestrationTask(
    runId: string,
    taskId: string,
    sessionKey: string,
  ): Promise<void> {
    const dispatcher = getAgentDispatcher();
    const agentTask = dispatcher.getTask(taskId);
    if (!agentTask) return;

    const ctx = this.deps.resolveSessionContext(sessionKey)
      ?? sessionKeyToSubagentOrigin(sessionKey)?.message
      ?? createSyntheticMessage({
        adapter: 'orchestration',
        endpoint: 'mission-runner',
        sender: { id: 'mission-runner' },
        channel: { type: 'private', id: sessionKey },
      });

    const origin = originFromMessage(ctx);
    dispatcher.markRunning(taskId, Promise.resolve({
      taskId,
      role: agentTask.role,
      success: true,
      summary: 'running',
      duration: 0,
    }));

    void this.deps.subagentManager.spawn({
      task: agentTask.goal || agentTask.description || agentTask.name,
      label: agentTask.name,
      origin,
      role: agentTask.role,
      orchestrationTaskId: taskId,
      notifyContext: ctx,
      contextMode: 'fresh',
    }).catch((err) => {
      logger.error('MissionRunner spawn failed:', err);
      dispatcher.recordResult({
        taskId,
        role: agentTask.role,
        success: false,
        summary: 'spawn failed',
        error: err instanceof Error ? err.message : String(err),
        duration: 0,
      });
    });
  }

  private async notifyMilestone(
    runId: string,
    kind: string,
    message: string,
    sessionKey?: string,
  ): Promise<void> {
    logger.info({ runId, kind, message }, 'Mission milestone');

    if (sessionKey && this.deps.sendImMessage) {
      try {
        await deliverMissionMilestoneIm(
          sessionKey,
          kind,
          runId,
          message,
          this.deps.sendImMessage,
        );
      } catch (err) {
        logger.warn({ runId, kind, err }, 'Mission milestone IM notify failed');
      }
    }
  }
}

export function initMissionRunner(deps: MissionRunnerDeps): MissionRunner {
  runnerInstance?.stop();
  runnerInstance = new MissionRunner(deps);
  runnerInstance.start();
  return runnerInstance;
}

export function getMissionRunner(): MissionRunner | null {
  return runnerInstance;
}
