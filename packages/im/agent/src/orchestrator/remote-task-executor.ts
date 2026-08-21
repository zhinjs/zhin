/**
 * Remote task execution via A2A SendMessage / SSE (Agent Mesh v2).
 */
import type { Task } from '@a2a-js/sdk';
import { getLogger } from '@zhin.js/logger';
import type { GenerationAdmissionGate } from '@zhin.js/plugin-runtime';
import type { RemoteAgentRegistry } from './remote-agent-registry.js';
import type { OrchestrationKernel } from './orchestration-service.js';
import { buildSendMessageRequest } from '../a2a/delegation-message.js';
import {
  extractTaskResultText,
  isTerminalA2aState,
  mapA2aTaskState,
} from '../a2a/task-state.js';

const REMOTE_TASK_POLL_INTERVAL_MS = 15_000;
const logger = getLogger('RemoteTaskExecutor');
type RemoteTaskExecutionResult = { ok: boolean; message: string; cancelled?: true };

function isA2aTask(value: unknown): value is Task {
  return !!value && typeof value === 'object' && 'id' in value && 'status' in value;
}

function readA2aTask(value: unknown): Task | undefined {
  if (isA2aTask(value)) return value;
  if (value && typeof value === 'object' && 'result' in value) {
    const result = (value as { result?: unknown }).result;
    if (isA2aTask(result)) return result;
  }
  return undefined;
}

function isA2aMessage(value: unknown): value is {
  messageId: string;
  taskId?: string;
  parts: Array<{ content?: { $case?: string; value?: string } }>;
} {
  return !!value && typeof value === 'object'
    && 'messageId' in value
    && 'parts' in value
    && Array.isArray((value as { parts?: unknown }).parts);
}

function readA2aMessage(value: unknown): ReturnType<typeof asA2aMessage> {
  const direct = asA2aMessage(value);
  if (direct) return direct;
  if (value && typeof value === 'object' && 'result' in value) {
    return asA2aMessage((value as { result?: unknown }).result);
  }
  return undefined;
}

function asA2aMessage(value: unknown): {
  messageId: string;
  taskId?: string;
  parts: Array<{ content?: { $case?: string; value?: string } }>;
} | undefined {
  return isA2aMessage(value) ? value : undefined;
}

function extractA2aMessageText(message: { parts: Array<{ content?: { $case?: string; value?: string } }> }): string {
  return message.parts
    .map((part) => part.content?.$case === 'text' ? part.content.value ?? '' : '')
    .join('\n')
    .trim();
}

function extractRemoteTaskId(result: unknown): string | undefined {
  if (isA2aTask(result)) return result.id;
  if (result && typeof result === 'object' && 'taskId' in result) {
    const tid = (result as { taskId?: string }).taskId;
    if (tid) return tid;
  }
  return undefined;
}

async function applyStreamToKernel(
  taskId: string,
  stream: AsyncGenerator<unknown, void, undefined>,
  orch: OrchestrationKernel,
  signal: AbortSignal,
): Promise<{ remoteTaskId?: string; terminal: boolean; resultText?: string }> {
  let remoteTaskId: string | undefined;
  let terminal = false;
  let resultText: string | undefined;

  for await (const event of stream) {
    signal.throwIfAborted();
    if (!event || typeof event !== 'object') continue;
    const message = readA2aMessage(event);
    if (message) {
      if (!message.taskId) {
        resultText = extractA2aMessageText(message);
        await orch.completeTask(taskId, (resultText || 'remote agent returned a message').slice(0, 4000));
        return { remoteTaskId, terminal: true, resultText };
      }
      if (message.taskId !== remoteTaskId) {
        await orch.markTaskWaitingResult(taskId, {
          remoteTaskId: message.taskId,
          progress: `a2a stream attached: ${message.taskId}`,
        });
        remoteTaskId = message.taskId;
      }
      continue;
    }
    const payload = readA2aTask(event);
    if (payload) {
      if (payload.id !== remoteTaskId) {
        await orch.markTaskWaitingResult(taskId, {
          remoteTaskId: payload.id,
          progress: `a2a stream attached: ${payload.id}`,
        });
      }
      remoteTaskId = payload.id;
      const state = payload.status?.state;
      await orch.taskProgress(taskId, `a2a stream: ${state ?? 'update'}`);
      if (isTerminalA2aState(state)) {
        terminal = true;
        resultText = extractTaskResultText(payload);
        const status = mapA2aTaskState(state);
        if (status === 'completed') {
          await orch.completeTask(taskId, (resultText || 'remote task completed').slice(0, 4000));
        } else if (status === 'cancelled') {
          await orch.cancelTask(taskId, resultText || 'remote task cancelled');
        } else if (status === 'failed') {
          await orch.failTask(taskId, resultText || 'remote task failed');
        }
      }
    }
  }

  return { remoteTaskId, terminal, resultText };
}

function waitForPoll(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, REMOTE_TASK_POLL_INTERVAL_MS);
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener('abort', abort, { once: true });
  });
}

