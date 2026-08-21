import {
  deepFreezeWorkroomValue as deepFreeze,
  digestCanonicalWorkroomValue,
} from './canonical-value.js';
import type {
  HumanIngressApplicationDecision,
  HumanIngressApplicationRequest,
  HumanIngressOrchestratorProposalPort,
} from './human-ingress-application.js';
import type { CanonicalHumanIngressSource, HumanIngressSourceReaderPort } from './human-ingress-source-reader.js';
import type { HumanIngressProposal } from './human-ingress.js';
import type { WorkroomKernel, WorkroomPlanAdmissionReceipt } from './workroom-kernel.js';
import { assertWorkflowPlanProposal, type WorkflowPlanProposal } from './workflow-plan-builder.js';
import {
  WorkroomPlanGateUnauthorizedError,
  type WorkroomPlanGateDecision,
} from './plan-approval-control.js';

export interface HumanIngressProjectAuthoritySnapshot {
  readonly orchestratorAgentDefinitionId: string;
  readonly projectRevision: string;
  readonly projectDigest: string;
  readonly orchestratorAuthorityDigest: string;
}

export interface HumanIngressPlanningInput {
  readonly version: 1;
  readonly operationId: string;
  readonly projectId: string;
  readonly projectRevision: string;
  readonly projectDigest: string;
  readonly orchestratorAgentDefinitionId: string;
  readonly orchestratorAuthorityDigest: string;
  readonly principalId: string;
  readonly source: CanonicalHumanIngressSource;
}

export interface HumanIngressPlanningPort {
  propose(input: HumanIngressPlanningInput): WorkflowPlanProposal | Promise<WorkflowPlanProposal>;
}

/** Typed fail-closed planning outcome persisted by HumanIngressApplication. */
export class WorkroomPlanningClarificationError extends Error {
  constructor(
    readonly reason: Extract<
    HumanIngressApplicationDecision,
    { status: 'clarification_required' }
    >['reason'] & ('planning_unavailable' | 'planning_disclosure_unavailable'),
  ) {
    super(`Workroom planning requires clarification: ${reason}`);
    this.name = 'WorkroomPlanningClarificationError';
  }
}

export interface HumanIngressDiscussionProposalInput extends HumanIngressPlanningInput {
  readonly authority: 'non_authoritative';
  readonly text: string;
}

export interface HumanIngressDiscussionProposalPort {
  propose(input: HumanIngressDiscussionProposalInput): Promise<Readonly<{
    receiptRef: string;
    receiptDigest: string;
  }>> | Readonly<{ receiptRef: string; receiptDigest: string }>;
}

export interface HumanIngressTypedControlInput extends HumanIngressPlanningInput {
  readonly authorityRequirement: 'workroom_control' | 'typed_sponsor_control';
  readonly text: string;
}

export type HumanIngressTypedControlDecision =
  | Readonly<{ status: 'authorized'; receiptRef: string; receiptDigest: string }>
  | Readonly<{
      status: 'clarification_required';
      reason: 'missing_control_target' | 'unauthorized_control' | 'stale_target';
      candidateRefs: readonly string[];
    }>;

export interface HumanIngressTypedControlPort {
  apply(input: HumanIngressTypedControlInput): HumanIngressTypedControlDecision | Promise<HumanIngressTypedControlDecision>;
}

export interface ProductionHumanIngressOrchestratorPortOptions {
  readonly sources: HumanIngressSourceReaderPort;
  readonly kernel: WorkroomKernel;
  readonly resolveProject: (
    projectId: string,
  ) => HumanIngressProjectAuthoritySnapshot | null | Promise<HumanIngressProjectAuthoritySnapshot | null>;
  readonly authorizeProjectSource: (input: Readonly<{
    projectId: string;
    proposal: HumanIngressProposal;
    source: CanonicalHumanIngressSource;
  }>) => boolean | Promise<boolean>;
  readonly planning?: HumanIngressPlanningPort;
  readonly discussions?: HumanIngressDiscussionProposalPort;
  readonly controls?: HumanIngressTypedControlPort;
  /** Kernel-owned post-admission writer; never exposed to the planner/model. */
  readonly afterPlanAdmission?: (input: Readonly<{
    operationId: string;
    projectId: string;
    plan: WorkflowPlanProposal;
    receipt: WorkroomPlanAdmissionReceipt;
  }>) => void | Promise<void>;
}

/**
 * Production proposal boundary: resolve immutable source + current Catalog
 * authority, then route to a typed proposal/authority port. It never exposes a
 * generic Kernel command to a model.
 */
