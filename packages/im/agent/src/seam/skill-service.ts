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
   * 可选：Skill 是否在该作用域可用
   */
  isAvailable?(scope: SeamScope | 'global', skillId: string): boolean;
}

export type SkillServiceProvider = SkillService;
