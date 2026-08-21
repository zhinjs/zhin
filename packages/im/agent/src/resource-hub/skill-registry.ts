/**
 * SkillRegistry — AI skill management with common/specialized support.
 *
 * Absorbs: core/built/skill.ts (SkillFeature, search scoring)
 */

import {
  buildDocumentFrequency,
  collectSkillWeightedTerms,
  collectTermSet,
  createIdfFn,
  scoreWeightedTfidfOverlap,
} from '@zhin.js/ai';
import { ResourceRegistry } from './resource-registry.js';
import type { ResourceScope, Skill, Tool } from './types.js';

export interface SkillSearchScoredResult {
  skill: Skill;
  score: number;
}

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

  searchScored(
    query: string,
    options?: { maxResults?: number; platform?: string; agentId?: string; minScore?: number },
  ): SkillSearchScoredResult[] {
    const maxResults = options?.maxResults ?? 5;
    const minScore = options?.minScore ?? 0.1;
    const platform = options?.platform;
    const pool = options?.agentId ? this.getForAgent(options.agentId) : this.getAll();

    const filtered = pool.filter(skill => {
      if (platform && skill.platforms?.length) return skill.platforms.includes(platform);
      return true;
    });
    if (filtered.length === 0) return [];

    const weightedBySkill = new Map<Skill, Map<string, number>>();
    const corpusSets: Set<string>[] = [];
    for (const skill of filtered) {
      const weighted = collectSkillWeightedTerms(skill);
      weightedBySkill.set(skill, weighted);
      corpusSets.push(collectTermSet(weighted));
    }

    const df = buildDocumentFrequency(corpusSets);
    const idf = createIdfFn(filtered.length, df);

    const scored = filtered
      .map(skill => ({
        skill,
        score: scoreWeightedTfidfOverlap(query, weightedBySkill.get(skill)!, idf),
      }))
      .filter(({ score }) => score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults);

    return scored;
  }

  search(query: string, options?: { maxResults?: number; platform?: string; agentId?: string }): Skill[] {
    return this.searchScored(query, options).map(({ skill }) => skill);
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
}
