/**
 * Peer 入站 handback（OrchestrationKernel SSOT；阶段 4）。
 */
import { type Message, resolveIMSessionIdFromMessage } from '@zhin.js/core';
import { formatCompactLog } from '@zhin.js/logger';
import { getOrchestrationService } from '../orchestrator/orchestration-service.js';
import { normalizeExecutorKind } from '../orchestrator/orchestration-mappers.js';
import {
  findActiveImProjectionTasksForEndpoint,
} from './collaboration-kernel-bridge.js';
import {
  isSubstantiveGroupTaskReply,
  messageTextContent,
  summarizeDelegateeReply,
} from './collaboration-delegation.js';
import type { CollaborationScene } from './types.js';
export interface PeerInboundHandbackInput {
  message: Message;
  cell: CollaborationScene;
  peerEndpointId: string;
  replyAi: (payload: unknown) => Promise<unknown>;
  logger: { debug: (...args: unknown[]) => void; info: (...args: unknown[]) => void };
}

/** @returns true 表示 pipeline 应提前结束（如 ambiguous handback 已回复） */
export async function tryHandlePeerInboundHandback(input: PeerInboundHandbackInput): Promise<boolean> {
  const orch = getOrchestrationService();
  if (!orch) return false;

  const { message, cell, peerEndpointId, replyAi, logger } = input;
  const rawText = messageTextContent(message);
  const explicitTaskId = rawText.match(/(?:^|[\s(（])#([A-Za-z0-9_-]{4,})(?=$|[\s),，。.!！?:：）])/u)?.[1];
  const sessionKey = resolveIMSessionIdFromMessage(message);
  const runs = await orch.listRuns(sessionKey);
  const activeGroupTasks = runs.flatMap((run) =>
    findActiveImProjectionTasksForEndpoint(run.tasks, peerEndpointId),
  );
  const target = explicitTaskId
    ? activeGroupTasks.find((task) => task.id === explicitTaskId)
      ?? (await orch.repositoryHandle.getTask(explicitTaskId))
    : activeGroupTasks.length === 1
      ? activeGroupTasks[0]
      : undefined;

  if (!explicitTaskId && activeGroupTasks.length > 1) {
    const hint = `检测到 ${activeGroupTasks.length} 个活跃任务，请在回复中带上 #taskId，例如 #${activeGroupTasks[0]!.id}`;
    for (const task of activeGroupTasks) {
      await orch.taskProgress(task.id, `ambiguous handback from ${peerEndpointId}; taskId required`);
    }
    await replyAi(hint);
    return true;
  }

  if (target && normalizeExecutorKind(target.executor_kind) === 'im_projection') {
    const assignee = target.assigned_to || peerEndpointId;
    if (assignee !== peerEndpointId) {
      logger.debug(formatCompactLog('OrchestrationKernel', {
        action: 'group_handback_skip',
        reason: 'assignee_mismatch',
        task: target.id,
        assignee,
        from: peerEndpointId,
      }));
    } else {
      const summary = summarizeDelegateeReply(
        explicitTaskId ? rawText.replace(`#${explicitTaskId}`, '').trim() : rawText,
      );
      if (!isSubstantiveGroupTaskReply(summary)) {
        logger.info(formatCompactLog('OrchestrationKernel', {
          action: 'group_handback_skip',
          reason: 'not_substantive',
          task: target.id,
          from: peerEndpointId,
        }));
      } else {
        await orch.completeTask(target.id, summary);
        logger.info(formatCompactLog('OrchestrationKernel', {
          action: 'group_handback',
          task: target.id,
          cell: cell.id,
          from: peerEndpointId,
        }));
      }
    }
  }

  return false;
}
