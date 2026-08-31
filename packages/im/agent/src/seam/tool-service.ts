/**
 * Tool Service Definition
 *
 * 所有 Tool 提供者必须实现此接口。
 * 支持按作用域隔离，避免不同 agent/session 间的工具冲突。
 */

import type { SeamProvider, SeamScope } from './seam-provider.js';
import type { ToolInvocationContext, ToolApproval, ToolScope } from '@zhin.js/tool';

/**
 * Tool 的 OpenAI 格式 Schema
 */
export interface ToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: unknown; // JSONSchema
  };
  /** Runtime policy metadata projected into the canonical Tool capability. */
  approval?: ToolApproval;
  platforms?: readonly string[];
  scopes?: readonly ToolScope[];
  permissions?: readonly string[];
  hidden?: boolean;
  source?: string;
}

/**
 * Tool 执行结果
 */
export interface ToolExecutionResult {
  success: boolean;
  output?: unknown;
  error?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Tool Service Definition
 */
export interface ToolService extends SeamProvider {
  /**
   * 获取该 Service 提供的所有工具 Schema
   *
   * @param scope - 当前作用域
   * @returns OpenAI 格式的工具数组
   */
  schema(scope: SeamScope | 'global'): ToolSchema[];

  /**
   * 执行一个工具
   *
   * @param scope - 当前作用域
   * @param toolName - 工具名称（对应 schema[].function.name）
   * @param args - 工具参数
   * @returns 执行结果
   */
  execute(
    scope: SeamScope | 'global',
    toolName: string,
    args: unknown,
    context: ToolInvocationContext,
  ): Promise<ToolExecutionResult>;

  /**
   * 可选：检查工具是否在该作用域可用
   */
  isAvailable?(scope: SeamScope | 'global', toolName: string): boolean;

  /** Provider-local policy. Runtime generation, permission and approval policy always runs first. */
  applyPolicy?(
    scope: SeamScope | 'global',
    toolName: string,
    args: unknown,
    context: ToolInvocationContext,
  ): Promise<void>;
}

export type ToolServiceProvider = ToolService;
