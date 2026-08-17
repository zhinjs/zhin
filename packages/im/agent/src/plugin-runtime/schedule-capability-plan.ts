import { filterTools, type AgentTool } from '@zhin.js/ai';
import type { SkillDescriptor } from '@zhin.js/skill';
import type { ScheduleJobExecutionPlan } from '../assistant/types.js';
import type { ToolCapability } from './capability-ingress.js';
import { capabilityAsAgentTool } from './deferred-capability-plan.js';

const UNATTENDED_FORBIDDEN_TOOLS = new Set([
  'discover', 'load_tool', 'load_skill', 'ask_user', 'spawn_task',
]);

export interface ScheduleCapabilityPlan {
  readonly capabilities: readonly ToolCapability[];
  readonly allTools: readonly AgentTool[];
  readonly resolvedTools: readonly AgentTool[];
  readonly skills: readonly SkillDescriptor[];
  readonly resolvedBy: 'execution-plan' | 'affinity';
  readonly missingTools: readonly string[];
  readonly missingSkills: readonly string[];
}

export function createScheduleCapabilityPlan(input: {
  readonly prompt: string;
  readonly executionPlan?: Readonly<ScheduleJobExecutionPlan>;
  readonly tools: readonly ToolCapability[];
  readonly skills: readonly SkillDescriptor[];
}): ScheduleCapabilityPlan {
  const eligible = input.tools.filter((tool) => !UNATTENDED_FORBIDDEN_TOOLS.has(localName(tool.name)));
  const allTools = eligible.map(capabilityAsAgentTool);
  if (!input.executionPlan) {
    const resolvedTools = filterTools(input.prompt, [...allTools], { maxTools: 20, minScore: 0.05 });
    const selectedNames = new Set(resolvedTools.map((tool) => tool.name));
    const skills = selectSkillsByAffinity(input.skills, input.prompt);
    return freezePlan({
      capabilities: eligible.filter((tool) => selectedNames.has(tool.name)),
      allTools,
      resolvedTools,
      skills,
      resolvedBy: 'affinity',
      missingTools: [],
      missingSkills: [],
    });
  }

  const byToolName = new Map(eligible.map((tool) => [tool.name, tool]));
  const bySkillName = new Map<string, SkillDescriptor>();
  for (const skill of input.skills) {
    bySkillName.set(skill.name, skill);
    bySkillName.set(skill.qualifiedName, skill);
  }
  const missingTools: string[] = [];
  const missingSkills: string[] = [];
  const capabilities: ToolCapability[] = [];
  const skills: SkillDescriptor[] = [];
  const seenTools = new Set<string>();
  const seenSkills = new Set<string>();
  for (const name of input.executionPlan.tools ?? []) {
    const tool = byToolName.get(name);
    if (!tool) missingTools.push(name);
    else if (!seenTools.has(tool.name)) {
      seenTools.add(tool.name);
      capabilities.push(tool);
    }
  }
  for (const name of input.executionPlan.skills ?? []) {
    const skill = bySkillName.get(name);
    if (!skill) missingSkills.push(name);
    else if (!seenSkills.has(skill.qualifiedName)) {
      seenSkills.add(skill.qualifiedName);
      skills.push(skill);
    }
  }
  const selectedNames = new Set(capabilities.map((tool) => tool.name));
  return freezePlan({
    capabilities,
    allTools,
    resolvedTools: allTools.filter((tool) => selectedNames.has(tool.name)),
    skills,
    resolvedBy: 'execution-plan',
    missingTools,
    missingSkills,
  });
}

function selectSkillsByAffinity(skills: readonly SkillDescriptor[], prompt: string): SkillDescriptor[] {
  const pseudo = skills.map((skill): AgentTool => ({
    name: skill.qualifiedName,
    description: `${skill.description}\n${skill.instructions.slice(0, 500)}`,
    parameters: { type: 'object', properties: {} },
    execute: async () => undefined,
  }));
  const selected = new Set(filterTools(prompt, pseudo, { maxTools: 20, minScore: 0.05 }).map((item) => item.name));
  return skills.filter((skill) => selected.has(skill.qualifiedName));
}

function localName(name: string): string {
  return name.split('__').at(-1) ?? name;
}

function freezePlan(plan: {
  capabilities: ToolCapability[];
  allTools: AgentTool[];
  resolvedTools: AgentTool[];
  skills: SkillDescriptor[];
  resolvedBy: 'execution-plan' | 'affinity';
  missingTools: string[];
  missingSkills: string[];
}): ScheduleCapabilityPlan {
  return Object.freeze({
    ...plan,
    capabilities: Object.freeze([...plan.capabilities]),
    allTools: Object.freeze([...plan.allTools]),
    resolvedTools: Object.freeze([...plan.resolvedTools]),
    skills: Object.freeze([...plan.skills]),
    missingTools: Object.freeze([...plan.missingTools]),
    missingSkills: Object.freeze([...plan.missingSkills]),
  });
}
