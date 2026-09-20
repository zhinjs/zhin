import { createHash } from 'node:crypto';
import {
  createWorkroomSchedulerPolicySnapshot,
  type WorkroomDefinition,
  type WorkroomMemberRole,
} from '@zhin.js/agent';
import {
  createCapabilityPackManifest,
  createWorkroomDynamicPlanningPolicySnapshot,
  createWorkroomProfileOverlay,
  type WorkroomGenerationAuthoritySnapshot,
} from '@zhin.js/agent/runtime';
import { LOCAL_WORKROOM_RESOURCE_REQUIREMENTS } from './local-portfolio.js';

export function createWorkroomPlanningBootstrapArtifacts(input: Readonly<{
  projectId: string;
  definition: WorkroomDefinition;
  supply: WorkroomGenerationAuthoritySnapshot;
  principalId: string;
  includeTools?: readonly string[];
  includeSkills?: readonly string[];
}>) {
  const select = <T extends { readonly name: string }>(
    values: readonly T[], requested: readonly string[] | undefined, label: string,
  ): readonly T[] => {
    if (requested === undefined) return values;
    const names = new Set(requested);
    for (const name of names) {
      if (!values.some(value => value.name === name)) throw new Error(`${label} ${name} 不在当前 generation`);
    }
    return values.filter(value => names.has(value.name));
  };
  const tools = select(input.supply.tools, input.includeTools, 'Tool');
  const skills = select(input.supply.skills, input.includeSkills, 'Skill');
  const toolIds = tools.map(tool => tool.name).sort();
  const skillIds = skills.map(skill => skill.name).sort();
  const members = [...input.definition.members].sort((left, right) => left.agent.localeCompare(right.agent));
  const seenAgents = new Set<string>();
  for (const member of members) {
    if (seenAgents.has(member.agent)) {
      throw new Error(`成员 ${member.agent} 承担多个角色；每个 Workroom 角色需要独立 Agent binding`);
    }
    seenAgents.add(member.agent);
    if (!input.supply.agents.some(agent => agent.id === member.agent)) {
      throw new Error(`成员 ${member.agent} 没有对应的 ai.agents binding`);
    }
  }
  const workerRoles = [...new Set(members.filter(member => member.role !== 'orchestrator')
    .map(member => member.role))].sort();
  const taskRoles: WorkroomMemberRole[] = workerRoles.length > 0 ? workerRoles : ['orchestrator'];
  const workflowId = `workroom:${input.projectId}:dynamic`;
  const workflowTasks = taskRoles.map((role, index) => ({
    key: `${role}-${index + 1}`,
    role,
    requires: {},
    resourceRequirements: LOCAL_WORKROOM_RESOURCE_REQUIREMENTS,
  }));
  const workflowDigest = digestBootstrapValue({ workflowId, workflowTasks });
  const acceptancePolicy = createWorkroomBootstrapAcceptancePolicy({
    projectId: input.projectId,
    definition: input.definition,
    principalId: input.principalId,
    tasks: workflowTasks,
  });
  const pack = createCapabilityPackManifest({
    id: `workroom:${input.projectId}:bootstrap`,
    version: '1.0.0',
    kind: 'domain',
    tools: tools.map(tool => ({ id: tool.name, digest: tool.digest })),
    skills: skills.map(skill => ({ id: skill.name, digest: skill.digest, requiresTools: [] })),
    agents: members.map(member => {
      const agent = input.supply.agents.find(candidate => candidate.id === member.agent)!;
      return {
        id: agent.id,
        digest: agent.digest,
        role: member.role,
        allowedTools: toolIds,
        allowedSkills: skillIds,
      };
    }),
    workflows: [{
      id: workflowId,
      digest: workflowDigest,
      requiredByProfile: true,
      tasks: workflowTasks,
    }],
    acceptancePolicies: [acceptancePolicy],
  });
  const { digest: _packDigest, ...packInput } = pack;
  const revisionId = `profile:${input.projectId}:bootstrap:1`;
  const overlay = createWorkroomProfileOverlay({
    version: 1,
    projectId: input.projectId,
    revisionId,
    charterRevisionId: `charter:${input.projectId}:bootstrap:1`,
    packs: [pack],
    enabledTools: toolIds,
    enabledSkills: skillIds,
    enabledAgents: members.map(member => member.agent).sort(),
    enabledWorkflows: [workflowId],
    enabledAcceptancePolicies: [acceptancePolicy.id],
  });
  const policy = createWorkroomDynamicPlanningPolicySnapshot({
    revisionId: `planning:${input.projectId}:1`,
    maxTasks: Math.max(4, Math.min(16, taskRoles.length * 4)),
    maxTotalAttempts: Math.max(12, taskRoles.length * 8),
    maxAttemptsPerTask: 3,
    allowOptionalTasks: true,
    approvalRequiredAuthorities: [],
    sponsorGate: { owner: input.principalId, decisionTimeoutMs: 15 * 60_000 },
    schedulerPolicy: createWorkroomSchedulerPolicySnapshot({
      policyRef: `scheduler:${input.projectId}:bootstrap`,
      revision: 1,
      pinnedAtSequence: 1,
      capacity: Math.max(1, Math.min(4, taskRoles.length)),
      agingStepMs: 30_000,
      starvationBoundMs: {
        urgent: 30_000, high: 60_000, normal: 120_000, low: 300_000,
      },
      preemptionDeadlineMs: 30_000,
    }),
    defaultSponsorLane: 'normal',
    defaultTaskDeadlineMs: 60 * 60_000,
    defaultPreemptibility: 'atomic',
  });
  return Object.freeze({
    pack,
    packInput: Object.freeze(packInput),
    overlay,
    policy,
    acceptancePolicy,
    revisionId,
    workflowId,
  });
}

