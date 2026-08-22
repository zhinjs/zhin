import { createToken } from '@zhin.js/plugin-runtime';
import type { WorkroomAcceptancePolicyDecisionPort } from '../workroom/acceptance-policy.js';

export const workroomAcceptancePolicyDecisionToken =
  createToken<WorkroomAcceptancePolicyDecisionPort>(
    'zhin.agent.workroom-acceptance-policy',
    'Generation-owned Workroom Acceptance Contract and policy decision provider',
  );

export function createGenerationWorkroomAcceptancePolicyPort(
  resolve: () => WorkroomAcceptancePolicyDecisionPort | undefined,
): WorkroomAcceptancePolicyDecisionPort {
  const requirePolicy = (): WorkroomAcceptancePolicyDecisionPort => {
    const policy = resolve();
    if (!policy) throw new Error('Acceptance Policy Decision Port is not installed');
    return policy;
  };
  const port: WorkroomAcceptancePolicyDecisionPort = {
    async pinContract(input) {
      return await requirePolicy().pinContract(input);
    },
    async decide(input) {
      return await requirePolicy().decide(input);
    },
  };
  return Object.freeze(port);
}
