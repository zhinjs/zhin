import { filterTools, type AgentTool } from '@zhin.js/ai';
import type { SkillRegistry } from '../orchestrator/skill-registry.js';
import type { ScheduleJobExecutionPlan } from '../assistant/types.js';

const UNATTENDED_FORBIDDEN_TOOLS = new Set([
  'discover',
  'load_tool',
  'load_skill',
  'ask_user',
  'spawn_task',
]);

export interface ScheduleToolResolverInput {
  prompt: string;
  executionPlan?: ScheduleJobExecutionPlan;
  tools: AgentTool[];
  skillRegistry: SkillRegistry | null;
}

export interface ScheduleToolResolverOutput {
  tools: AgentTool[];
  skills: string[];
  resolvedBy: 'execution-plan' | 'affinity';
  missingTools: string[];
  missingSkills: string[];
}

function eligibleTools(tools: AgentTool[]): AgentTool[] {
  return tools.filter(tool => !UNATTENDED_FORBIDDEN_TOOLS.has(tool.name));
}

export function resolveScheduleTools(input: ScheduleToolResolverInput): ScheduleToolResolverOutput {
  const pool = eligibleTools(input.tools);
  const byName = new Map(pool.map(tool => [tool.name, tool]));
  const plan = input.executionPlan;

  if (plan) {
    const selected: AgentTool[] = [];
    const selectedNames = new Set<string>();
    const missingTools: string[] = [];
    const missingSkills: string[] = [];
    const skills: string[] = [];

    for (const name of plan.tools ?? []) {
      const tool = byName.get(name);
      if (!tool) {
        missingTools.push(name);
      } else if (!selectedNames.has(name)) {
        selected.push(tool);
        selectedNames.add(name);
      }
    }

    for (const name of plan.skills ?? []) {
      const skill = input.skillRegistry?.getByName(name);
      if (!skill) {
        missingSkills.push(name);
        continue;
      }
      skills.push(name);
      for (const skillTool of skill.tools) {
        const tool = byName.get(skillTool.name);
        if (tool && !selectedNames.has(tool.name)) {
          selected.push(tool);
          selectedNames.add(tool.name);
        }
      }
    }

    return {
      tools: selected,
      skills,
      resolvedBy: 'execution-plan',
      missingTools,
      missingSkills,
    };
  }

  const matchedSkills = input.skillRegistry?.searchScored(input.prompt, {
    maxResults: 20,
    minScore: 0.05,
  }).map(result => result.skill.name) ?? [];
  const affinityTools = filterTools(input.prompt, pool, { maxTools: 20, minScore: 0.05 });
  const affinityNames = new Set(affinityTools.map(tool => tool.name));
  for (const skillName of matchedSkills) {
    const skill = input.skillRegistry?.getByName(skillName);
    for (const skillTool of skill?.tools ?? []) {
      const tool = byName.get(skillTool.name);
      if (tool && !affinityNames.has(tool.name) && affinityTools.length < 20) {
        affinityTools.push(tool);
        affinityNames.add(tool.name);
      }
    }
  }

  return {
    tools: affinityTools,
    skills: matchedSkills,
    resolvedBy: 'affinity',
    missingTools: [],
    missingSkills: [],
  };
}

export { UNATTENDED_FORBIDDEN_TOOLS };