export class ProductionHumanIngressOrchestratorPort
implements HumanIngressOrchestratorProposalPort {
  constructor(readonly options: ProductionHumanIngressOrchestratorPortOptions) {}

  async apply(request: HumanIngressApplicationRequest): Promise<HumanIngressApplicationDecision> {
    if (request.operationId !== request.identity.operationId
      || request.proposal.projectId !== request.identity.projectId
      || request.proposal.digest !== request.identity.proposalDigest
      || request.proposal.intent !== request.kind) {
      throw new Error('Human ingress Orchestrator request identity is inconsistent');
    }
    const authority = await this.options.resolveProject(request.identity.projectId);
    if (!authority) throw new Error('Human ingress Project is absent from the active Workroom Catalog');
    const proposedAgent = request.proposal.kind === 'project_inbox'
      ? request.proposal.target.agentDefinitionId
      : undefined;
    if (request.proposal.kind === 'project_inbox'
      && (!proposedAgent || proposedAgent !== authority.orchestratorAgentDefinitionId)) {
      throw new Error('Human ingress Orchestrator binding does not match the active Workroom Catalog');
    }
    const source = await this.options.sources.read(request.proposal.sourceEvent);
    if (source.conversationKey !== request.proposal.sourceEvent.conversationKey
      || source.event.type !== 'message.created'
      || source.event.message.actor?.id !== request.proposal.principal.subjectId) {
      throw new Error('Human ingress source does not match the proposed Project principal scope');
    }
    if (!await this.options.authorizeProjectSource(deepFreeze({
      projectId: request.identity.projectId,
      proposal: request.proposal,
      source,
    }))) {
      throw new Error('Human ingress source is not authorized by the exact Project binding');
    }
    const common = deepFreeze<HumanIngressPlanningInput>({
      version: 1,
      operationId: request.operationId,
      projectId: request.identity.projectId,
      projectRevision: authority.projectRevision,
      projectDigest: authority.projectDigest,
      orchestratorAgentDefinitionId: authority.orchestratorAgentDefinitionId,
      orchestratorAuthorityDigest: authority.orchestratorAuthorityDigest,
      principalId: request.proposal.principal.principalId,
      source,
    });
    if (request.kind === 'discussion') {
      const receipt = await (this.options.discussions ?? createContentFreeDiscussionProposalPort()).propose(deepFreeze({
        ...common,
        authority: 'non_authoritative' as const,
        text: source.text,
      }));
      validateReceipt(receipt);
      return applied(request, 'discussion_recorded', receipt);
    }
    if (request.kind === 'control') {
      if (!this.options.controls) return clarification(request, 'unauthorized_control');
      if (request.proposal.authorityRequirement === 'none') {
        throw new Error('Human ingress control lacks a typed authority requirement');
      }
      const decision = await this.options.controls.apply(deepFreeze({
        ...common,
        authorityRequirement: request.proposal.authorityRequirement,
        text: source.text,
      }));
      if (decision.status === 'clarification_required') {
        return clarification(request, decision.reason, decision.candidateRefs);
      }
      validateReceipt(decision);
      return applied(request, 'control_proposal_submitted', decision);
    }
    if (!/^\/(?:work|task)(?:\s|$)/iu.test(source.text)) {
      return clarification(request, 'missing_work_scope');
    }
    const title = source.text.replace(/^\/(?:work|task)(?:\s+|$)/iu, '').trim();
    if (!title) return clarification(request, 'missing_work_scope');
    if (!this.options.planning) return clarification(request, 'planning_unavailable');
    let plan: WorkflowPlanProposal;
    try {
      plan = await this.options.planning.propose(common);
    } catch (error) {
      if (error instanceof WorkroomPlanningClarificationError) {
        return clarification(request, error.reason);
      }
      throw error;
    }
    assertWorkflowPlanProposal(plan);
    if (plan.projectId !== request.identity.projectId
      || plan.proposalId !== request.operationId
      || plan.parameterDigest !== source.digest
      || plan.authority.projectRevision !== authority.projectRevision
      || plan.authority.projectDigest !== authority.projectDigest
      || plan.authority.orchestratorAgentDefinitionId !== authority.orchestratorAgentDefinitionId
      || plan.authority.orchestratorAuthorityDigest !== authority.orchestratorAuthorityDigest) {
      throw new Error('Human ingress planner returned a Plan outside the exact operation/source scope');
    }
    const receipt = await this.options.kernel.admitWorkflowPlan({
      operationId: request.operationId,
      projectId: request.identity.projectId,
      title,
      sourceEventRef: source.ref,
      sourceEventDigest: source.digest,
      orchestratorAgentDefinitionId: authority.orchestratorAgentDefinitionId,
      plan,
    });
    await this.options.afterPlanAdmission?.({
      operationId: request.operationId,
      projectId: request.identity.projectId,
      plan,
      receipt,
    });
    return applied(request, 'plan_proposal_submitted', receipt);
  }
}

