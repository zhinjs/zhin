/**
 * Map A2A TaskState to remote_mesh poll status strings.
 */
import type { Task } from '@a2a-js/sdk';
import { TaskState, taskStateToJSON } from '@a2a-js/sdk';

export type RemotePollStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

function stateKey(state: TaskState | undefined): string {
  if (state === undefined) return '';
  return taskStateToJSON(state);
}

export function mapA2aTaskState(state: TaskState | string | undefined): RemotePollStatus {
  const key = typeof state === 'string' ? state : stateKey(state);
  switch (key) {
    case 'TASK_STATE_COMPLETED':
      return 'completed';
    case 'TASK_STATE_FAILED':
      return 'failed';
    case 'TASK_STATE_CANCELED':
      return 'cancelled';
    case 'TASK_STATE_SUBMITTED':
      return 'pending';
    case 'TASK_STATE_WORKING':
    case 'TASK_STATE_INPUT_REQUIRED':
    case 'TASK_STATE_AUTH_REQUIRED':
      return 'running';
    default:
      return 'running';
  }
}

export function extractTaskResultText(task: Task): string {
  const statusMsg = task.status?.message;
  if (statusMsg?.parts?.length) {
    const text = statusMsg.parts
      .map((p) => (p.content?.$case === 'text' ? p.content.value : ''))
      .join('\n')
      .trim();
    if (text) return text;
  }
  for (const artifact of task.artifacts ?? []) {
    const text = artifact.parts
      ?.map((p) => (p.content?.$case === 'text' ? p.content.value : ''))
      .join('\n')
      .trim();
    if (text) return text;
  }
  return '';
}

export function isTerminalA2aState(state: TaskState | string | undefined): boolean {
  const mapped = mapA2aTaskState(state);
  return mapped === 'completed' || mapped === 'failed' || mapped === 'cancelled';
}
