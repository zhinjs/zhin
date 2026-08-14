import type { PromptLayer } from './prompt-builder.js';

export interface AgentPromptSectionConfig {
  id: string;
  title: string;
  content: string;
  priority?: number;
  truncatable?: boolean;
  maxChars?: number;
  metadata?: Record<string, unknown>;
  /** 层级（用于分类，不直接影响排序） */
  layer?: PromptLayer | 'plugin';
}

/**
 * 定义一个 Agent 提示词节点。
 *
 * 插件将此函数的返回值作为 `agent/prompt-sections/` 下文件的默认导出，
 * 框架在 Agent 初始化时会自动发现并注册到 `PromptAssemblyRegistry`。
 *
 * @example
 * export default defineAgentPromptSection({
 *   id: 'my-plugin:context',
 *   title: 'My Context',
 *   content: 'Rules and context...',
 *   priority: 75,
 *   truncatable: true,
 * });
 */
export function defineAgentPromptSection(
  config: AgentPromptSectionConfig,
): AgentPromptSectionConfig {
  return {
    layer: 'plugin',
    ...config,
  };
}
