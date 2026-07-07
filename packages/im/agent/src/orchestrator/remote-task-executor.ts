/**
 * Remote task execution via MCP agent.delegate_task (Agent Mesh v1).
 */
import { getAgentDispatcher } from './agent-dispatcher.js';
import { getRemoteAgentRegistry } from './remote-agent-registry.js';
import { getOrchestrationService } from './orchestration-service.js';

function extractMcpText(result: unknown): string {
  if (typeof result === 'string') return result;
  const content = (result as { content?: Array<{ type?: string; text?: string }> })?.content;
  if (Array.isArray(content)) {
    return content
      .filter((c) => c.type === 'text' && c.text)
      .map((c) => c.text!)
      .join('\n');
  }
  return JSON.stringify(result);
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

  try {
    const conn = await registry.getConnection(task.remoteAgentId);
    const result = await conn.callTool('agent.delegate_task', {
      title: task.name,
      description: task.goal || task.description,
      acceptance_criteria: task.context?.acceptance_criteria ?? '',
      artifacts: task.context?.artifacts ?? [],
    });
    const text = extractMcpText(result);
    let remoteTaskId = taskId;
    try {
      const parsed = JSON.parse(text) as { remote_task_id?: string; task_id?: string };
      remoteTaskId = parsed.remote_task_id ?? parsed.task_id ?? taskId;
    } catch {
      const match = text.match(/remote_task_id["\s:]+([a-zA-Z0-9-]+)/);
      if (match) remoteTaskId = match[1]!;
    }
    if (orch) {
      await orch.markTaskWaitingResult(taskId, {
        remoteTaskId,
        progress: `remote delegation started: ${task.remoteAgentId}:${remoteTaskId}`,
      });
    }
    return {
      ok: true,
      message: `远程任务已委托给 ${task.remoteAgentId}（task ${taskId}），将通过轮询同步状态。`,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    if (orch) {
      await orch.safeFailTask(taskId, `remote delegate failed: ${error}`);
    } else {
      dispatcher.recordResult({
        taskId,
        role: task.role,
        success: false,
        summary: 'remote delegate failed',
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

  const conn = await getRemoteAgentRegistry().getConnection(task.remoteAgentId);
  const statusResult = await conn.callTool('agent.query_status', { task_id: task.remoteTaskId });
  const statusText = extractMcpText(statusResult);
  let status = 'running';
  try {
    const parsed = JSON.parse(statusText) as { status?: string };
    status = parsed.status ?? status;
  } catch {
    if (/completed|done|success/i.test(statusText)) status = 'completed';
    if (/failed|error/i.test(statusText)) status = 'failed';
    if (/cancelled|canceled/i.test(statusText)) status = 'cancelled';
    if (/pending/i.test(statusText)) status = 'pending';
  }

  if (status === 'completed') {
    const resultRaw = await conn.callTool('agent.get_result', { task_id: task.remoteTaskId });
    const resultText = extractMcpText(resultRaw);
    if (orch) {
      await orch.completeTask(taskId, resultText.slice(0, 4000));
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
      await orch.cancelTask(taskId, statusText || 'remote task cancelled');
    } else {
      dispatcher.recordResult({
        taskId,
        role: task.role,
        success: false,
        summary: statusText,
        error: statusText,
        duration: 0,
      });
    }
    return { done: true, status, result: statusText };
  }

  if (status === 'failed') {
    if (orch) {
      await orch.failTask(taskId, statusText);
    } else {
      dispatcher.recordResult({
        taskId,
        role: task.role,
        success: false,
        summary: statusText,
        error: statusText,
        duration: 0,
      });
    }
    return { done: true, status, result: statusText };
  }

  if (orch) {
    await orch.taskProgress(taskId, `remote status: ${status}`);
  }
  return { done: false, status };
}
