/**
 * Remote task execution via A2A SendMessage / SSE (Agent Mesh v2).
 */
import type { Task } from '@a2a-js/sdk';
import { getAgentDispatcher } from './agent-dispatcher.js';
import { getRemoteAgentRegistry } from './remote-agent-registry.js';
import { getOrchestrationService } from './orchestration-service.js';
import { buildSendMessageRequest } from '../a2a/delegation-message.js';
import {
  extractTaskResultText,
  isTerminalA2aState,
  mapA2aTaskState,
} from '../a2a/task-state.js';

function isA2aTask(value: unknown): value is Task {
  return !!value && typeof value === 'object' && 'id' in value && 'status' in value;
}

function extractRemoteTaskId(result: unknown): string | undefined {
  if (isA2aTask(result)) return result.id;
  if (result && typeof result === 'object' && 'taskId' in result) {
    const tid = (result as { taskId?: string }).taskId;
    if (tid) return tid;
  }
  if (result && typeof result === 'object' && 'id' in result) {
    return String((result as { id: string }).id);
  }
  return undefined;
}

async function applyStreamToKernel(
  taskId: string,
  stream: AsyncGenerator<unknown, void, undefined>,
  orch: NonNullable<ReturnType<typeof getOrchestrationService>>,
): Promise<{ remoteTaskId: string; terminal: boolean; resultText?: string }> {
  let remoteTaskId = taskId;
  let terminal = false;
  let resultText: string | undefined;

  for await (const event of stream) {
    if (!event || typeof event !== 'object') continue;
    const payload = 'result' in event ? (event as { result?: unknown }).result : event;
    if (isA2aTask(payload)) {
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

export async function executeRemoteOrchestrationTask(
  taskId: string,
): Promise<{ ok: boolean; message: string }> {
  const dispatcher = getAgentDispatcher();
  const orch = getOrchestrationService();
  const task = dispatcher.getTask(taskId);
  if (!task) {
    return { ok: false, message: `任务 ${taskId} 不存在` };
  }
  if (task.executorKind !== 'remote_mesh' || !task.remoteAgentId) {
    return { ok: false, message: `任务 ${taskId} 不是远程执行任务` };
  }

  const registry = getRemoteAgentRegistry();
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

  try {
    const client = await registry.getA2aClient(task.remoteAgentId);

    if (registry.supportsStreaming(task.remoteAgentId)) {
      const stream = client.sendMessageStream(sendParams);
      const first = await stream.next();
      let remoteTaskId = taskId;
      if (!first.done && isA2aTask(first.value)) {
        remoteTaskId = first.value.id;
        if (orch) {
          await orch.markTaskWaitingResult(taskId, {
            remoteTaskId,
            progress: `a2a delegation started (stream): ${task.remoteAgentId}:${remoteTaskId}`,
          });
        }
      }

      void applyStreamToKernel(taskId, (async function* () {
        if (!first.done) yield first.value;
        yield* stream;
      })(), orch!).catch(async (err) => {
        const error = err instanceof Error ? err.message : String(err);
        if (orch) await orch.safeFailTask(taskId, `a2a stream failed: ${error}`);
      });

      return {
        ok: true,
        message: `远程任务已通过 A2A SSE 委托给 ${task.remoteAgentId}（task ${taskId}）`,
      };
    }

    const result = await client.sendMessage(sendParams);
    const remoteTaskId = extractRemoteTaskId(result) ?? taskId;

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
    }
    return {
      ok: true,
      message: `远程任务已委托给 ${task.remoteAgentId}（task ${taskId}），将通过轮询同步状态。`,
    };
  } catch (err) {
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

export async function pollRemoteTaskStatus(
  taskId: string,
): Promise<{ done: boolean; status: string; result?: string }> {
  const dispatcher = getAgentDispatcher();
  const orch = getOrchestrationService();
  const task = dispatcher.getTask(taskId);
  if (!task?.remoteAgentId || !task.remoteTaskId) {
    return { done: false, status: 'unknown' };
  }

  try {
    const client = await getRemoteAgentRegistry().getA2aClient(task.remoteAgentId);
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
    const error = err instanceof Error ? err.message : String(err);
    if (orch) {
      await orch.taskProgress(taskId, `a2a poll error: ${error}`);
    }
    return { done: false, status: 'error' };
  }
}
