/**
 * spawn_task 入站委派（OrchestrationKernel / SubagentSystem；阶段 4）。
 */
import type { Message, AgentTurnMessage } from '@zhin.js/core';
import { resolveIMSessionIdFromMessage } from '@zhin.js/core';
import { formatCompactLog } from '@zhin.js/logger';
import { parseOutput } from '@zhin.js/ai';
import { DEFAULT_ZHIN_AGENT_NAME } from '../config/types.js';
import type { ResolvedAgentBinding } from '../config/types.js';
import { getOrchestrationService } from '../orchestrator/orchestration-service.js';
import { publishOutboundElements } from '../media/index.js';
import { orchestrationSourceFromMessage } from './collaboration-kernel-bridge.js';
import type { CollaborationScene, TurnPlanDelegation } from './types.js';
import type { ZhinAgent } from '../zhin-agent/index.js';

export interface ExecuteInboundSpawnTaskInput {
  zhinAgent: ZhinAgent;
  commMessage: AgentTurnMessage;
  message: Message;
  aiContent: string;
  delegation: TurnPlanDelegation;
  cell?: CollaborationScene;
  bindingRegistry?: {
    getBinding(name: string): ResolvedAgentBinding | null | undefined;
  };
  replyAi: (payload: unknown) => Promise<unknown>;
  logger: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void };
}

export interface ExecuteInboundSpawnTaskResult {
  handled: boolean;
  path?: 'kernel_spawn_task' | 'spawn_task_legacy' | 'spawn_task_unavailable';
}

export async function executeInboundSpawnTaskTurn(
  input: ExecuteInboundSpawnTaskInput,
): Promise<ExecuteInboundSpawnTaskResult> {
  const {
    zhinAgent,
    commMessage,
    message,
    aiContent,
    delegation,
    cell,
    bindingRegistry,
    replyAi,
    logger,
  } = input;

  if (delegation.mode !== 'spawn_task') return { handled: false };
  if (!delegation.targetAgentId || delegation.targetAgentId === DEFAULT_ZHIN_AGENT_NAME) {
    return { handled: false };
  }

  const subagentSystem = zhinAgent.getSubagentSystem();
  if (!subagentSystem) {
    logger.warn(formatCompactLog('AI Handler', {
      path: 'spawn_task_unavailable',
      agent: delegation.targetAgentId,
      fallback: 'local_process',
    }));
    return { handled: false, path: 'spawn_task_unavailable' };
  }

  const targetAgentId = delegation.targetAgentId;
  const delegateText = aiContent.trim() || '请处理这条入站消息。';
  const orch = getOrchestrationService();
  let summary: string;
  let kernelTaskId: string | undefined;

  if (orch) {
    const run = await orch.findOrCreateRun({
      sessionKey: resolveIMSessionIdFromMessage(commMessage),
      title: aiContent.slice(0, 80) || `Route to ${targetAgentId}`,
      source: orchestrationSourceFromMessage(commMessage, cell?.id),
    });
    const dispatched = await orch.dispatchTask({
      runId: run.id,
      name: targetAgentId,
      description: delegateText,
      role: 'subtask',
      goal: delegateText,
      executorKind: 'local',
      assignedTo: targetAgentId,
      context: { route: 'inbound_spawn_task' },
      message: commMessage,
      autoStart: false,
    });
    kernelTaskId = dispatched.task.id;
    const completed = await orch.runTask(dispatched.task.id, commMessage);
    if (completed.status === 'failed') {
      throw new Error(completed.error ?? `subagent ${targetAgentId} failed`);
    }
    summary = completed.resultSummary ?? '';
  } else {
    summary = await subagentSystem.spawnSync({
      task: delegateText,
      label: targetAgentId,
      agent: targetAgentId,
      binding: bindingRegistry?.getBinding(targetAgentId) ?? undefined,
      origin: { message: commMessage },
      notifyContext: commMessage,
    });
  }

  const outboundSegments = await publishOutboundElements(parseOutput(summary), message.$adapter);
  if (outboundSegments.length) {
    await replyAi(outboundSegments);
  } else {
    const fallback = '任务已完成，但没有可展示的文本结果。';
    await replyAi(fallback);
    logger.warn(formatCompactLog('AI Handler', {
      path: 'kernel_spawn_task_empty_reply',
      task: kernelTaskId,
      agent: targetAgentId,
    }));
  }

  const emitter = zhinAgent.getEventEmitter();
  if (emitter) {
    const sessionId = resolveIMSessionIdFromMessage(commMessage);
    emitter.emit('ai.typing.stop', emitter.createPayload(sessionId, commMessage, 'text', {
      reason: 'spawn_task_reply',
    }));
  }

  logger.info(formatCompactLog('AI Handler', {
    path: kernelTaskId ? 'kernel_spawn_task' : 'spawn_task_legacy',
    task: kernelTaskId,
    agent: targetAgentId,
  }));

  return {
    handled: true,
    path: kernelTaskId ? 'kernel_spawn_task' : 'spawn_task_legacy',
  };
}
