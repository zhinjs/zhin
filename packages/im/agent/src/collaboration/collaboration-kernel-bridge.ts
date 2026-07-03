/**
 * Collaboration ↔ OrchestrationKernel 桥接（ADR 0027）。
 * Kernel 就绪时 Cell 不再写入 activeDelegations；handback 走 task 完成。
 */
import { formatCompactLog } from '@zhin.js/logger';
import type { Message, MessageElement } from '@zhin.js/core';
import { sceneRefFromMessage } from '@zhin.js/core';
import { resolveIMSessionIdFromMessage } from '@zhin.js/ai';
import type { CollaborationCell } from './types.js';
import type { OrchestrationRunSource, OrchestrationSceneRef, OrchestrationTaskRecord } from '@zhin.js/ai';
import { getOrchestrationService } from '../orchestrator/orchestration-service.js';
import { normalizeExecutorKind } from '../orchestrator/kernel-mappers.js';
import {
  isSubstantiveGroupTaskReply,
  resolvePlannerEndpointId,
  summarizeDelegateeReply,
} from './collaboration-delegation.js';
import { sendGroupPeerMention } from './im-mention-delegate.js';

export function isOrchestrationKernelReady(): boolean {
  return getOrchestrationService() != null;
}

/** Legacy pipelineState.activeDelegations harness — kernel 就绪时停用。 */
export function shouldUseLegacyCellDelegationHarness(cell?: CollaborationCell): boolean {
  if (isOrchestrationKernelReady()) return false;
  return Boolean(cell?.pipelineState?.activeDelegations?.length);
}

const ACTIVE_GROUP_TASK_STATUSES = new Set([
  'assigned',
  'running',
  'waiting_result',
  'pending',
]);

function flattenOutboundText(batches: MessageElement[][]): string {
  return batches
    .flat()
    .filter((seg) => seg.type === 'text' && seg.data?.text != null)
    .map((seg) => String(seg.data!.text))
    .join(' ')
    .trim();
}

export function orchestrationSourceFromMessage(
  message: Message,
  cellId?: string,
): OrchestrationRunSource {
  const scene = sceneRefFromMessage(message);
  if (!scene) {
    return { kind: 'manual', label: 'orchestration' };
  }
  const orchestrationScene: OrchestrationSceneRef = {
    platform: scene.platform,
    endpointId: scene.endpointId,
    sceneId: scene.sceneId,
    kind: scene.kind,
    ...(scene.senderId ? { senderId: scene.senderId } : {}),
    ...(scene.parent ? { parent: scene.parent } : {}),
  };
  return {
    kind: 'im_scene',
    scene: orchestrationScene,
    ...(cellId ? { cellId } : {}),
  };
}

export function findActiveSceneMentionTasksForEndpoint(
  tasks: OrchestrationTaskRecord[],
  endpointId: string,
): OrchestrationTaskRecord[] {
  return tasks.filter((task) =>
    normalizeExecutorKind(task.executor_kind) === 'scene_mention'
    && task.assigned_to === endpointId
    && ACTIVE_GROUP_TASK_STATUSES.has(task.status),
  );
}

export async function listActiveSceneMentionTasks(
  message: Message,
  endpointId: string,
): Promise<OrchestrationTaskRecord[]> {
  const orch = getOrchestrationService();
  if (!orch) return [];
  const sessionKey = resolveIMSessionIdFromMessage(message);
  const runs = await orch.listRuns(sessionKey);
  return runs.flatMap((run) => findActiveSceneMentionTasksForEndpoint(run.tasks, endpointId));
}

/**
 * 被委派方 AI 出站后：实质公开回复 → completeTask + 可选 handback @Planner（含 #taskId）。
 */
export async function tryCompleteKernelGroupMentionFromOutbound(input: {
  message: Message;
  cell: CollaborationCell;
  endpointId: string;
  outboundBatches: MessageElement[][];
  logger: { info: (...args: unknown[]) => void };
}): Promise<void> {
  const orch = getOrchestrationService();
  if (!orch) return;

  const publicText = flattenOutboundText(input.outboundBatches);
  if (!isSubstantiveGroupTaskReply(publicText)) return;

  const active = await listActiveSceneMentionTasks(input.message, input.endpointId);
  if (active.length !== 1) return;

  const task = active[0]!;
  const summary = summarizeDelegateeReply(publicText);
  if (!isSubstantiveGroupTaskReply(summary)) return;

  await orch.completeTask(task.id, summary);
  input.logger.info(formatCompactLog('OrchestrationKernel', {
    action: 'kernel_group_task_complete',
    task: task.id,
    cell: input.cell.id,
    endpoint: input.endpointId,
  }));

  const plannerId = resolvePlannerEndpointId(input.cell);
  if (!plannerId || plannerId === input.endpointId) return;

  const handbackText = `#${task.id} 已完成：${summary}`;
  await sendGroupPeerMention({
    message: { ...input.message, $endpoint: input.endpointId } as Message,
    targetEndpointId: plannerId,
    text: handbackText,
  });
}
