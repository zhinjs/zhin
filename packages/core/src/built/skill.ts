/**
 * SkillFeature — AI 可见能力描述层
 *
 * 核心概念：
 *   Plugin = 运行时容器（生命周期、服务注册、中间件）
 *   Skill  = AI 可见的能力接口（名称、描述、工具列表）
 *
 * Skill 记录由运行时注入（如 Agent 从磁盘 SKILL.md 同步），供 Agent 粗筛与工具关联。
 *
 * SkillFeature 全局收集所有 Skill，供 Agent 进行两级过滤：
 *   1. 粗筛：根据用户消息选择相关 Skill
 *   2. 细筛：从选中 Skill 内选择具体 Tool
 */

import { Feature, FeatureJSON } from '../feature.js';
import type { Tool } from '../types.js';

// ============================================================================
// Skill 接口
// ============================================================================

/**
 * Skill — AI 可见的能力描述
 */
export interface Skill {
  /** 技能名称（通常与插件名一致） */
  name: string;

  /** 技能描述（AI 用来理解这个 Skill 的用途） */
  description: string;

  /** 该 Skill 提供的工具列表 */
  tools: Tool[];

  /**
   * 触发关键词
   * 当用户消息包含这些关键词时，优先选择此 Skill
   */
  keywords?: string[];

  /**
   * 分类标签
   * 用于按领域分组（如 'news', 'weather', 'entertainment'）
   */
  tags?: string[];

  /** 来源插件名 */
  pluginName: string;

  /**
   * SKILL.md 文件的绝对路径
   * 存在时 activate_skill 可按需加载完整指令内容
   */
  filePath?: string;

  /**
   * 是否常驻注入 system prompt
   * 仅在 filePath 存在时有效
   */
  always?: boolean;
}

/**
 * SKILL.md frontmatter 常见字段（类型提示；运行时由 Agent 等同步到 SkillFeature）
 */
export interface SkillMetadata {
  /** 技能描述（必填） */
  description: string;

  /** 触发关键词（可选） */
  keywords?: string[];

  /** 分类标签（可选） */
  tags?: string[];
}

declare module '../plugin.js' {
  namespace Plugin {
    interface Contexts {
      skill: SkillFeature;
    }
  }
}

// ============================================================================
// SkillFeature 实现
// ============================================================================

export class SkillFeature extends Feature<Skill> {
  readonly name = 'skill' as const;
  readonly icon = 'Brain';
  readonly desc = '技能';

  /** 按名称索引 */
  readonly byName = new Map<string, Skill>();

  /**
   * 添加 Skill
   */
  add(skill: Skill, pluginName: string): () => void {
    this.byName.set(skill.name, skill);
    return super.add(skill, pluginName);
  }

  /**
   * 移除 Skill
   */
  remove(skill: Skill): boolean {
    this.byName.delete(skill.name);
    return super.remove(skill);
  }

  /**
   * 按名称获取 Skill
   */
  get(name: string): Skill | undefined {
    return this.byName.get(name);
  }

  /**
   * 获取所有已注册 Skill
   */
  getAll(): Skill[] {
    return [...this.items];
  }

  /**
   * 按关键词/标签搜索相关 Skill
   * 返回按相关性排序的 Skill 列表
   */
  search(query: string, options?: { maxResults?: number }): Skill[] {
    const maxResults = options?.maxResults ?? 5;
    const scored = this.items
      .map(skill => ({ skill, score: this.#scoreSkill(skill, query) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults);

    return scored.map(({ skill }) => skill);
  }

  /**
   * 获取所有 Skill 的工具（扁平化）
   */
  collectAllTools(): Tool[] {
    const tools: Tool[] = [];
    for (const skill of this.items) {
      tools.push(...skill.tools);
    }
    return tools;
  }

  /**
   * 已注册 Skill 数量
   */
  get size(): number {
    return this.items.length;
  }

  /**
   * 简单的关键词匹配评分
   */
  #scoreSkill(skill: Skill, query: string): number {
    const lowerQuery = query.toLowerCase();
    let score = 0;

    // 关键词精确匹配
    if (skill.keywords) {
      for (const kw of skill.keywords) {
        if (lowerQuery.includes(kw.toLowerCase())) score += 1.0;
      }
    }

    // 标签匹配
    if (skill.tags) {
      for (const tag of skill.tags) {
        if (lowerQuery.includes(tag.toLowerCase())) score += 0.5;
      }
    }

    // 名称匹配
    if (lowerQuery.includes(skill.name.toLowerCase())) score += 0.3;

    // 描述匹配（双向）
    const lowerDesc = skill.description.toLowerCase();
    if (lowerDesc.includes(lowerQuery)) score += 0.2;
    if (lowerQuery.includes(lowerDesc)) score += 0.15;

    // 工具名/描述匹配
    for (const tool of skill.tools) {
      if (lowerQuery.includes(tool.name.toLowerCase())) score += 0.4;
      if (tool.description && lowerQuery.includes(tool.description.toLowerCase().slice(0, 10))) {
        score += 0.1;
      }
    }

    return score;
  }

  /**
   * 序列化为 JSON
   */
  toJSON(pluginName?: string): FeatureJSON {
    const list = pluginName ? this.getByPlugin(pluginName) : this.items;
    return {
      name: this.name,
      icon: this.icon,
      desc: this.desc,
      count: list.length,
      items: list.map(s => ({
        name: s.name,
        desc: s.description,
        toolCount: s.tools.length,
        keywords: s.keywords,
        tags: s.tags,
      })),
    };
  }
}


