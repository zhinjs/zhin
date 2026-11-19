import { filterTools, type AgentTool } from '@zhin.js/ai';
import type { SkillDescriptor } from '@zhin.js/skill';
import type { ScheduleJobExecutionPlan } from '../assistant/types.js';
import type { ToolCapability } from './capability-ingress.js';
import { capabilityAsAgentTool } from './deferred-capability-plan.js';
import { RESERVED_TOOL_NAMES } from '../reserved-tools.js';

const UNATTENDED_FORBIDDEN_TOOLS = new Set([
  'discover', 'load_tool', 'load_skill', 'ask_user',
]);

export interface ScheduleCapabilityPlan {
  readonly capabilities: readonly ToolCapability[];
  readonly allTools: readonly AgentTool[];
  readonly resolvedTools: readonly AgentTool[];
  readonly skills: readonly SkillDescriptor[];
  readonly resolvedBy: 'execution-plan' | 'affinity';
  readonly missingTools: readonly string[];
  readonly missingSkills: readonly string[];
  /**
   * #1250 b33: `empty_execution_plan`: the job has an execution plan that names no tool and no skill, so
   * the tools were chosen from the prompt instead; `no_tools`: the turn runs without any tool.
   */
  readonly warnings: readonly ScheduleCapabilityWarning[];
}

export type ScheduleCapabilityWarning = 'empty_execution_plan' | 'no_tools';

/** A plan that names neither tools nor skills cannot select anything (#1250 b33). */
export function isEmptyExecutionPlan(plan: Readonly<ScheduleJobExecutionPlan> | undefined): boolean {
  return plan !== undefined && !(plan.tools?.length) && !(plan.skills?.length);
}

/** The built-in schedule tools (`reserved-tools.ts`); a third-party `schedule_meeting` is not one. */
const SCHEDULE_MANAGEMENT_TOOLS: ReadonlySet<string> = new Set(
  RESERVED_TOOL_NAMES.filter((name) => name.startsWith('schedule_')),
);

/**
 * #1250 b55: a `schedule_preview` run gets no `schedule_*` tool. A model that passes a whole
 * request ("remind me at 8 tomorrow to drink water") to the preview would otherwise call
 * `schedule_add` from the unattended preview run, which is refused, and the user is told the job
 * was not created although they allowed it. The preview only tries out what runs when the job is due.
 */
export function isScheduleManagementTool(name: string): boolean {
  return SCHEDULE_MANAGEMENT_TOOLS.has(localName(name));
}


export function createScheduleCapabilityPlan(input: {
  readonly prompt: string;
  readonly executionPlan?: Readonly<ScheduleJobExecutionPlan>;
  readonly tools: readonly ToolCapability[];
  readonly skills: readonly SkillDescriptor[];
  /** A `schedule_preview` run: no `schedule_*` tool is offered, even when the plan names one. */
  readonly preview?: boolean;
}): ScheduleCapabilityPlan {
  const eligible = input.tools.filter((tool) => !UNATTENDED_FORBIDDEN_TOOLS.has(localName(tool.name))
    && !(input.preview && isScheduleManagementTool(tool.name)));
  const allTools = eligible.map(capabilityAsAgentTool);
  // #1250 b33: a plan written without tools or skills (`schedule_add` without `tools`) used to leave the
  // turn with no tool at all; it now falls back to the same prompt-based selection as a job without plan.
  const emptyPlan = isEmptyExecutionPlan(input.executionPlan);
  if (!input.executionPlan || emptyPlan) {
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
      warnings: planWarnings(emptyPlan, resolvedTools.length),
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
    warnings: planWarnings(false, selectedNames.size),
  });
}

function planWarnings(emptyPlan: boolean, tools: number): ScheduleCapabilityWarning[] {
  return [...(emptyPlan ? ['empty_execution_plan' as const] : []), ...(tools === 0 ? ['no_tools' as const] : [])];
}

function selectSkillsByAffinity(skills: readonly SkillDescriptor[], prompt: string): SkillDescriptor[] {
  const pseudo = skills.map((skill): AgentTool => ({
    name: skill.qualifiedName,
    description: [
      skill.description,
      ...(skill.keywords ?? []),
      ...(skill.tags ?? []),
      skill.instructions.slice(0, 500),
    ].join('\n'),
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
  warnings: ScheduleCapabilityWarning[];
}): ScheduleCapabilityPlan {
  return Object.freeze({
    ...plan,
    capabilities: Object.freeze([...plan.capabilities]),
    allTools: Object.freeze([...plan.allTools]),
    resolvedTools: Object.freeze([...plan.resolvedTools]),
    skills: Object.freeze([...plan.skills]),
    missingTools: Object.freeze([...plan.missingTools]),
    missingSkills: Object.freeze([...plan.missingSkills]),
    warnings: Object.freeze([...plan.warnings]),
  });
}
