/**
 * Skill Service Definition
 *
 * Skills 是更高层的能力，通常由多个 Tool 组合而成。
 * 例：GitHub Skill = git tool + GitHub API tool + code analysis tool
 */

import type { SeamProvider, SeamScope } from './seam-provider.js';
import type { SkillMetadata } from '../resource-hub/types.js';

export type { SkillMetadata };

/**
 * Skill 调用请求
 */
export interface SkillInvocationRequest {
  skillId: string;
  input: unknown;
  context?: Record<string, unknown>;
}

/**
 * Skill 调用结果
 */
export interface SkillInvocationResult {
  success: boolean;
  output?: unknown;
  error?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Skill Service Definition
 */
export interface SkillService extends SeamProvider {
  /**
   * 获取该 Service 提供的所有 Skill 元数据
   */
  catalog(scope: SeamScope | 'global'): Promise<SkillMetadata[]>;

  /**
   * 获取指定 Skill 的完整文档
   */
  describe(scope: SeamScope | 'global', skillId: string): Promise<string>;

  /**
   * 调用一个 Skill
   */
  invoke(
    scope: SeamScope | 'global',
    request: SkillInvocationRequest,
  ): Promise<SkillInvocationResult>;

  /**
   * 可选：Skill 是否在该作用域可用
   */
  isAvailable?(scope: SeamScope | 'global', skillId: string): boolean;
}

export type SkillServiceProvider = SkillService;
