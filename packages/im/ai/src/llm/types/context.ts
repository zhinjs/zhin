import type { AgentMessage } from './agent-message.js';
import type { LlmTool } from './tool.js';

/** Serializable LLM context (ADR 0009 D2). */
export interface Context {
  systemPrompt: string;
  messages: AgentMessage[];
  tools?: LlmTool[];
  /**
   * 调用方已自行完成 repairAgentMessagesForLlm（如 agentLoop 的增量修复不变量）时置真，
   * 桥序列化跳过重复的全量修复。外部调用方缺省 false，桥保持安全默认。
   */
  preRepaired?: boolean;
}

export function createContext(
  systemPrompt: string,
  messages: AgentMessage[] = [],
  tools?: LlmTool[],
): Context {
  return { systemPrompt, messages, tools };
}
