/**
 * Build A2A SendMessageRequest from orchestration task fields.
 */
import { randomUUID } from 'node:crypto';
import { type Part, type SendMessageRequest, Role } from '@a2a-js/sdk';
export interface DelegationTaskPayload {
  title: string;
  description: string;
  acceptance_criteria?: string;
  artifacts?: Array<{ name?: string; content?: string; mime?: string }>;
  role?: string;
}

function textPart(text: string): Part {
  return {
    content: { $case: 'text', value: text },
    metadata: undefined,
    filename: '',
    mediaType: 'text/plain',
  };
}

function dataPart(data: unknown): Part {
  return {
    content: { $case: 'data', value: data },
    metadata: undefined,
    filename: '',
    mediaType: 'application/json',
  };
}

export function buildSendMessageRequest(payload: DelegationTaskPayload): SendMessageRequest {
  const parts: Part[] = [textPart(`# ${payload.title}\n\n${payload.description}`)];
  if (payload.acceptance_criteria?.trim()) {
    parts.push(textPart(`## Acceptance Criteria\n${payload.acceptance_criteria}`));
  }
  if (payload.artifacts?.length) {
    parts.push(dataPart({ artifacts: payload.artifacts }));
  }

  const metadata: Record<string, unknown> = {};
  if (payload.role?.trim()) metadata.skillId = payload.role.trim();

  return {
    tenant: '',
    message: {
      messageId: randomUUID(),
      contextId: '',
      taskId: '',
      role: Role.ROLE_USER,
      parts,
      metadata,
      extensions: [],
      referenceTaskIds: [],
    },
    configuration: {
      acceptedOutputModes: ['text/plain'],
      returnImmediately: true,
      taskPushNotificationConfig: undefined,
    },
    metadata: payload.role ? { skillId: payload.role } : {},
  };
}
