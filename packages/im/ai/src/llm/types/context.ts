import type { AgentMessage } from './agent-message.js';
import type { LlmTool } from './tool.js';

/** Serializable LLM context (ADR 0009 D2). */
export interface Context {
  systemPrompt: string;
  messages: AgentMessage[];
  tools?: LlmTool[];
}

export function createContext(
  systemPrompt: string,
  messages: AgentMessage[] = [],
  tools?: LlmTool[],
): Context {
  return { systemPrompt, messages, tools };
}
