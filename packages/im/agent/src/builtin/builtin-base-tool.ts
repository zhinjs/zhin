/**
 * 内置系统工具基类 — 产出与 {@link ToolFeature} / {@link normalizeTool} 兼容的 {@link Tool}，
 * 便于将核心逻辑写在可单测的 `run` 中（见 PRD #389 / issue #390）。
 */
import type { Tool, Message, ToolParametersSchema, ToolResult } from '@zhin.js/core';

export abstract class BuiltinBaseTool {
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly parameters: ToolParametersSchema;

  /** 与 ZhinTool 链式 API 对齐 */
  readonly tags: string[] = [];
  readonly keywords: string[] = [];
  readonly kind?: string;
  /** 仅当为 true 时写入 Tool */
  readonly preExecutable?: boolean;
  /** Agent 工具执行超时（毫秒），覆盖默认 30s */
  readonly executionTimeoutMs?: number;

  /**
   * 核心执行逻辑（单测优先覆盖此处）。
   */
  abstract run(args: Record<string, unknown>, commMessage?: Message): Promise<ToolResult>;

  /**
   * 注册到 ToolFeature；带 `source` 以便 `normalizeTool` 识别为 IM 工具形态并绑定 context。
   */
  toTool(): Tool {
    const tool: Tool = {
      name: this.name,
      description: this.description,
      parameters: this.parameters,
      source: 'builtin:agent',
      execute: async (args, ctx) => this.run(args as Record<string, unknown>, ctx),
    };
    if (this.tags.length) tool.tags = [...this.tags];
    if (this.keywords.length) tool.keywords = [...this.keywords];
    if (this.kind) tool.kind = this.kind;
    if (this.preExecutable) tool.preExecutable = true;
    if (this.executionTimeoutMs != null) {
      (tool as Tool & { timeout?: number }).timeout = this.executionTimeoutMs;
    }
    return tool;
  }
}
