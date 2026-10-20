import { type AgentMessage, type MediaContentBlock, createUserMessage } from '@zhin.js/ai';
export function normalizePromptMessages(
  input: string | AgentMessage | AgentMessage[],
  media?: MediaContentBlock[],
): AgentMessage[] {
  if (typeof input === 'string') {
    return [createUserMessage(input, media)];
  }
  return Array.isArray(input) ? input : [input];
}
