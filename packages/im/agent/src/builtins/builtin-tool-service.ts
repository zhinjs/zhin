/**
 * Builtin Tool Service Provider
 *
 * 将框架内置的 ask_user 工具包装为标准的 ToolService，
 * 作为 SeamIntegration 的最小内置注册示例。
 *
 * 完整的内置工具集通过 builtin-tools.ts 的工厂函数提供，
 * 此处仅演示接缝接入模式。
 */

import type { SeamScope } from '../seam/seam-provider.js';
import type { ToolService, ToolSchema, ToolExecutionResult } from '../seam/tool-service.js';

const ASK_USER_SCHEMA: ToolSchema = {
  type: 'function',
  function: {
    name: 'ask_user',
    description: 'Ask the user for input, clarification, or approval.',
    parameters: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'The question or prompt to present to the user.',
        },
      },
      required: ['question'],
    },
  },
};

/**
 * Builtin Tool Service
 *
 * 当前提供 ask_user 作为框架内置交互工具的接缝接入示例。
 * 可以通过 SeamIntegration.registerToolService('global', new BuiltinToolService()) 注册。
 */
export class BuiltinToolService implements ToolService {
  readonly id = 'zhin:builtin-tools';
  readonly description = 'Zhin framework builtin interactive tools';
  readonly version = '4.x';
  readonly tags = ['builtin', 'framework'];

  schema(_scope: SeamScope | 'global'): ToolSchema[] {
    return [ASK_USER_SCHEMA];
  }

  async execute(
    _scope: SeamScope | 'global',
    toolName: string,
    args: unknown,
  ): Promise<ToolExecutionResult> {
    if (toolName === 'ask_user') {
      return this.handleAskUser(args);
    }
    return { success: false, error: `Unknown builtin tool: ${toolName}` };
  }

  isAvailable(_scope: SeamScope | 'global', toolName: string): boolean {
    return toolName === 'ask_user';
  }

  private handleAskUser(args: unknown): ToolExecutionResult {
    if (
      typeof args !== 'object' ||
      args === null ||
      typeof (args as Record<string, unknown>)['question'] !== 'string'
    ) {
      return { success: false, error: 'ask_user requires a "question" string argument' };
    }
    // 实际执行由上层（interactive session）处理；此处返回成功表示接受请求
    return {
      success: true,
      output: { question: (args as Record<string, unknown>)['question'] },
    };
  }
}
