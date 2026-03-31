/**
 * AgentPreset — 插件声明的专长 Agent 预设
 *
 * 核心概念：
 *   Tool    = 单个 AI 可调用的能力（函数）
 *   Skill   = 一组相关 Tool + 发现元数据（SKILL.md）
 *   Agent   = 针对特定领域的 Agent 预设（*.agent.md）
 *
 * Agent 预设以标准 *.agent.md 文件提供，框架自动扫描发现。
 * 主 Agent（ZhinAgent）可根据用户请求自动委派给匹配的专长 Agent。
 */

import type { Tool } from '../types.js';

// ============================================================================
// AgentPreset 接口
// ============================================================================

/**
 * Agent 预设（从 *.agent.md 文件解析或编程式注册）
 */
export interface AgentPreset {
  /** 预设名称（唯一标识） */
  name: string;

  /** 描述（AI 用来判断何时委派给此 Agent） */
  description: string;

  /** 自定义系统提示词（从 agent.md body 提取或显式指定） */
  systemPrompt?: string;

  /** 关联的工具列表 */
  tools?: Tool[];

  /** 触发关键词（用户消息匹配时优先考虑此 Agent） */
  keywords?: string[];

  /** 分类标签 */
  tags?: string[];

  /** 首选模型名 */
  model?: string;

  /** 首选 Provider 名 */
  provider?: string;

  /** 最大工具调用迭代次数 */
  maxIterations?: number;

  /** 来源插件名（由框架自动填充） */
  pluginName?: string;

  /** *.agent.md 文件的绝对路径 */
  filePath?: string;
}
