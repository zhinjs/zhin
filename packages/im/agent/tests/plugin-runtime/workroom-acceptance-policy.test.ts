import { describe, expect, it } from 'vitest';
import { Scope, rootPluginId } from '@zhin.js/plugin-runtime';
import {
  createGenerationWorkroomAcceptancePolicyPort,
  workroomAcceptancePolicyDecisionToken,
} from '../../src/plugin-runtime/workroom-acceptance-policy.js';
import type {
  WorkroomAcceptanceContractPinInput,
  WorkroomAcceptanceDecisionInput,
  WorkroomAcceptancePolicyDecisionPort,
} from '../../src/workroom/acceptance-policy.js';

describe('generation Workroom acceptance policy', () => {
  it('resolves the policy from the current generation Scope and fails closed when absent', async () => {
    const scope = new Scope(rootPluginId());
    const proxy = createGenerationWorkroomAcceptancePolicyPort(() =>
      scope.has(workroomAcceptancePolicyDecisionToken)
        ? scope.use(workroomAcceptancePolicyDecisionToken)
        : undefined);
    const pinInput = {
      projectId: 'project-1', runId: 'run-1', expectedSequence: 1, now: 100,
      task: { key: 'build', title: 'Build', revision: 1 },
    } satisfies WorkroomAcceptanceContractPinInput;

    await expect(proxy.pinContract(pinInput))
      .rejects.toThrow('Acceptance Policy Decision Port is not installed');

    const policy: WorkroomAcceptancePolicyDecisionPort = {
      pinContract(input) {
        return {
          id: 'contract-1', revision: 1, digest: 'sha256:contract-1',
          taskKey: input.task.key, taskRevision: input.task.revision, kind: 'task_result',
          policy: { id: 'policy-1', revision: 1, digest: 'sha256:policy-1' },
          criteria: [{ id: 'check', kind: 'deterministic', description: 'passes' }],
          requiredEvidence: [],
        };
      },
      decide(_input: WorkroomAcceptanceDecisionInput) {
        throw new Error('not used');
      },
    };
    scope.provide(workroomAcceptancePolicyDecisionToken, policy);

    await expect(proxy.pinContract(pinInput)).resolves.toMatchObject({
      id: 'contract-1', policy: { id: 'policy-1' },
    });
  });
});