/** Content-free receipt; durable application journal owns exact replay state. */
export function createContentFreeDiscussionProposalPort(): HumanIngressDiscussionProposalPort {
  return Object.freeze({
    propose(input: HumanIngressDiscussionProposalInput) {
      const receiptRef = `workroom-discussion:${encodeURIComponent(input.operationId)}`;
      return Object.freeze({
        receiptRef,
        receiptDigest: digestCanonicalWorkroomValue({
          version: 1,
          kind: 'non_authoritative_discussion_proposal',
          operationId: input.operationId,
          projectId: input.projectId,
          sourceDigest: input.source.digest,
        }),
      });
    },
  });
}

/** Strict human control grammar; all mutable scope is re-read from Kernel facts. */
export function createPlanGateHumanIngressControlPort(
  kernel: WorkroomKernel,
): HumanIngressTypedControlPort {
  return Object.freeze({
    async apply(input: HumanIngressTypedControlInput): Promise<HumanIngressTypedControlDecision> {
      const match = /^\/control\s+plan-gate\s+(approve|reject|request-changes|cancel)\s+(\S+)\s+(\S+)\s+(\S+)(?:\s+(.+))?$/iu
        .exec(input.text.trim());
      if (!match) {
        return Object.freeze({
          status: 'clarification_required',
          reason: 'missing_control_target',
          candidateRefs: Object.freeze([]),
        });
      }
      const [, rawDecision, runId, taskKey, gateId, reason] = match;
      const state = await kernel.read(input.projectId, runId!);
      const task = state.tasks[taskKey!];
      if (!task || !task.blockers.some(blocker => blocker.id === gateId && blocker.kind === 'approval')) {
        return Object.freeze({
          status: 'clarification_required',
          reason: 'stale_target',
          candidateRefs: Object.freeze([]),
        });
      }
      const decision = rawDecision === 'request-changes'
        ? 'request_changes' as const
        : rawDecision as WorkroomPlanGateDecision;
      let receipt;
      try {
        receipt = await kernel.decidePlanApprovalGate({
          operationId: input.operationId,
          projectId: input.projectId,
          runId: runId!,
          taskKey: taskKey!,
          taskRevision: task.revision,
          gateId: gateId!,
          expectedSequence: state.sequence,
          decision,
          reason: reason?.trim() || `Sponsor Plan Gate ${decision}`,
          sponsorPrincipalId: input.principalId,
          sponsorAuthorityRef: `human-ingress:${input.source.digest}`,
        });
      } catch (error) {
        if (error instanceof WorkroomPlanGateUnauthorizedError) {
          return Object.freeze({
            status: 'clarification_required',
            reason: 'unauthorized_control',
            candidateRefs: Object.freeze([]),
          });
        }
        throw error;
      }
      return Object.freeze({
        status: 'authorized',
        receiptRef: receipt.receiptRef,
        receiptDigest: receipt.receiptDigest,
      });
    },
  });
}

function applied(
  request: HumanIngressApplicationRequest,
  kind: Extract<HumanIngressApplicationDecision, { status: 'applied' }>['kind'],
  receipt: Readonly<{ receiptRef: string; receiptDigest: string }>,
): HumanIngressApplicationDecision {
  return deepFreeze({ ...request.identity, status: 'applied', kind, ...receipt });
}

function clarification(
  request: HumanIngressApplicationRequest,
  reason: Extract<HumanIngressApplicationDecision, { status: 'clarification_required' }>['reason'],
  candidateRefs: readonly string[] = [],
): HumanIngressApplicationDecision {
  return deepFreeze({
    ...request.identity,
    status: 'clarification_required',
    reason,
    candidateRefs: [...new Set(candidateRefs)].sort(),
  });
}

function validateReceipt(value: Readonly<{ receiptRef: string; receiptDigest: string }>): void {
  if (!value || typeof value.receiptRef !== 'string' || !value.receiptRef.trim()
    || !/^sha256:[a-f0-9]{64}$/u.test(value.receiptDigest)) {
    throw new Error('Human ingress typed proposal receipt is invalid');
  }
}
