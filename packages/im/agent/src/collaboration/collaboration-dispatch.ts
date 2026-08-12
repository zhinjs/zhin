/**
 * CollaborationDispatch — deep module for peer delegation within a CollaborationScene.
 * @see docs/adr/0036-internal-room-collaboration.md
 */
import { type Message, resolveIMSessionIdFromMessage } from '@zhin.js/core';
import { getOrchestrationService } from '../orchestrator/orchestration-service.js';
import type { OrchestrationTask } from '../orchestrator/orchestration-types.js';
import { orchestrationSourceFromMessage } from './collaboration-kernel-bridge.js';
import type { CollaborationScene } from './types.js';
import { findCellMemberByEndpoint } from './collaboration-config.js';
export interface DispatchPeerTaskInput {
  cell: CollaborationScene;
  fromEndpointKey: string;
  toEndpointKey: string;
  goal: string;
  handlerProfile?: string;
  message?: Message;
  projectToIm?: boolean;
}

export interface DispatchPeerTaskResult {
  runId: string;
  taskId: string;
  task: OrchestrationTask;
  projectionTaskId?: string;
}

export function assertPeerMember(cell: CollaborationScene, endpointKey: string): void {
  if (!findCellMemberByEndpoint(cell, endpointKey)) {
    throw new Error(`endpoint "${endpointKey}" is not a member of collaboration scene "${cell.id}"`);
  }
}

export async function projectInternalRoomTaskToIm(input: {
  runId: string;
  taskId: string;
  message: Message;
  toEndpointKey: string;
  goal: string;
}): Promise<string> {
  const orch = getOrchestrationService();
  if (!orch) throw new Error('OrchestrationService is not initialized');
  const delegateText = input.goal.trim() || '请处理上述协作请求。';
  const projection = await orch.dispatchTask({
    runId: input.runId,
    name: `project:${input.toEndpointKey}`,
    description: delegateText,
    role: 'worker',
    goal: `#${input.taskId}\n${delegateText}`,
    executorKind: 'im_projection',
    assignedTo: input.toEndpointKey,
    context: { parentTaskId: input.taskId },
    message: input.message,
    autoStart: true,
  });
  return projection.task.id;
}

export async function dispatchPeerTask(input: DispatchPeerTaskInput): Promise<DispatchPeerTaskResult> {
  const orch = getOrchestrationService();
  if (!orch) throw new Error('OrchestrationService is not initialized');

  assertPeerMember(input.cell, input.fromEndpointKey);
  assertPeerMember(input.cell, input.toEndpointKey);

  const delegateText = input.goal.trim() || '请处理上述协作请求。';
  const message = input.message;
  const sessionKey = message ? resolveIMSessionIdFromMessage(message) : `collab:${input.cell.id}`;

  const run = await orch.findOrCreateRun({
    sessionKey,
    title: delegateText.slice(0, 80) || 'Collaboration peer delegation',
    source: message
      ? orchestrationSourceFromMessage(message, input.cell.id)
      : {
          kind: 'im_scene',
          collaborationSceneId: input.cell.id,
          scene: {
            platform: input.cell.adapter,
            endpointKey: input.fromEndpointKey,
            sceneId: input.cell.sceneId,
            kind: 'group',
          },
        },
  });

  const dispatched = await orch.dispatchTask({
    runId: run.id,
    name: `@${input.toEndpointKey}`,
    description: delegateText,
    role: 'worker',
    goal: delegateText,
    executorKind: 'internal_room',
    assignedTo: input.toEndpointKey,
    context: {
      collaborationSceneId: input.cell.id,
      fromEndpointKey: input.fromEndpointKey,
      handlerProfile: input.handlerProfile,
      projectToIm: input.projectToIm === true,
    },
    message,
    autoStart: false,
  });

  let projectionTaskId: string | undefined;
  if (input.projectToIm && message) {
    projectionTaskId = await projectInternalRoomTaskToIm({
      runId: run.id,
      taskId: dispatched.task.id,
      message,
      toEndpointKey: input.toEndpointKey,
      goal: delegateText,
    });
  }

  const task = await orch.runTask(dispatched.task.id, message);

  return {
    runId: run.id,
    taskId: dispatched.task.id,
    task,
    projectionTaskId,
  };
}
