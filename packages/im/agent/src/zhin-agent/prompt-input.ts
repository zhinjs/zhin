import type { AgentMessage, ImageContent } from '@zhin.js/ai';
import { createUserMessage } from '@zhin.js/ai';

export function normalizePromptMessages(
  input: string | AgentMessage | AgentMessage[],
  images?: ImageContent[],
): AgentMessage[] {
  if (typeof input === 'string') {
    return [createUserMessage(input, images)];
  }
  return Array.isArray(input) ? input : [input];
}
