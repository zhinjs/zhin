/**
 * DelegationProcessor — 处理入站 MCP agent.delegate_task 创建的待执行委托。
 */
import { randomUUID } from 'node:crypto';
import { Logger } from '@zhin.js/logger';
import type { ZhinAgent } from '../zhin-agent/index.js';
import type { ToolContext } from '@zhin.js/core';
import { getOrchestrationService } from './orchestration-service.js';
import { getAgentDispatcher } from './agent-dispatcher.js';

const logger = new Logger(null, 'DelegationProcessor');

export interface DelegationPayload {
  title: string;
  description: string;
  acceptance_criteria?: string;
  artifacts?: Array<{ name?: string; content?: string; mime?: string }>;
}

export interface DelegationProcessorOptions {
  zhinAgent: ZhinAgent;
  pollIntervalMs?: number;
}

const DELEGATION_SESSION_PREFIX = 'mesh:delegation:';

export class DelegationProcessor {
  private timer: ReturnType<typeof setInterval> | null = null;
  private processing = new Set<string>();

  constructor(private readonly options: DelegationProcessorOptions) {}

  start(): void {
    if (this.timer) return;
    const ms = this.options.pollIntervalMs ?? 5_000;
    this.timer = setInterval(() => void this.tick(), ms);
    if (this.timer && typeof this.timer === 'object' && 'unref' in this.timer) {
      this.timer.unref();
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async createDelegation(payload: DelegationPayload): Promise<{ remote_task_id: string; run_id: string }> {
    const orch = getOrchestrationService();
    if (!orch) throw new Error('OrchestrationService not ready');

    const taskId = randomUUID().slice(0, 8);
    const sessionKey = `${DELEGATION_SESSION_PREFIX}${taskId}`;
    const snapshot = await orch.startRun({
      sessionKey,
      title: payload.title,
    });
    const task = await orch.addTask({
      runId: snapshot.run.id,
      name: payload.title,
      description: payload.description,
      goal: payload.description,
      role: 'main',
      context: {
        acceptance_criteria: payload.acceptance_criteria ?? '',
        artifacts: payload.artifacts ?? [],
        delegation: true,
      },
    });

    void this.processTask(
      task.id,
      this.buildDelegationPrompt(payload),
      sessionKey,
    );
    return { remote_task_id: task.id, run_id: snapshot.run.id };
  }

  private buildDelegationPrompt(payload: DelegationPayload): string {
    const lines = [
      `# Delegated Task: ${payload.title}`,
      payload.description,
    ];
    if (payload.acceptance_criteria) {
      lines.push('', '## Acceptance Criteria', payload.acceptance_criteria);
    }
    if (payload.artifacts?.length) {
      lines.push('', '## Artifacts');
      for (const a of payload.artifacts) {
        lines.push(`### ${a.name ?? 'artifact'}`, a.content ?? '');
      }
    }
    return lines.join('\n');
  }

  async tick(): Promise<void> {
    const orch = getOrchestrationService();
    if (!orch) return;

    const runs = await orch.repositoryHandle.listRunsBySessionKeyPrefix(DELEGATION_SESSION_PREFIX);
    for (const run of runs) {
      if (run.status !== 'active') continue;
      const tasks = await orch.repositoryHandle.listTasksByRun(run.id);
      for (const task of tasks) {
        if (task.status !== 'pending' || this.processing.has(task.id)) continue;
        void this.processTask(task.id, task.goal || task.description, run.session_key);
      }
    }
  }

  private async processTask(taskId: string, prompt: string, sessionKey: string): Promise<void> {
    if (this.processing.has(taskId)) return;
    this.processing.add(taskId);
    const orch = getOrchestrationService();
    const dispatcher = getAgentDispatcher();

    try {
      await orch?.repositoryHandle.updateTaskStatus(taskId, 'running', { started_at: Date.now() });
      dispatcher.syncTaskFromRecord((await orch!.repositoryHandle.getTask(taskId))!);

      const context: ToolContext = {
        platform: 'mesh',
        botId: 'delegation',
        sceneId: sessionKey,
        senderId: 'remote-delegate',
        scope: 'private',
      };

      await this.options.zhinAgent.prompt(prompt, context);
      const resultText = 'Delegation completed via main agent turn';

      dispatcher.recordResult({
        taskId,
        role: 'main',
        success: true,
        summary: resultText,
        duration: 0,
      });
    } catch (err) {
      dispatcher.recordResult({
        taskId,
        role: 'main',
        success: false,
        summary: 'delegation failed',
        error: err instanceof Error ? err.message : String(err),
        duration: 0,
      });
      logger.error(`Delegation task ${taskId} failed:`, err);
    } finally {
      this.processing.delete(taskId);
    }
  }
}

let globalProcessor: DelegationProcessor | null = null;

export function initDelegationProcessor(options: DelegationProcessorOptions): DelegationProcessor {
  globalProcessor = new DelegationProcessor(options);
  globalProcessor.start();
  return globalProcessor;
}

export function getDelegationProcessor(): DelegationProcessor | null {
  return globalProcessor;
}