async function pollUntilTerminal(
  orch: OrchestrationKernel,
  registry: RemoteAgentRegistry,
  taskId: string,
  signal: AbortSignal,
): Promise<void> {
  while (true) {
    signal.throwIfAborted();
    const result = await pollRemoteTaskStatus(orch, registry, taskId, signal);
    if (result.done) return;
    await waitForPoll(signal);
  }
}

async function failTrackedTask(
  orch: OrchestrationKernel,
  taskId: string,
  prefix: string,
  error: unknown,
): Promise<void> {
  await orch.safeFailTask(taskId, `${prefix}: ${error instanceof Error ? error.message : String(error)}`);
}

export function executeRemoteOrchestrationTask(
  orch: OrchestrationKernel,
  registry: RemoteAgentRegistry,
  taskId: string,
): Promise<RemoteTaskExecutionResult> {
  return registry.run((signal) => executeTrackedRemoteTask(orch, registry, taskId, signal));
}

async function executeTrackedRemoteTask(
  orch: OrchestrationKernel,
  registry: RemoteAgentRegistry,
  taskId: string,
  signal: AbortSignal,
): Promise<RemoteTaskExecutionResult> {
  const dispatcher = orch.dispatcherHandle;
  const task = dispatcher.getTask(taskId);
  if (!task) {
    return { ok: false, message: `任务 ${taskId} 不存在` };
  }
  if (task.executorKind !== 'remote_mesh' || !task.remoteAgentId) {
    return { ok: false, message: `任务 ${taskId} 不是远程执行任务` };
  }

  const agent = registry.get(task.remoteAgentId);
  if (!agent) {
    return { ok: false, message: `远程 Agent ${task.remoteAgentId} 未注册` };
  }

  const payload = {
    title: task.name,
    description: task.goal || task.description,
    acceptance_criteria: String(task.context?.acceptance_criteria ?? ''),
    artifacts: (task.context?.artifacts as Array<{ name?: string; content?: string; mime?: string }>) ?? [],
    role: task.role,
  };
  const sendParams = buildSendMessageRequest(payload);
  let remoteTaskIdentityEstablished = false;

  try {
    const client = await registry.getA2aClient(task.remoteAgentId);

    if (registry.supportsStreaming(task.remoteAgentId)) {
      const stream = client.sendMessageStream(sendParams);
      const first = await stream.next();
      let remoteTaskId = taskId;
      const firstTask = first.done ? undefined : readA2aTask(first.value);
      if (firstTask) {
        remoteTaskId = firstTask.id;
        if (orch) {
          await orch.markTaskWaitingResult(taskId, {
            remoteTaskId,
            progress: `a2a delegation started (stream): ${task.remoteAgentId}:${remoteTaskId}`,
          });
          remoteTaskIdentityEstablished = true;
        }
      }

      registry.trackTask(taskId, async (signal) => {
        try {
          const streamed = await applyStreamToKernel(taskId, (async function* () {
            if (!first.done) yield first.value;
            yield* stream;
          })(), orch, signal);
          if (!streamed.terminal) {
            if (!streamed.remoteTaskId) {
              throw new Error('A2A stream ended before publishing a remote task id');
            }
            await pollUntilTerminal(orch, registry, taskId, signal);
          }
        } catch (error) {
          if (signal.aborted) return;
          await failTrackedTask(orch, taskId, 'a2a stream failed', error);
        }
      });

      return {
        ok: true,
        message: `远程任务已通过 A2A SSE 委托给 ${task.remoteAgentId}（task ${taskId}）`,
      };
    }

    const result = await client.sendMessage(sendParams);
    const directMessage = readA2aMessage(result);
    if (directMessage && !directMessage.taskId) {
      const resultText = extractA2aMessageText(directMessage);
      await orch.completeTask(taskId, (resultText || 'remote agent returned a message').slice(0, 4000));
      return { ok: true, message: `远程任务已完成: ${task.remoteAgentId}` };
    }
    const remoteTaskId = extractRemoteTaskId(result);
    if (!remoteTaskId) {
      throw new Error('A2A response did not contain a remote task id or a terminal message');
    }

    if (isA2aTask(result) && isTerminalA2aState(result.status?.state)) {
      const resultText = extractTaskResultText(result);
      const status = mapA2aTaskState(result.status?.state);
      if (orch) {
        if (status === 'completed') {
          await orch.completeTask(taskId, (resultText || 'remote task completed').slice(0, 4000));
        } else if (status === 'cancelled') {
          await orch.cancelTask(taskId, resultText || 'cancelled');
        } else {
          await orch.failTask(taskId, resultText || 'failed');
        }
      }
      return { ok: true, message: `远程任务已完成: ${task.remoteAgentId}` };
    }

    if (orch) {
      await orch.markTaskWaitingResult(taskId, {
        remoteTaskId,
        progress: `a2a delegation started: ${task.remoteAgentId}:${remoteTaskId}`,
      });
      remoteTaskIdentityEstablished = true;
    }
    registry.trackTask(taskId, async (signal) => {
      try {
        await pollUntilTerminal(orch, registry, taskId, signal);
      } catch (error) {
        if (signal.aborted) return;
        await failTrackedTask(orch, taskId, 'a2a polling failed', error);
      }
    });
    return {
      ok: true,
      message: `远程任务已委托给 ${task.remoteAgentId}（task ${taskId}），将通过轮询同步状态。`,
    };
  } catch (err) {
    if (signal.aborted) {
      if (!remoteTaskIdentityEstablished) {
        try {
          await orch.cancelTask(taskId, 'remote delegation cancelled before task identity was established');
        } catch (error) {
          logger.error('Failed to persist remote delegation cancellation:', error);
        }
      }
      return { ok: false, cancelled: true, message: '远程委托已随 generation 取消' };
    }
    const error = err instanceof Error ? err.message : String(err);
    if (orch) {
      await orch.safeFailTask(taskId, `a2a delegate failed: ${error}`);
    } else {
      dispatcher.recordResult({
        taskId,
        role: task.role,
        success: false,
        summary: 'a2a delegate failed',
        error,
        duration: 0,
      });
    }
    return { ok: false, message: `远程委托失败: ${error}` };
  }
}

