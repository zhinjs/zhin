import { digestCanonicalWorkroomValue as digest } from './canonical-value.js';
import {
  WorkflowPlanBuilder, type WorkflowPlanProposal, type WorkflowPlanProposalMetadata,
  type WorkflowPlanTaskSchedulerInput, type WorkflowTaskCapabilityRequirement,
} from './workflow-plan-builder.js';

export type SoftwareDeliveryStage = 'requirements' | 'design' | 'implement' | 'test' | 'review' | 'release' | 'health';

export interface SoftwareDeliveryPlanInput {
  readonly metadata: Omit<WorkflowPlanProposalMetadata, 'strategy' | 'parameterDigest'>;
  readonly request: Readonly<{ ref: string; digest: string }>;
  readonly acceptanceCriteria: readonly Readonly<{ ref: string; digest: string }>[];
  readonly repositoryId: string;
  readonly environment: string;
  readonly stages: Readonly<Record<SoftwareDeliveryStage, Readonly<{
    role: string;
    requires: WorkflowTaskCapabilityRequirement;
    maxAttempts: number;
  }>>>;
  readonly scheduler: Omit<WorkflowPlanTaskSchedulerInput, 'localRank' | 'preemptibility'>;
  readonly sponsor: Readonly<{ principalId: string; decisionTimeoutMs: number }>;
}

/**
 * Pure, bounded reference strategy. This creates only a proposal. Admission,
 * capability assignment, evidence acceptance and release authorization remain
 * existing Kernel/Effect authorities. A plan gate does not authorize a deploy.
 */
export function createSoftwareDeliveryPlan(input: SoftwareDeliveryPlanInput): WorkflowPlanProposal {
  const stages: readonly SoftwareDeliveryStage[] = ['requirements', 'design', 'implement', 'test', 'review', 'release', 'health'];
  reference(input.request);
  if (!input.acceptanceCriteria.length) throw new Error('Software delivery requires acceptance criteria');
  for (const criterion of input.acceptanceCriteria) reference(criterion);
  if (new Set(input.acceptanceCriteria.map(item => item.ref)).size !== input.acceptanceCriteria.length) {
    throw new Error('Software delivery acceptance criteria must have unique refs');
  }
  for (const value of [input.repositoryId, input.environment, input.sponsor.principalId]) {
    if (typeof value !== 'string' || !value.trim() || value.trim() !== value) throw new Error('Software delivery scope is invalid');
  }
  if (input.stages.implement.role === input.stages.review.role) {
    throw new Error('Software delivery requires separate implementation and review roles');
  }
  const parameters = {
    request: input.request,
    acceptanceCriteria: [...input.acceptanceCriteria].sort((a, b) => a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0),
    repositoryId: input.repositoryId, environment: input.environment,
  };
  let builder = WorkflowPlanBuilder.create({
    ...input.metadata,
    strategy: { id: 'software-delivery', version: '1.0.0', digest: digest({ version: 1, stages }) },
    parameterDigest: digest(parameters),
  });
  for (const [index, stage] of stages.entries()) {
    const binding = input.stages[stage];
    if (!binding) throw new Error(`Software delivery stage ${stage} is missing`);
    builder = builder.addTask({
      key: stage, title: `Software delivery: ${stage}`, role: binding.role,
      required: true, maxAttempts: binding.maxAttempts,
      dependsOn: index ? [stages[index - 1]!] : [], requires: binding.requires,
      scheduler: { ...input.scheduler, localRank: index, preemptibility: 'atomic' },
      ...(stage === 'release' ? { approvalGate: {
        id: 'approval:release', kind: 'sponsor' as const, owner: input.sponsor.principalId,
        decisionTimeoutMs: input.sponsor.decisionTimeoutMs,
        deadline: Math.min(input.scheduler.deadline, input.scheduler.enqueuedAt + input.sponsor.decisionTimeoutMs),
        policyRevisionId: input.metadata.authority.planningPolicyRevisionId,
        policyDigest: input.metadata.authority.planningPolicyDigest,
      } } : {}),
    });
  }
  return builder.build();
}

function reference(value: Readonly<{ ref: string; digest: string }>): void {
  if (!value || typeof value.ref !== 'string' || !value.ref.trim() || value.ref !== value.ref.trim()
    || !/^sha256:[a-f0-9]{64}$/u.test(value.digest)) throw new Error('Software delivery requires immutable evidence references');
}
