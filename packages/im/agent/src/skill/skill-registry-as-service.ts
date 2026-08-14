/**
 * Skill Registry 适配为 SkillService
 *
 * 将现有的 SkillRegistry 和约定目录发现逻辑包装为标准的 SkillService，
 * 使其符合统一的能力接缝（Capability Seam）架构。
 */

import type { SeamScope } from '../seam/seam-provider.js';
import type {
  SkillService,
  SkillMetadata,
  SkillInvocationRequest,
  SkillInvocationResult,
} from '../seam/skill-service.js';
import type { SkillRegistry } from '../orchestrator/skill-registry.js';

/**
 * 将 SkillRegistry 适配为 SkillService
 *
 * 用法：
 * ```ts
 * seamIntegration.registerSkillService('global', new SkillRegistryAsService(skillRegistry));
 * ```
 */
export class SkillRegistryAsService implements SkillService {
  readonly id = 'zhin:skills';
  readonly description = 'Zhin skill registry';
  readonly tags = ['skills', 'framework'];

  constructor(private readonly registry: SkillRegistry) {}

  async catalog(_scope: SeamScope | 'global'): Promise<SkillMetadata[]> {
    return this.registry.getAll().map((skill) => ({
      name: skill.name,
      description: skill.description,
      keywords: skill.keywords,
      category: skill.tags?.[0],
    }));
  }

  async describe(_scope: SeamScope | 'global', skillId: string): Promise<string> {
    const skill = this.registry.getByName(skillId);
    if (!skill) throw new Error(`Skill not found: ${skillId}`);
    return skill.description;
  }

  async invoke(
    _scope: SeamScope | 'global',
    request: SkillInvocationRequest,
  ): Promise<SkillInvocationResult> {
    try {
      const skill = this.registry.getByName(request.skillId);
      if (!skill) {
        return { success: false, error: `Skill not found: ${request.skillId}` };
      }
      return { success: true, output: skill };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  isAvailable(_scope: SeamScope | 'global', skillId: string): boolean {
    return this.registry.getByName(skillId) !== undefined;
  }
}
