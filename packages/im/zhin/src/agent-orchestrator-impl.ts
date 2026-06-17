/**
 * 多 Agent 编排（zhin.js/agent 子路径）
 */
import type { AIService } from '@zhin.js/agent';

export interface AgentStepOptions {
  provider?: string;
  model?: string;
  systemPrompt?: string;
  useBuiltinTools?: boolean;
  collectExternalTools?: boolean;
  maxIterations?: number;
}

export interface PipelineStep extends AgentStepOptions {
  prompt: string;
}

export interface ParallelTask extends AgentStepOptions {
  key: string;
  prompt: string;
}

export interface RouteRule extends AgentStepOptions {
  when: (content: string) => boolean;
  prompt?: string;
}

export async function runPipeline(
  ai: AIService,
  steps: PipelineStep[],
  initialInput: string,
): Promise<string> {
  if (steps.length === 0) return initialInput;
  let currentInput = initialInput;
  for (const step of steps) {
    const promptText = step.prompt.replace(/\{input\}/g, currentInput);
    const result = await ai.runAgent(promptText, {
      provider: step.provider,
      model: step.model,
      systemPrompt: step.systemPrompt,
      useBuiltinTools: step.useBuiltinTools,
      collectExternalTools: step.collectExternalTools,
      maxIterations: step.maxIterations,
    });
    currentInput = result.content ?? '';
  }
  return currentInput;
}

export async function runParallel(
  ai: AIService,
  tasks: ParallelTask[],
): Promise<Record<string, string>> {
  const entries = await Promise.all(
    tasks.map(async (task) => {
      const result = await ai.runAgent(task.prompt, {
        provider: task.provider,
        model: task.model,
        systemPrompt: task.systemPrompt,
        useBuiltinTools: task.useBuiltinTools,
        collectExternalTools: task.collectExternalTools,
        maxIterations: task.maxIterations,
      });
      return [task.key, result.content ?? ''] as const;
    }),
  );
  return Object.fromEntries(entries);
}

export async function route(
  ai: AIService,
  content: string,
  rules: RouteRule[],
  defaultOptions?: AgentStepOptions,
): Promise<string> {
  for (const rule of rules) {
    if (!rule.when(content)) continue;
    const prompt = rule.prompt != null ? rule.prompt.replace(/\{content\}/g, content) : content;
    const result = await ai.runAgent(prompt, {
      provider: rule.provider,
      model: rule.model,
      systemPrompt: rule.systemPrompt,
      useBuiltinTools: rule.useBuiltinTools,
      collectExternalTools: rule.collectExternalTools,
      maxIterations: rule.maxIterations,
    });
    return result.content ?? '';
  }
  if (defaultOptions) {
    const result = await ai.runAgent(content, defaultOptions);
    return result.content ?? content;
  }
  return content;
}
