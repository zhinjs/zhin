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
import type { AgentHostProtocolPort } from '@zhin.js/agent/runtime';
import type { TurnOutcome, TurnRequest } from '@zhin.js/agent/turn';
import { agentTextMessage, partsToPromptText, textPart } from './a2a-parts.js';

export interface ZhinA2AExecutorOptions {
  agentName: string;
  protocol: AgentHostProtocolPort;
}

type TurnOutputElement = Extract<TurnOutcome, { status: 'completed' }>['output'][number];

function outputElementsToText(elements: readonly TurnOutputElement[]): string {
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
  private readonly running = new Map<string, AbortController>();

  constructor(private readonly options: ZhinA2AExecutorOptions) {}

  async execute(requestContext: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    const binding = this.options.protocol.listBindings()
      .find((entry) => entry.name === this.options.agentName);
    if (!binding) {
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
    const abort = new AbortController();
    this.running.set(requestContext.taskId, abort);

    const prompt = partsToPromptText(requestContext.userMessage.parts);

    try {
      const outcome = await this.options.protocol.execute(
        this.options.agentName,
        createA2aTurnRequest(requestContext, prompt, abort.signal),
      );
      const output = completedOutput(outcome);
      const resultText = outputElementsToText(output)
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
      // cancelTask owns the A2A cancelled terminal. The canonical turn still
      // settles under the same AbortSignal, but must not publish a second
      // failed terminal after cancellation.
      if (abort.signal.aborted) return;
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
    this.running.get(taskId)?.abort(new Error(`A2A task cancelled: ${taskId}`));
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

function createA2aTurnRequest(
  context: RequestContext,
  text: string,
  signal: AbortSignal,
): TurnRequest {
  return Object.freeze({
    identity: Object.freeze({ traceId: context.taskId, turnId: randomUUID() }),
    origin: Object.freeze({ kind: 'a2a' as const, taskId: context.taskId }),
    principal: Object.freeze({ subjectId: 'a2a-client', roles: Object.freeze(['user']) }),
    input: Object.freeze({ text }),
    session: Object.freeze({ key: `a2a:${context.contextId}` }),
    policy: Object.freeze({ permissions: Object.freeze(['user']), unattended: true }),
    signal,
    ports: Object.freeze({}),
  });
}

function completedOutput(outcome: TurnOutcome): readonly TurnOutputElement[] {
  if (outcome.status === 'completed') return outcome.output;
  if (outcome.status === 'failed') throw new Error(outcome.error.message);
  if (outcome.status === 'cancelled') throw new Error(outcome.reason);
  throw new Error(`Agent budget exceeded: ${outcome.budget}`);
}
