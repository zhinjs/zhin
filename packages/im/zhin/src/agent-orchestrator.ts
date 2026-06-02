/**
 * 多 Agent 编排（zhin.js 层）
 *
 * 基于 AIService.createAgent() 提供：
 * - runPipeline：多步串联（上一步输出作为下一步输入）
 * - runParallel：多 Agent 并行执行
 * - route：按条件路由到不同专业 Agent
 */

import type { AIService } from '@zhin.js/agent';

/** 单步配置，与 AIService.createAgent 的 options 对齐 */
export interface AgentStepOptions {
  provider?: string;
  model?: string;
  systemPrompt?: string;
  useBuiltinTools?: boolean;
  collectExternalTools?: boolean;
  maxIterations?: number;
}

/** 流水线一步：prompt 中的 {input} 会被替换为当前输入（上一步输出或 initialInput） */
export interface PipelineStep extends AgentStepOptions {
  /** 本步提示模板，{input} 会被替换为当前输入 */
  prompt: string;
}

/** 并行任务一项 */
export interface ParallelTask extends AgentStepOptions {
  key: string;
  prompt: string;
}

/** 路由规则：条件匹配则用对应 Agent 执行 */
export interface RouteRule extends AgentStepOptions {
  /** 返回 true 时使用本规则 */
  when: (content: string) => boolean;
  /** 执行时的提示（可包含 {content}） */
  prompt?: string;
}

/**
 * 串联执行多步 Agent：每一步的输入为上一步的输出（第一步为 initialInput）。
 * @param ai AIService 实例（如 useContext('ai', ai => ...)）
 * @param steps 步骤列表，每步的 prompt 中可用 {input} 表示当前输入
 * @param initialInput 第一步的输入内容
 * @returns 最后一步的输出文本
 */
export async function runPipeline(
  ai: AIService,
  steps: PipelineStep[],
  initialInput: string,
): Promise<string> {
  if (steps.length === 0) return initialInput;
  let currentInput = initialInput;
  for (const step of steps) {
    const agent = ai.createAgent({
      provider: step.provider,
      model: step.model,
      systemPrompt: step.systemPrompt,
      useBuiltinTools: step.useBuiltinTools,
      collectExternalTools: step.collectExternalTools,
      maxIterations: step.maxIterations,
    });
    const promptText = step.prompt.replace(/\{input\}/g, currentInput);
    const result = await agent.run(promptText);
    currentInput = result.content ?? '';
  }
  return currentInput;
}

/**
 * 并行执行多个 Agent 任务，互不依赖。
 * @param ai AIService 实例
 * @param tasks 任务列表，每项有 key 与 prompt
 * @returns 以 key 为键、输出为值的对象
 */
export async function runParallel(
  ai: AIService,
  tasks: ParallelTask[],
): Promise<Record<string, string>> {
  const entries = await Promise.all(
    tasks.map(async (task) => {
      const agent = ai.createAgent({
        provider: task.provider,
        model: task.model,
        systemPrompt: task.systemPrompt,
        useBuiltinTools: task.useBuiltinTools,
        collectExternalTools: task.collectExternalTools,
        maxIterations: task.maxIterations,
      });
      const result = await agent.run(task.prompt);
      return [task.key, result.content ?? ''] as const;
    }),
  );
  return Object.fromEntries(entries);
}

/**
 * 按规则路由：用第一个匹配的规则对应的 Agent 执行。
 * @param ai AIService 实例
 * @param content 用户输入
 * @param rules 路由规则列表，按顺序匹配
 * @param defaultOptions 无匹配时使用的默认 Agent 配置（若未提供则返回 content）
 * @returns 对应 Agent 的回复，若无匹配且无 defaultOptions 则返回原 content
 */
export async function route(
  ai: AIService,
  content: string,
  rules: RouteRule[],
  defaultOptions?: AgentStepOptions,
): Promise<string> {
  for (const rule of rules) {
    if (!rule.when(content)) continue;
    const agent = ai.createAgent({
      provider: rule.provider,
      model: rule.model,
      systemPrompt: rule.systemPrompt,
      useBuiltinTools: rule.useBuiltinTools,
      collectExternalTools: rule.collectExternalTools,
      maxIterations: rule.maxIterations,
    });
    const prompt = rule.prompt != null ? rule.prompt.replace(/\{content\}/g, content) : content;
    const result = await agent.run(prompt);
    return result.content ?? '';
  }
  if (defaultOptions) {
    const agent = ai.createAgent(defaultOptions);
    const result = await agent.run(content);
    return result.content ?? content;
  }
  return content;
}
