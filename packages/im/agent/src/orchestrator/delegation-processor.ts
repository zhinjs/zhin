/**
 * DelegationProcessor — 处理入站 MCP agent.delegate_task 创建的待执行委托。
 */
import { randomUUID } from 'node:crypto';
import { Logger } from '@zhin.js/logger';
import type { OutputElement } from '@zhin.js/ai';
import type { ZhinAgent } from '../zhin-agent/index.js';
import { createSyntheticMessage } from '@zhin.js/core';
import { getOrchestrationService } from './orchestration-service.js';
import type { AgentExecutor } from './orchestration-types.js';

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

function outputElementsToText(elements: OutputElement[]): string {
  return elements
    .map((el) => (el.type === 'text' ? el.content || '' : ''))
    .join('\n')
    .trim();
}

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
      role: 'planner',
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
      if (run.status !== 'open' && run.status !== 'running' && run.status !== 'waiting') continue;
      const tasks = await orch.repositoryHandle.listTasksByRun(run.id);
      for (const task of tasks) {
        if (task.status !== 'pending' || this.processing.has(task.id)) continue;
        void this.processTask(task.id, task.goal || task.description, run.session_key);
      }
    }
  }

  private delegationExecutor(prompt: string): AgentExecutor {
    const zhinAgent = this.options.zhinAgent;
    return {
      kind: 'local',
      async *execute({ message }) {
        if (!message) {
          yield { type: 'error', error: 'mesh delegation requires synthetic inbound message' };
          return;
        }
        yield { type: 'progress', text: 'running mesh delegation via main agent' };
        const output = await zhinAgent.prompt(prompt, message);
        const resultText = outputElementsToText(output);
        yield {
          type: 'result',
          result: resultText || '（委托已完成，主 Agent 未返回文本）',
        };
      },
    };
  }

  private async processTask(taskId: string, prompt: string, sessionKey: string): Promise<void> {
    if (this.processing.has(taskId)) return;
    this.processing.add(taskId);
    const orch = getOrchestrationService();

    try {
      if (!orch) throw new Error('OrchestrationService not ready');

      const commMessage = createSyntheticMessage({
        adapter: 'mesh',
        endpoint: 'delegation',
        sender: { id: 'remote-delegate', isMaster: true },
        channel: { type: 'private', id: sessionKey },
      });

      const completed = await orch.runTask(taskId, commMessage, this.delegationExecutor(prompt));
      if (completed.status === 'failed') {
        logger.error(`Delegation task ${taskId} failed: ${completed.error ?? 'unknown'}`);
      }
    } catch (err) {
      logger.error(`Delegation task ${taskId} failed:`, err);
      await orch?.safeFailTask(taskId, err instanceof Error ? err.message : String(err));
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

export function stopDelegationProcessor(): void {
  if (globalProcessor) {
    globalProcessor.stop();
    globalProcessor = null;
  }
}
