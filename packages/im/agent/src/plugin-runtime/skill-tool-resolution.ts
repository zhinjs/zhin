import type { SkillDescriptor } from '@zhin.js/skill';
import type { ToolCapability } from './capability-ingress.js';

/** The descriptor fields skill/tool resolution reads (a full capability or just its descriptor). */
export type SkillToolCandidate = Pick<ToolCapability, 'owner' | 'name' | 'placement' | 'hidden'>;

/** Resolve only the skill owner's declared tools within their existing private placement. */
export function resolveSkillTools(
  skill: SkillDescriptor,
  tools: readonly SkillToolCandidate[],
): string[] {
  const requested = new Set(skill.toolNames ?? []);
  if (requested.size === 0) return [];
  return tools.filter((tool) => tool.owner === skill.owner
    && belongsToSkill(tool, skill) && [...requested].some(
    name => tool.name === name || tool.name.endsWith(`__${name}`),
  )).map((tool) => tool.name);
}

function belongsToSkill(tool: SkillToolCandidate, skill: SkillDescriptor): boolean {
  const placement = tool.placement;
  if (!placement) return !tool.hidden;
  if (placement.kind === 'agent') return placement.agent === skill.agentName;
  if (placement.kind === 'skill') return !skill.agentName && placement.skill === skill.name;
  return placement.agent === skill.agentName && placement.skill === skill.name;
}
