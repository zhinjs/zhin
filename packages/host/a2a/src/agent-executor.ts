/**
 * ZhinA2AExecutor — runs inbound A2A tasks via bound ZhinAgent.
 */
import { randomUUID } from 'node:crypto';
import { TaskState, type Task } from '@a2a-js/sdk';

import {
  AgentEvent,
  type AgentExecutor,
  type ExecutionEventBus,
  type RequestContext,
} from '@a2a-js/sdk/server';
import { createSyntheticMessage } from '@zhin.js/core';
import type { ZhinAgent } from '@zhin.js/agent';
import type { ResolvedAgentBinding } from '@zhin.js/agent/config';
import { agentTextMessage, partsToPromptText, textPart } from './a2a-parts.js';

export interface ZhinA2AExecutorOptions {
  agentName: string;
  getAgent: () => ZhinAgent | null;
  resolveBinding: () => ResolvedAgentBinding | null;
}

function outputElementsToText(elements: Array<{ type: string; content?: string }>): string {
  return elements
    .map((el) => (el.type === 'text' ? el.content || '' : ''))
    .join('\n')
    .trim();
}

function initialTask(requestContext: RequestContext, agentName: string): Task {
  return {
    id: requestContext.taskId,
    contextId: requestContext.contextId,
    status: {
      state: TaskState.TASK_STATE_WORKING,
      message: undefined,
      timestamp: new Date().toISOString(),
    },
    artifacts: [],
    history: [requestContext.userMessage],
    metadata: { zhinAgent: agentName },
  };
}

export class ZhinA2AExecutor implements AgentExecutor {
  private readonly running = new Set<string>();

  constructor(private readonly options: ZhinA2AExecutorOptions) {}

  async execute(requestContext: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    const agent = this.options.getAgent();
    const binding = this.options.resolveBinding();
    if (!agent || !binding) {
      const failed: Task = {
        ...initialTask(requestContext, this.options.agentName),
        status: {
          state: TaskState.TASK_STATE_FAILED,
          message: agentTextMessage(
            randomUUID(),
            requestContext.contextId,
            `Agent "${this.options.agentName}" not ready`,
            requestContext.taskId,
          ),
          timestamp: new Date().toISOString(),
        },
      };
      eventBus.publish(AgentEvent.task(failed));
      eventBus.finished();
      return;
    }

    const task = initialTask(requestContext, this.options.agentName);
    eventBus.publish(AgentEvent.task(task));
    this.running.add(requestContext.taskId);

    const prompt = partsToPromptText(requestContext.userMessage.parts);
    agent.configure({ activeBinding: binding });

    const commMessage = createSyntheticMessage({
      adapter: 'a2a',
      endpoint: this.options.agentName,
      sender: { id: 'a2a-client', isMaster: true },
      channel: { type: 'private', id: requestContext.contextId },
    });

    try {
      const output = await agent.prompt(prompt, commMessage);
      const resultText = outputElementsToText(output as Array<{ type: string; content?: string }>)
        || '（A2A 任务已完成，Agent 未返回文本）';

      eventBus.publish(AgentEvent.artifactUpdate({
        taskId: task.id,
        contextId: task.contextId,
        artifact: {
          artifactId: randomUUID(),
          name: 'result',
          description: '',
          parts: [textPart(resultText)],
          metadata: undefined,
          extensions: [],
        },
        append: false,
        lastChunk: true,
        metadata: undefined,
      }));

      eventBus.publish(AgentEvent.statusUpdate({
        taskId: task.id,
        contextId: task.contextId,
        status: {
          state: TaskState.TASK_STATE_COMPLETED,
          message: agentTextMessage(
            randomUUID(),
            requestContext.contextId,
            resultText,
            task.id,
          ),
          timestamp: new Date().toISOString(),
        },
        metadata: undefined,
      }));
    } catch (err) {
      const errorText = err instanceof Error ? err.message : String(err);
      eventBus.publish(AgentEvent.statusUpdate({
        taskId: task.id,
        contextId: task.contextId,
        status: {
          state: TaskState.TASK_STATE_FAILED,
          message: agentTextMessage(
            randomUUID(),
            requestContext.contextId,
            errorText,
            task.id,
          ),
          timestamp: new Date().toISOString(),
        },
        metadata: undefined,
      }));
    } finally {
      this.running.delete(requestContext.taskId);
      eventBus.finished();
    }
  }

  async cancelTask(taskId: string, eventBus: ExecutionEventBus): Promise<void> {
    this.running.delete(taskId);
    eventBus.publish(AgentEvent.statusUpdate({
      taskId,
      contextId: '',
      status: {
        state: TaskState.TASK_STATE_CANCELED,
        message: undefined,
        timestamp: new Date().toISOString(),
      },
      metadata: undefined,
    }));
    eventBus.finished();
  }
}
