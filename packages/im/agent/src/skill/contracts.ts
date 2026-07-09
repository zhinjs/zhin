/**
 * Skill System — 模块契约（与实现同步）。
 *
 * 实现：包装 `SkillRegistry`；`search` 使用 registry TF-IDF 真实 score。
 */

import type { AgentTool } from '@zhin.js/ai';
import type { Message } from '@zhin.js/core';

export interface Skill {
  name: string;
  description: string;
  tools: AgentTool[];
  keywords: string[];
  tags: string[];
  platforms?: string[];
}

export interface SkillSearchResult {
  skill: Skill;
  score: number;
}

export interface SkillSearchOptions {
  maxResults?: number;
  platform?: string;
}

export interface SkillSystemConfig {
  /** 预留扩展面 */
}

export interface TurnContext {
  message: Message;
}
