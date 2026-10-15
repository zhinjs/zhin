import { createToken } from '@zhin.js/plugin-runtime';
import type {
  HumanIngressPlanningInput,
  HumanIngressPlanningPort,
} from '../workroom/human-ingress-orchestrator.js';
import type { WorkflowPlanProposal } from '../workroom/workflow-plan-builder.js';

export const workroomHumanIngressPlanningToken = createToken<HumanIngressPlanningPort>(
  'zhin.agent.workroom-human-ingress-planning',
  'Generation-owned governed dynamic Workroom DAG planning provider',
);

export function createGenerationHumanIngressPlanningPort(
  resolve: () => HumanIngressPlanningPort | undefined,
): HumanIngressPlanningPort {
  return Object.freeze({
    async propose(input: HumanIngressPlanningInput): Promise<WorkflowPlanProposal> {
      const current = resolve();
      if (!current) throw new Error('Governed dynamic Workroom planning provider is not installed');
      return await current.propose(input);
    },
  });
}
