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

import { Feature, type FeatureJSON } from '../feature.js';
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

// ============================================================================
// AgentPresetFeature
// ============================================================================

declare module '../plugin.js' {
  namespace Plugin {
    interface Contexts {
      agentPreset: AgentPresetFeature;
    }
  }
}

export class AgentPresetFeature extends Feature<AgentPreset> {
  readonly name = 'agentPreset' as const;
  readonly icon = 'Bot';
  readonly desc = 'Agent 预设';

  readonly byName = new Map<string, AgentPreset>();

  add(preset: AgentPreset, pluginName: string): () => void {
    this.byName.set(preset.name, preset);
    return super.add(preset, pluginName);
  }

  remove(preset: AgentPreset, pluginName?: string): boolean {
    this.byName.delete(preset.name);
    return super.remove(preset, pluginName);
  }

  get(name: string): AgentPreset | undefined {
    return this.byName.get(name);
  }

  /** 清理所有预设注册（热重载时由 Plugin.stop() 调用） */
  dispose(): void {
    this.byName.clear();
  }

  getAll(): AgentPreset[] {
    return [...this.items];
  }

  search(query: string, options?: { maxResults?: number }): AgentPreset[] {
    const maxResults = options?.maxResults ?? 5;
    const lower = query.toLowerCase();
    const scored = this.items
      .map(preset => ({ preset, score: this.#scorePreset(preset, lower) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults);
    return scored.map(({ preset }) => preset);
  }

  #scorePreset(preset: AgentPreset, query: string): number {
    let score = 0;
    if (preset.name.toLowerCase().includes(query)) score += 10;
    if (preset.description.toLowerCase().includes(query)) score += 5;
    for (const kw of preset.keywords || []) {
      if (kw.toLowerCase().includes(query) || query.includes(kw.toLowerCase())) score += 8;
    }
    for (const tag of preset.tags || []) {
      if (tag.toLowerCase().includes(query)) score += 3;
    }
    return score;
  }

  toJSON(pluginName?: string): FeatureJSON {
    const list = pluginName ? this.getByPlugin(pluginName) : this.items;
    return {
      name: this.name,
      icon: this.icon,
      desc: this.desc,
      count: list.length,
      items: list.map(p => ({
        name: p.name,
        desc: p.description,
        keywords: p.keywords,
        tags: p.tags,
        model: p.model,
        provider: p.provider,
      })),
    };
  }
}
