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
} from '../seam/skill-service.js';
import type { SkillRegistry } from '../resource-hub/skill-registry.js';
import { readFile } from 'node:fs/promises';

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

  async catalog(scope: SeamScope | 'global'): Promise<SkillMetadata[]> {
    const skills = scope === 'global'
      ? this.registry.getAll()
      : this.registry.getForAgent(String(scope));
    return skills.map((skill) => ({
      name: skill.name,
      description: skill.description,
      keywords: skill.keywords,
      category: skill.tags?.[0],
    }));
  }

  async describe(scope: SeamScope | 'global', skillId: string): Promise<string> {
    const skill = this.findSkill(scope, skillId);
    if (!skill) throw new Error(`Skill not found: ${skillId}`);
    if (!skill.filePath) return skill.description;
    try {
      return await readFile(skill.filePath, 'utf8');
    } catch {
      return skill.description;
    }
  }

  isAvailable(scope: SeamScope | 'global', skillId: string): boolean {
    return this.findSkill(scope, skillId) !== undefined;
  }

  private findSkill(scope: SeamScope | 'global', skillId: string) {
    const skills = scope === 'global'
      ? this.registry.getAll()
      : this.registry.getForAgent(String(scope));
    return skills.find((skill) => skill.name === skillId);
  }
}
