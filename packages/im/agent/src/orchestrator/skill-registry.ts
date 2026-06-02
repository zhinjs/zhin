/**
 * SkillRegistry — AI skill management with common/specialized support.
 *
 * Absorbs: core/built/skill.ts (SkillFeature, search scoring)
 */

import { ResourceRegistry } from './resource-registry.js';
import type { ResourceScope, Skill, Tool } from './types.js';

export class SkillRegistry extends ResourceRegistry<Skill> {
  private readonly byName = new Map<string, Skill>();

  override add(skill: Skill, scope?: ResourceScope, source?: string): () => void {
    this.byName.set(skill.name, skill);
    return super.add(skill, scope, source);
  }

  override remove(name: string, scope?: ResourceScope): boolean {
    this.byName.delete(name);
    return super.remove(name, scope);
  }

  getByName(name: string): Skill | undefined {
    return this.byName.get(name);
  }

  search(query: string, options?: { maxResults?: number; platform?: string; agentId?: string }): Skill[] {
    const maxResults = options?.maxResults ?? 5;
    const platform = options?.platform;
    const pool = options?.agentId ? this.getForAgent(options.agentId) : this.getAll();

    const scored = pool
      .filter(skill => {
        if (platform && skill.platforms?.length) return skill.platforms.includes(platform);
        return true;
      })
      .map(skill => ({ skill, score: this.scoreSkill(skill, query) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults);

    return scored.map(({ skill }) => skill);
  }

  collectAllTools(agentId?: string): Tool[] {
    const pool = agentId ? this.getForAgent(agentId) : this.getAll();
    const tools: Tool[] = [];
    for (const skill of pool) tools.push(...skill.tools);
    return tools;
  }

  getAlwaysSkills(agentId?: string): Skill[] {
    const pool = agentId ? this.getForAgent(agentId) : this.getAll();
    return pool.filter(s => s.always);
  }

  override dispose(): void {
    this.byName.clear();
    super.dispose();
  }

  private scoreSkill(skill: Skill, query: string): number {
    const lq = query.toLowerCase();
    let score = 0;

    if (skill.keywords) {
      for (const kw of skill.keywords) {
        if (lq.includes(kw.toLowerCase())) score += 1.0;
      }
    }
    if (skill.tags) {
      for (const tag of skill.tags) {
        if (lq.includes(tag.toLowerCase())) score += 0.5;
      }
    }
    if (lq.includes(skill.name.toLowerCase())) score += 0.3;

    const ld = skill.description.toLowerCase();
    if (ld.includes(lq)) score += 0.2;
    if (lq.includes(ld)) score += 0.15;

    for (const tool of skill.tools) {
      if (lq.includes(tool.name.toLowerCase())) score += 0.4;
      if (tool.description && lq.includes(tool.description.toLowerCase().slice(0, 10))) score += 0.1;
    }

    return score;
  }
}
