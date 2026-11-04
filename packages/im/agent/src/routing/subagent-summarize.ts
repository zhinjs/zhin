import { assistantText, createUserMessage } from '@zhin.js/ai';
import type { ModelExecutionScope } from '../model-runtime/types.js';

export interface SummarizeSubagentResultOptions {
  readonly models: Pick<ModelExecutionScope, 'summary'>;
  readonly subagentName: string;
  readonly userRequest: string;
  readonly subagentResult: string;
  readonly signal?: AbortSignal;
}
/** Summarize only through the caller's deployment-owned summary operation. */
export async function summarizeSubagentResultForUser(input: SummarizeSubagentResultOptions): Promise<string> {
  const summary = input.models.summary;
  if (!summary) throw new Error('Summary inference scope is not configured');
  const system = `你是 Zhin 主助手。子 agent「${input.subagentName}」已完成任务，请将结果整理成面向用户的简洁回复（中文），保留关键事实，不要暴露内部工具名或 JSON。`;
  const user = `用户请求：\n${input.userRequest}\n\n子 agent 原始输出：\n${input.subagentResult}`;
  try {
    const answer = await summary.completion.complete(summary.model,
      { systemPrompt: system, messages: [createUserMessage(user)], tools: [] }, { signal: input.signal });
    return assistantText(answer).trim() || input.subagentResult;
  } catch { return input.subagentResult; }
}
