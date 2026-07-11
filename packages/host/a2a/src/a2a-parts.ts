/**
 * A2A v1.0 proto-shaped Part/Message helpers.
 */
import { Role, type Part } from '@a2a-js/sdk';

export function textPart(text: string, mediaType = 'text/plain'): Part {
  return {
    content: { $case: 'text', value: text },
    metadata: undefined,
    filename: '',
    mediaType,
  };
}

export function dataPart(data: unknown): Part {
  return {
    content: { $case: 'data', value: data },
    metadata: undefined,
    filename: '',
    mediaType: 'application/json',
  };
}

export function partsToPromptText(parts: Part[]): string {
  const lines: string[] = [];
  for (const part of parts) {
    if (part.content?.$case === 'text') {
      lines.push(part.content.value);
    } else if (part.content?.$case === 'data') {
      lines.push('```json', JSON.stringify(part.content.value, null, 2), '```');
    } else if (part.content?.$case === 'url') {
      lines.push(`[file: ${part.content.value}]`);
    }
  }
  return lines.join('\n').trim();
}

export function agentTextMessage(
  messageId: string,
  contextId: string,
  text: string,
  taskId = '',
): import('@a2a-js/sdk').Message {
  return {
    messageId,
    contextId,
    taskId,
    role: Role.ROLE_AGENT,
    parts: [textPart(text)],
    metadata: undefined,
    extensions: [],
    referenceTaskIds: [],
  };
}

export function userTextMessage(
  messageId: string,
  contextId: string,
  parts: Part[],
  metadata?: Record<string, unknown>,
): import('@a2a-js/sdk').Message {
  return {
    messageId,
    contextId,
    taskId: '',
    role: Role.ROLE_USER,
    parts,
    metadata,
    extensions: [],
    referenceTaskIds: [],
  };
}
