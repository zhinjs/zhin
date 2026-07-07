import type { WorkflowStrategy, WorkflowTaskSpec } from '../../orchestrator/orchestration-types.js';

export const FIVE_AGENT_WORKFLOW_STRATEGY_NAME = 'five-agent';

const FIVE_AGENT_TASKS: Array<Pick<WorkflowTaskSpec, 'key' | 'name' | 'role' | 'dependsOn'>> = [
  { key: 'planner', name: 'Planner: decompose goal', role: 'planner' },
  { key: 'researcher', name: 'Researcher: gather facts', role: 'researcher', dependsOn: ['planner'] },
  { key: 'evaluator', name: 'Evaluator: choose approach', role: 'evaluator', dependsOn: ['researcher'] },
  { key: 'executor', name: 'Executor: implement result', role: 'executor', dependsOn: ['evaluator'] },
  { key: 'reviewer', name: 'Reviewer: verify deliverable', role: 'reviewer', dependsOn: ['executor'] },
];

function taskGoal(role: WorkflowTaskSpec['role'], userGoal: string): string {
  switch (role) {
    case 'planner':
      return `Break down the user goal into a concrete execution plan.\n\nGoal:\n${userGoal}`;
    case 'researcher':
      return `Collect the facts, constraints, and context needed for this goal.\n\nGoal:\n${userGoal}`;
    case 'evaluator':
      return `Evaluate the research and choose the safest implementation approach. Provide a concise decision summary, not raw chain-of-thought.\n\nGoal:\n${userGoal}`;
    case 'executor':
      return `Implement or draft the deliverable according to the evaluated approach.\n\nGoal:\n${userGoal}`;
    case 'reviewer':
      return `Review the executor result against the original user goal and report approval or actionable fixes.\n\nGoal:\n${userGoal}`;
    default:
      return userGoal;
  }
}

export function createFiveAgentWorkflowStrategy(): WorkflowStrategy {
  return {
    name: FIVE_AGENT_WORKFLOW_STRATEGY_NAME,
    plan(input): WorkflowTaskSpec[] {
      return FIVE_AGENT_TASKS.map((task) => ({
        ...task,
        description: taskGoal(task.role, input.goal),
        goal: taskGoal(task.role, input.goal),
        executorKind: 'local',
        context: {
          workflow: FIVE_AGENT_WORKFLOW_STRATEGY_NAME,
          role: task.role,
        },
      }));
    },
  };
}