export function startRemoteTaskRecovery(
  orch: OrchestrationKernel,
  registry: RemoteAgentRegistry,
  admission: GenerationAdmissionGate,
): () => void {
  let stopped = false;
  let ticking = false;

  const tick = async (): Promise<void> => {
    if (stopped || ticking) return;
    ticking = true;
    try {
      await admission.enter(async () => {
        const records = await orch.repositoryHandle.listActiveRemoteTasks();
        for (const record of records) {
          if (!record.remote_task_id) continue;
          orch.dispatcherHandle.syncTaskFromRecord(record);
          try {
            registry.trackTask(record.id, async (signal) => {
              try {
                await pollUntilTerminal(orch, registry, record.id, signal);
              } catch (error) {
                if (!signal.aborted) {
                  await failTrackedTask(orch, record.id, 'a2a recovery polling failed', error);
                }
              }
            });
          } catch (error) {
            if (!stopped) throw error;
          }
        }
      });
    } finally {
      ticking = false;
    }
  };

  const timer = setInterval(() => {
    void tick().catch((error) => {
      logger.error('Remote task recovery tick failed:', error);
    });
  }, REMOTE_TASK_POLL_INTERVAL_MS);
  timer.unref?.();
  void tick().catch((error) => {
    logger.error('Remote task recovery bootstrap failed:', error);
  });

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

export async function pollRemoteTaskStatus(
  orch: OrchestrationKernel,
  remoteRegistry: RemoteAgentRegistry,
  taskId: string,
  signal: AbortSignal = new AbortController().signal,
): Promise<{ done: boolean; status: string; result?: string }> {
  signal.throwIfAborted();
  const dispatcher = orch.dispatcherHandle;
  const task = dispatcher.getTask(taskId);
  if (!task?.remoteAgentId || !task.remoteTaskId) {
    return { done: false, status: 'unknown' };
  }

  try {
    const client = await remoteRegistry.getA2aClient(task.remoteAgentId);
    const remoteTask = await client.getTask({ id: task.remoteTaskId, tenant: '' }) as Task;
    const status = mapA2aTaskState(remoteTask.status?.state);
    const resultText = extractTaskResultText(remoteTask);

    if (status === 'completed') {
      if (orch) {
        await orch.completeTask(taskId, (resultText || 'remote completed').slice(0, 4000));
      } else {
        dispatcher.recordResult({
          taskId,
          role: task.role,
          success: true,
          summary: resultText.slice(0, 4000),
          duration: 0,
        });
      }
      return { done: true, status, result: resultText };
    }

    if (status === 'cancelled') {
      if (orch) {
        await orch.cancelTask(taskId, resultText || 'remote task cancelled');
      } else {
        dispatcher.recordResult({
          taskId,
          role: task.role,
          success: false,
          summary: resultText,
          error: resultText,
          duration: 0,
        });
      }
      return { done: true, status, result: resultText };
    }

    if (status === 'failed') {
      if (orch) {
        await orch.failTask(taskId, resultText || 'remote task failed');
      } else {
        dispatcher.recordResult({
          taskId,
          role: task.role,
          success: false,
          summary: resultText,
          error: resultText,
          duration: 0,
        });
      }
      return { done: true, status, result: resultText };
    }

    if (orch) {
      await orch.taskProgress(taskId, `a2a status: ${status}`);
    }
    return { done: false, status };
  } catch (err) {
    if (signal.aborted) throw signal.reason;
    const error = err instanceof Error ? err.message : String(err);
    if (orch) {
      await orch.taskProgress(taskId, `a2a poll error: ${error}`);
    }
    return { done: false, status: 'error' };
  }
}
