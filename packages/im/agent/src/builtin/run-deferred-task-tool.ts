/**
 * run_deferred_task — 在同步 Worker 子 Agent 中执行 deferred 工具任务
 */
import type { Tool, ToolParametersSchema, ToolResult } from '@zhin.js/core';
import { BuiltinBaseTool } from './builtin-base-tool.js';

export const RUN_DEFERRED_TASK_PARAMETERS: ToolParametersSchema = {
  type: 'object',
  properties: {
    goal: {
      type: 'string',
      description: '交给 Worker 完成的完整任务描述（目标、仓库、期望输出）',
    },
    tool_query: {
      type: 'string',
      description: '用于 TF-IDF 选取 deferred 工具的搜索词；省略则使用 goal',
    },
  },
  required: ['goal'],
};

export interface RunDeferredTaskToolOptions {
  runWorker: (goal: string, toolQuery?: string) => Promise<string>;
  /** Agent 层工具执行超时（毫秒），默认 180_000 */
  timeoutMs?: number;
}

export class RunDeferredTaskBuiltinTool extends BuiltinBaseTool {
  readonly name = 'run_deferred_task';
  readonly description =
    '在隔离的 Worker 子 Agent 中异步执行 deferred 工具任务（github/mcp/插件等）。立即返回委派态，完成后单独推送结果。这是调用 deferred 能力的唯一入口';
  readonly parameters = RUN_DEFERRED_TASK_PARAMETERS;
  readonly kind = 'meta';
  readonly executionTimeoutMs: number;

  constructor(private readonly opts: RunDeferredTaskToolOptions) {
    super();
    this.executionTimeoutMs = opts.timeoutMs ?? 180_000;
    this.tags.push('deferred', 'worker', 'delegate');
    this.keywords.push('执行', '委托', 'worker', 'deferred', 'github', 'mcp');
  }

  async run(args: Record<string, unknown>): Promise<ToolResult> {
    const goal = String(args.goal ?? '').trim();
    if (!goal) return '请提供 goal 参数';
    const toolQuery = args.tool_query != null ? String(args.tool_query).trim() : undefined;
    return this.opts.runWorker(goal, toolQuery || undefined);
  }
}

export function createRunDeferredTaskTool(opts: RunDeferredTaskToolOptions): Tool {
  return new RunDeferredTaskBuiltinTool(opts).toTool();
}