export function createWorkroomBootstrapAcceptancePolicy(input: Readonly<{
  projectId: string;
  definition: WorkroomDefinition;
  principalId: string;
  tasks: readonly Readonly<{ key: string; role: string }>[];
}>) {
  if (!input.definition.sponsors?.includes(input.principalId)) {
    throw new Error(`principal ${input.principalId} 不在 Project sponsors`);
  }
  const reviewers = input.definition.members.filter(member => member.role === 'reviewer');
  if (reviewers.length !== 1) {
    throw new Error('Workroom Acceptance Policy 需要且只能配置一个 reviewer 成员');
  }
  const templates = new Map<string, Readonly<{ key: string; role: string }>>();
  for (const task of input.tasks) {
    const current = templates.get(task.key);
    if (current && current.role !== task.role) {
      throw new Error(`Workroom Task 模板 ${task.key} 的角色不唯一`);
    }
    templates.set(task.key, Object.freeze({ key: task.key, role: task.role }));
  }
  if (templates.size === 0) {
    throw new Error('Workroom Acceptance Policy 缺少 Workflow Task 模板');
  }
  const id = `workroom:${input.projectId}:acceptance`;
  const tasks = [...templates.values()]
    .sort((left, right) => left.key.localeCompare(right.key))
    .map(task => ({
      taskKey: task.key,
      kind: task.role === 'integration' ? 'integration_candidate' as const : 'task_result' as const,
      criteria: [{
        id: 'reviewer-verdict',
        kind: 'judgment' as const,
        description: 'Reviewer verifies the task report, evidence, and governed artifacts against the task objective.',
      }],
      requiredEvidence: [],
      minimumRoute: 'reviewer_required' as const,
      reviewerPrincipalId: reviewers[0]!.agent,
      sponsorPrincipalId: input.principalId,
      reviewerTimeoutMs: 15 * 60_000,
      sponsorTimeoutMs: 15 * 60_000,
    }));
  const body = Object.freeze({
    id,
    tasks,
    memorySchema: Object.freeze({ revision: 1 as const, claimRules: Object.freeze([]) }),
  });
  return Object.freeze({ ...body, digest: digestBootstrapValue(body) });
}

function digestBootstrapValue(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}
