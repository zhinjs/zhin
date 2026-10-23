import { asSchema } from 'ai';
import type { Context } from '../llm/types/context.js';
import type { Model } from '../llm/types/model.js';
import { llmToolsToAiSdk } from '../llm/bridge/ai-sdk-messages.js';
import { structuredOutputMode, withStructuredOutputInstruction } from '../llm/bridge/prompt-structured-output.js';
import { estimateTextTokens } from './token-counter.js';

/** 请求的固定文本预算；工具 Schema 与发送桥共用转换，不估算 Zod 实例本身。 */
export async function estimateContextFixedTokens(input: Pick<Context, 'systemPrompt' | 'tools'> & {
  model?: Pick<Model, 'sdk' | 'compat'>;
  outputSchema?: Record<string, unknown>;
}): Promise<number> {
  const promptSchema = input.outputSchema && structuredOutputMode(input.model ?? {}) === 'prompt';
  const systemPrompt = promptSchema
    ? withStructuredOutputInstruction({ systemPrompt: input.systemPrompt, messages: [] }, input.outputSchema!).systemPrompt
    : input.systemPrompt;
  let tokens = estimateTextTokens(systemPrompt);
  if (input.outputSchema && !promptSchema) tokens += estimateTextTokens(JSON.stringify(input.outputSchema));
  // Anthropic 的延迟工具虽随请求发送，尚未披露时不占固定上下文。
  const loadedTools = input.model?.sdk === 'anthropic'
    ? input.tools?.filter(tool => !tool.deferLoading)
    : input.tools;
  const tools = llmToolsToAiSdk(loadedTools, { sdk: input.model?.sdk });
  for (const [name, tool] of Object.entries(tools ?? {})) {
    const parameters = await asSchema(tool.inputSchema).jsonSchema;
    tokens += estimateTextTokens(JSON.stringify({ name, description: tool.description, parameters }));
  }
  return tokens;
}
