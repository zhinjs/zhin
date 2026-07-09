import type { AgentTool } from '@zhin.js/ai';
import { sharedToolSelection } from '../orchestrator/tool-selection.js';
import type { Skill as OrchestratorSkill } from '../orchestrator/types.js';
import { SkillRegistry } from '../orchestrator/skill-registry.js';
import type {
  Skill,
  SkillSearchOptions,
  SkillSearchResult,
  SkillSystemConfig,
  TurnContext,
} from './contracts.js';

function toBlueprintSkill(skill: OrchestratorSkill): Skill {
  return {
    name: skill.name,
    description: skill.description,
    tools: skill.tools.map((tool) => sharedToolSelection.normalize(tool) as AgentTool),
    keywords: skill.keywords ?? [],
    tags: skill.tags ?? [],
    platforms: skill.platforms,
  };
}

export class SkillSystem {
  private readonly registry: SkillRegistry;

  constructor(
    registry?: SkillRegistry,
    private readonly _config: SkillSystemConfig = {},
  ) {
    this.registry = registry ?? new SkillRegistry();
  }

  getRegistry(): SkillRegistry {
    return this.registry;
  }

  addSkill(skill: OrchestratorSkill, scope?: import('../orchestrator/types.js').ResourceScope, source?: string): () => void {
    return this.registry.add(skill, scope, source);
  }

  search(query: string, options?: SkillSearchOptions): SkillSearchResult[] {
    const maxResults = options?.maxResults ?? 5;
    const scored = this.registry.searchScored(query, {
      maxResults,
      platform: options?.platform,
    });
    return scored.map(({ skill, score }) => ({
      skill: toBlueprintSkill(skill),
      score,
    }));
  }

  collectTools(context: TurnContext, agentId?: string): AgentTool[] {
    const tools = this.registry.collectAllTools(agentId);
    return tools.map((tool) => sharedToolSelection.normalize(tool, context.message));
  }

  getAlwaysSkills(agentId?: string): OrchestratorSkill[] {
    if (typeof this.registry.getAlwaysSkills !== 'function') return [];
    return this.registry.getAlwaysSkills(agentId);
  }
}

export function createSkillSystem(registry?: SkillRegistry): SkillSystem {
  return new SkillSystem(registry);
}

export const defaultSkillSystem = new SkillSystem();
