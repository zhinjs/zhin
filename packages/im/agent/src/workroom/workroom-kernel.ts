import { randomUUID } from 'node:crypto';
import type {
  WorkroomCommand,
  WorkroomEventDraft,
  WorkroomEventType,
  WorkroomRunState,
  WorkroomRunStatus,
} from './kernel-contracts.js';
import { WorkroomSequenceConflictError, type WorkroomJournal } from './journal.js';
import {
  assertAssignmentExecutionEnvelope,
  validateAssignmentExecutionObservation,
  type AssignmentExecutionEnvelope,
  type AssignmentExecutionObservation,
} from './assignment-executor.js';
import {
  compareCanonicalWorkroomText,
  canonicalWorkroomJson,
  digestCanonicalWorkroomValue,
} from './canonical-value.js';
import {
  assertWorkflowPlanProposal,
  type WorkflowPlanProposal,
  type WorkflowPlanTaskProposal,
} from './workflow-plan-builder.js';
import {
  assertWorkflowPlanRevisionCandidate,
  computeWorkflowPlanRevisionDiff,
  type WorkflowPlanRevisionCandidate,
  type WorkflowPlanRevisionDiff,
} from './plan-revision.js';
import {
  createAcceptanceDecisionInput,
  createAcceptanceContractPinInput,
  assertAcceptanceContract,
  freezeAcceptanceContract,
  decideTaskAcceptance,
  type WorkroomAcceptancePolicyDecisionPort,
} from './acceptance-policy.js';
import { decideWorkroom, replayWorkroom } from './kernel-state.js';
import {
  decideReviewerClaim,
  decideReviewerVerdict,
  decideSponsorGate,
  type ReviewerVerdict,
  type WorkroomAcceptanceAuthorityPort,
  type WorkroomAcceptanceAuthorizationDecision,
  type WorkroomAcceptanceAuthorizationInput,
  type WorkroomSponsorDecision,
} from './acceptance-control.js';
import {
  materializeWorkroomRemoteAssignment,
  normalizeWorkroomRemoteAssignmentClaimRequest,
  parseWorkroomRemoteAssignmentIssuance,
  workroomRemoteAssignmentId,
  workroomRemoteAssignmentRequestDigest,
  type WorkroomRemoteAssignmentAuthorityPort,
  type WorkroomRemoteAssignmentClaimRequest,
  type WorkroomRemoteAssignmentIssuance,
} from './remote-assignment-issuance.js';
import {
  materializeWorkroomLocalAssignment,
  normalizeWorkroomLocalAssignmentClaimRequest,
  parseWorkroomLocalAssignmentIssuance,
  workroomLocalAssignmentId,
  workroomLocalAssignmentRequestDigest,
  type WorkroomLocalAssignmentAuthorityPort,
  type WorkroomLocalAssignmentClaimRequest,
  type WorkroomLocalAssignmentIssuance,
} from './local-assignment-issuance.js';
import {
  decideWorkroomSchedule,
  getWorkroomScheduledTaskSnapshot,
  parseWorkroomPriorityChangeProposal,
  type WorkroomPriorityChangeProposal,
  type WorkroomScheduleDecision,
} from './workroom-scheduler.js';
import {
  decideWorkroomPreemptionTimeout,
  replayWorkroomPreemptions,
} from './workroom-preemption.js';
import {
  WorkroomPriorityUnauthorizedError,
  type WorkroomPriorityAuthorityPort,
  type WorkroomPriorityAuthorizationInput,
} from './scheduler-priority-control.js';
import {
  WorkroomPlanGateUnauthorizedError,
  type WorkroomPlanGateAuthorityPort,
  type WorkroomPlanGateAuthorizationInput,
  type WorkroomPlanGateDecisionInput,
  type WorkroomPlanGateDecisionReceipt,
} from './plan-approval-control.js';
import {
  WorkroomRunControlUnauthorizedError,
  assertWorkroomRunControlCommand,
  workroomRunControlRequestDigest,
  type WorkroomRunControlAuthorityPort,
  type WorkroomRunControlCommand,
  type WorkroomRunControlReceipt,
} from './workroom-run-control.js';
export interface CreateWorkroomRunInput {
  readonly runId?: string;
  readonly projectId: string;
  readonly title: string;
}

export interface WorkroomKernelOptions {
  readonly journal: WorkroomJournal;
  readonly now?: () => number;
  readonly createId?: () => string;
  readonly acceptancePolicy?: WorkroomAcceptancePolicyDecisionPort;
  readonly acceptanceAuthority?: WorkroomAcceptanceAuthorityPort;
  readonly assignmentHeartbeatLeaseMs?: number;
  /** Current-generation Profile/Capability/Agent/Endpoint authority resolver. */
  readonly remoteAssignmentAuthority?: WorkroomRemoteAssignmentAuthorityPort;
  /** Current-generation Profile/Capability/Agent/Workspace authority resolver. */
  readonly localAssignmentAuthority?: WorkroomLocalAssignmentAuthorityPort;
  readonly planGateAuthority?: WorkroomPlanGateAuthorityPort;
  readonly priorityAuthority?: WorkroomPriorityAuthorityPort;
  readonly runControlAuthority?: WorkroomRunControlAuthorityPort;
}

export interface WorkroomRemoteAssignmentIssuanceReceipt
extends WorkroomRemoteAssignmentIssuance {
  readonly state: WorkroomRunState;
}

export interface WorkroomLocalAssignmentIssuanceReceipt
extends WorkroomLocalAssignmentIssuance {
  readonly state: WorkroomRunState;
}

export interface WorkroomAssignmentIssuancePreview {
  readonly version: 1;
  readonly kind: 'local' | 'remote';
  readonly assignmentRef: string;
  readonly claimDigest: string;
  readonly taskRevision: number;
  readonly kernelSequence: number;
  readonly kernelStateDigest: string;
  readonly previewDigest: string;
}

export interface WorkroomPlanAdmissionInput {
  readonly operationId: string;
  readonly projectId: string;
  readonly title: string;
  readonly sourceEventRef: string;
  readonly sourceEventDigest: string;
  readonly orchestratorAgentDefinitionId: string;
  readonly plan: WorkflowPlanProposal;
}

export interface WorkroomPlanAdmissionReceipt {
  readonly runId: string;
  readonly receiptRef: string;
  readonly receiptDigest: string;
  readonly state: WorkroomRunState;
}

export interface WorkroomPlanAdmissionReplay {
  readonly operationId: string;
  readonly sourceEventRef: string;
  readonly sourceEventDigest: string;
  readonly orchestratorAgentDefinitionId: string;
  readonly plan: WorkflowPlanProposal;
  readonly receipt: WorkroomPlanAdmissionReceipt;
}

export interface WorkroomSchedulerCommitReceipt {
  readonly status: 'committed' | 'duplicate';
  readonly decisionId: string;
  readonly sequence: number;
}

export type WorkroomPlanRevisionAdmissionReceipt =
  | Readonly<{
      status: 'applied';
      planRevision: number;
      duplicate: boolean;
      state: WorkroomRunState;
    }>
  | Readonly<{
      status: 'stale';
      planRevision: number;
      actualSequence: number;
      actualPlanDigest: string;
    }>
  | Readonly<{
      status: 'preemption_required';
      planRevision: number;
      taskKeys: readonly string[];
    }>
  | Readonly<{
      status: 'rejected';
      planRevision: number;
      reason: string;
    }>;

export interface WorkroomPriorityCommitReceipt {
  readonly status: 'committed' | 'duplicate';
  readonly proposalId: string;
  readonly sequence: number;
}

/** The sole command and state-transition authority for Workroom Run facts. */
export class WorkroomKernel {
  readonly #journal: WorkroomJournal;
  readonly #now: () => number;
  readonly #createId: () => string;
  readonly #acceptancePolicy?: WorkroomAcceptancePolicyDecisionPort;
  readonly #acceptanceAuthority?: WorkroomAcceptanceAuthorityPort;
  readonly #assignmentHeartbeatLeaseMs: number;
  readonly #remoteAssignmentAuthority?: WorkroomRemoteAssignmentAuthorityPort;
  readonly #localAssignmentAuthority?: WorkroomLocalAssignmentAuthorityPort;
  readonly #planGateAuthority?: WorkroomPlanGateAuthorityPort;
  readonly #priorityAuthority?: WorkroomPriorityAuthorityPort;
  readonly #runControlAuthority?: WorkroomRunControlAuthorityPort;

  constructor(options: WorkroomKernelOptions) {
    this.#journal = options.journal;
    this.#now = options.now ?? Date.now;
    this.#createId = options.createId ?? (() => randomUUID());
    this.#acceptancePolicy = options.acceptancePolicy;
    this.#acceptanceAuthority = options.acceptanceAuthority;
    this.#assignmentHeartbeatLeaseMs = options.assignmentHeartbeatLeaseMs ?? 30_000;
    this.#remoteAssignmentAuthority = options.remoteAssignmentAuthority;
    this.#localAssignmentAuthority = options.localAssignmentAuthority;
    this.#planGateAuthority = options.planGateAuthority;
    this.#priorityAuthority = options.priorityAuthority;
    this.#runControlAuthority = options.runControlAuthority;
    if (!Number.isSafeInteger(this.#assignmentHeartbeatLeaseMs)
      || this.#assignmentHeartbeatLeaseMs < 1) {
      throw new Error('Assignment heartbeat lease must be a positive safe integer');
    }
  }

  async createRun(input: CreateWorkroomRunInput): Promise<WorkroomRunState> {
    if (!input.projectId.trim()) throw new Error('Workroom projectId is required');
    if (!input.title.trim()) throw new Error('Workroom title is required');
    const projectId = input.projectId.trim();
    const title = input.title.trim();
    const runId = input.runId ?? this.#createId();
    assertRunId(runId);
    const existing = await this.#journal.read(runId);
    if (existing.length > 0) throw new Error(`Workroom run ${runId} already exists`);
    await this.#journal.append(runId, -1, [this.#event('run.created', {
      projectId,
      title,
    })]);
    return this.read(projectId, runId);
  }

  /**
   * Atomic, exact-replay admission of an Orchestrator proposal. The model can
   * only provide a validated WorkflowPlanProposal; this Kernel method is the
   * sole writer that materializes Run and Task facts.
   */
  async admitWorkflowPlan(input: WorkroomPlanAdmissionInput): Promise<WorkroomPlanAdmissionReceipt> {
    const normalized = normalizePlanAdmission(input);
    const runId = planAdmissionRunId(normalized.operationId);
    const admittedPayload = Object.freeze({
      operationId: normalized.operationId,
      sourceEventRef: normalized.sourceEventRef,
      sourceEventDigest: normalized.sourceEventDigest,
      orchestratorAgentDefinitionId: normalized.orchestratorAgentDefinitionId,
      plan: normalized.plan,
      schedulerPolicy: normalized.plan.schedulerPolicy,
    });
    const taskDrafts = normalized.plan.tasks.flatMap(task => {
      const draft = this.#event('task.planned', {
        taskKey: task.key,
        title: task.title,
        required: task.required,
        maxAttempts: task.maxAttempts,
        role: task.role,
        dependsOn: task.dependsOn,
        requires: task.requires,
        sponsorLane: task.scheduler.sponsorLane,
        localRank: task.scheduler.localRank,
        deadline: task.scheduler.deadline,
        enqueuedAt: task.scheduler.enqueuedAt,
        preemptibility: task.scheduler.preemptibility,
        ...(task.approvalGate ? { approvalGate: task.approvalGate } : {}),
      });
      return [
        draft,
        ...(task.approvalGate
          ? [this.#event('task.blocked', {
              taskKey: task.key,
              blockerId: task.approvalGate.id,
              kind: 'approval',
              owner: task.approvalGate.owner,
              reason: `Workflow Plan Sponsor Gate ${task.approvalGate.id}`,
              deadline: task.approvalGate.deadline,
            })]
          : []),
      ];
    });
    const drafts: readonly WorkroomEventDraft[] = Object.freeze([
      this.#event('run.created', {
        projectId: normalized.projectId,
        title: normalized.title,
      }),
      this.#event('plan.admitted', admittedPayload),
      ...taskDrafts,
    ]);
    let existing = await this.#journal.read(runId);
    if (existing.length === 0) {
      try {
        await this.#journal.append(runId, -1, drafts);
      } catch (error) {
        if (!(error instanceof WorkroomSequenceConflictError)) throw error;
      }
      existing = await this.#journal.read(runId);
    }
    assertExactPlanAdmission(existing, normalized, admittedPayload);
    const state = replayWorkroom(existing);
    return planAdmissionReceipt(
      runId,
      normalized.operationId,
      normalized.sourceEventDigest,
      normalized.plan,
      state,
    );
  }

  /** Exact persisted admission lookup used to finish a crash-interrupted application replay. */
  async readWorkflowPlanAdmission(
    operationId: string,
  ): Promise<WorkroomPlanAdmissionReplay | undefined> {
    requireCanonicalText(operationId, 'operationId');
    const runId = planAdmissionRunId(operationId);
    const events = await this.#journal.read(runId);
    if (events.length === 0) return undefined;
    const created = events[0];
    const admitted = events[1];
    if (created?.type !== 'run.created' || admitted?.type !== 'plan.admitted') {
      throw new Error('Workflow Plan persisted admission header is invalid');
    }
    const projectId = created.payload.projectId;
    const title = created.payload.title;
    const sourceEventRef = admitted.payload.sourceEventRef;
    const sourceEventDigest = admitted.payload.sourceEventDigest;
    const orchestratorAgentDefinitionId = admitted.payload.orchestratorAgentDefinitionId;
    const persistedOperationId = admitted.payload.operationId;
    const plan = admitted.payload.plan;
    requireCanonicalText(projectId, 'projectId');
    requireCanonicalText(title, 'title');
    requireCanonicalText(sourceEventRef, 'sourceEventRef');
    requireDigest(sourceEventDigest, 'sourceEventDigest');
    requireCanonicalText(orchestratorAgentDefinitionId, 'orchestratorAgentDefinitionId');
    requireCanonicalText(persistedOperationId, 'persisted operationId');
    assertWorkflowPlanProposal(plan as WorkflowPlanProposal);
    if (persistedOperationId !== operationId) {
      throw new Error('Workflow Plan persisted admission operation drift');
    }
    const admission = {
      operationId,
      projectId,
      title,
      sourceEventRef,
      sourceEventDigest,
      orchestratorAgentDefinitionId,
      plan: plan as WorkflowPlanProposal,
    };
    assertExactPlanAdmission(events, admission, admitted.payload);
    const state = replayWorkroom(events);
    return Object.freeze({
      operationId,
      sourceEventRef,
      sourceEventDigest,
      orchestratorAgentDefinitionId,
      plan: admission.plan,
      receipt: planAdmissionReceipt(runId, operationId, sourceEventDigest, admission.plan, state),
    });
  }

  /** Kernel CAS admission for a non-authoritative, complete Plan Revision proposal. */
  async admitPlanRevision(
    candidate: WorkflowPlanRevisionCandidate,
  ): Promise<WorkroomPlanRevisionAdmissionReceipt> {
    assertWorkflowPlanRevisionCandidate(candidate);
    const events = await this.#journal.read(candidate.runId);
    if (events.length === 0) throw new Error(`Workroom run ${candidate.runId} not found`);
    const state = replayWorkroom(events);
    assertProject(state, candidate.projectId);
    const current = currentWorkflowPlan(events);
    const replay = events.find(event => event.type === 'plan.revision_applied'
      && (event.payload.candidate as { proposalId?: unknown } | undefined)?.proposalId === candidate.proposalId);
    if (replay) {
      const persisted = (replay.payload.candidate as WorkflowPlanRevisionCandidate);
      if (canonicalWorkroomJson(persisted) !== canonicalWorkroomJson(candidate)) {
        throw new Error(`Plan Revision proposal replay payload drift: ${candidate.proposalId}`);
      }
      return Object.freeze({
        status: 'applied', planRevision: Number(replay.payload.planRevision), duplicate: true, state,
      });
    }
    if (candidate.expectedSequence !== state.sequence
      || candidate.basePlanRevision !== current.revision
      || candidate.basePlanDigest !== current.plan.digest) {
      return Object.freeze({
        status: 'stale', planRevision: current.revision, actualSequence: state.sequence,
        actualPlanDigest: current.plan.digest,
      });
    }
    const expectedTaskKeys = current.plan.tasks.map(task => task.key).sort();
    const candidateTaskKeys = Object.keys(candidate.baseTaskRevisions).sort();
    if (canonicalWorkroomJson(expectedTaskKeys) !== canonicalWorkroomJson(candidateTaskKeys)) {
      return Object.freeze({
        status: 'rejected', planRevision: current.revision,
        reason: 'Plan Revision base Task revisions are incomplete for the current Plan',
      });
    }
    for (const [taskKey, revision] of Object.entries(candidate.baseTaskRevisions)) {
      if (state.tasks[taskKey]?.revision !== revision) {
        return Object.freeze({
          status: 'stale', planRevision: current.revision, actualSequence: state.sequence,
          actualPlanDigest: current.plan.digest,
        });
      }
    }
    let recomputed: WorkflowPlanRevisionDiff;
    try {
      recomputed = computeWorkflowPlanRevisionDiff(
        current.plan,
        candidate.nextPlan,
        candidate.baseTaskRevisions,
      );
    } catch (error) {
      return Object.freeze({
        status: 'rejected', planRevision: current.revision,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
    if (canonicalWorkroomJson(recomputed) !== canonicalWorkroomJson(candidate.diff)) {
      return Object.freeze({
        status: 'rejected', planRevision: current.revision,
        reason: 'Plan Revision claimed diff differs from the Kernel recomputation',
      });
    }
    const reused = recomputed.added.filter(task => state.tasks[task.key]).map(task => task.key).sort();
    if (reused.length > 0) {
      return Object.freeze({
        status: 'rejected', planRevision: current.revision,
        reason: `Plan Revision cannot reuse historical Task keys: ${reused.join(', ')}`,
      });
    }
    const changedKeys = [...recomputed.replaced, ...recomputed.removed].map(change => change.taskKey);
    const active = changedKeys.filter(key => {
      const status = state.tasks[key]?.status;
      return status === 'executing' || status === 'awaiting_acceptance' || status === 'cancelling';
    }).sort();
    if (active.length > 0) {
      return Object.freeze({
        status: 'preemption_required', planRevision: current.revision, taskKeys: Object.freeze(active),
      });
    }
    const immutable = changedKeys.filter(key => state.tasks[key]?.status === 'accepted').sort();
    if (immutable.length > 0) {
      return Object.freeze({
        status: 'rejected', planRevision: current.revision,
        reason: `Accepted Tasks are immutable: ${immutable.join(', ')}`,
      });
    }
    const planRevision = current.revision + 1;
    const drafts: WorkroomEventDraft[] = [this.#event('plan.revision_applied', {
      candidate,
      planRevision,
      recomputedDiffDigest: digestCanonicalWorkroomValue(recomputed),
    })];
    for (const task of recomputed.added) drafts.push(...this.#planTaskDrafts(task));
    for (const replacement of recomputed.replaced) {
      drafts.push(this.#event('task.plan_revised', {
        ...planTaskPayload(replacement.task),
        expectedTaskRevision: replacement.expectedTaskRevision,
        newTaskRevision: replacement.expectedTaskRevision + 1,
        reason: candidate.reason,
      }));
      if (replacement.task.approvalGate) {
        drafts.push(this.#planTaskBlockerDraft(replacement.task));
      }
    }
    for (const removal of recomputed.removed) {
      drafts.push(this.#event('task.cancelled', {
        taskKey: removal.taskKey,
        reason: `Removed by Plan Revision ${candidate.proposalId}: ${candidate.reason}`,
      }));
    }
    try {
      await this.#journal.append(candidate.runId, candidate.expectedSequence, drafts);
    } catch (error) {
      if (!(error instanceof WorkroomSequenceConflictError)) throw error;
      const latestEvents = await this.#journal.read(candidate.runId);
      const latest = currentWorkflowPlan(latestEvents);
      return Object.freeze({
        status: 'stale', planRevision: latest.revision,
        actualSequence: latestEvents.at(-1)?.sequence ?? -1,
        actualPlanDigest: latest.plan.digest,
      });
    }
    return Object.freeze({
      status: 'applied', planRevision, duplicate: false,
      state: await this.read(candidate.projectId, candidate.runId),
    });
  }

  /** Exact authority verification followed by one Scheduler priority Journal fact. */
  async commitPriorityChange(
    value: WorkroomPriorityChangeProposal,
  ): Promise<WorkroomPriorityCommitReceipt> {
    const proposal = parseWorkroomPriorityChangeProposal(value);
    const events = await this.#journal.read(proposal.runId);
    if (events.length === 0) throw new Error(`Workroom run ${proposal.runId} not found`);
    const duplicate = events.find(event => event.type === 'scheduler.priority_changed'
      && event.payload.proposalId === proposal.proposalId);
    if (duplicate) {
      const persisted = { ...duplicate.payload } as Record<string, unknown>;
      delete persisted.authorizedBy;
      if (canonicalWorkroomJson(persisted) !== canonicalWorkroomJson(proposal)) {
        throw new Error(`Workroom priority proposal replay payload drift: ${proposal.proposalId}`);
      }
      return Object.freeze({
        status: 'duplicate', proposalId: proposal.proposalId, sequence: duplicate.sequence,
      });
    }
    const state = replayWorkroom(events);
    assertProject(state, proposal.projectId);
    if (state.sequence !== proposal.expectedSequence) {
      throw new WorkroomSequenceConflictError(proposal.runId, proposal.expectedSequence, state.sequence);
    }
    const currentTask = getWorkroomScheduledTaskSnapshot(events, proposal.taskKey);
    if (currentTask.taskRevision !== proposal.taskRevision
      || currentTask.sponsorLane !== proposal.currentLane) {
      throw new Error('Workroom priority proposal targets a stale Task revision or lane');
    }
    if (proposal.deadline < state.now) throw new Error('Workroom priority proposal is expired');
    const authority = this.#priorityAuthority;
    if (!authority) throw new Error('Workroom priority authority is not installed');
    const planAuthority = currentWorkflowPlan(events).plan.authority;
    const authorizationInput: WorkroomPriorityAuthorizationInput = Object.freeze({
      version: 1,
      proposal,
      projectAuthority: Object.freeze({
        catalogRevision: planAuthority.projectRevision,
        projectDigest: planAuthority.projectDigest,
        orchestratorAgentDefinitionId: planAuthority.orchestratorAgentDefinitionId,
      }),
      currentTask,
    });
    const authorization = await authority.authorize(authorizationInput);
    if (!authorization.authorized) throw new WorkroomPriorityUnauthorizedError(authorization.reason);
    if (authorization.authority !== proposal.authority
      || authorization.principalId !== proposal.principalId
      || authorization.authorizationRef !== proposal.authorityRef
      || authorization.proposalDigest !== proposal.digest) {
      throw new Error('Workroom priority authority returned a stale or mismatched exact proof');
    }
    if (proposal.requestedLane !== proposal.currentLane && authorization.authority !== 'sponsor') {
      throw new Error('Only an exact Sponsor authority may move a Task across lanes');
    }
    const appended = await this.#journal.append(proposal.runId, proposal.expectedSequence, [this.#event(
      'scheduler.priority_changed',
      { ...proposal, authorizedBy: authorization.authorizationRef },
    )]);
    return Object.freeze({
      status: 'committed', proposalId: proposal.proposalId, sequence: appended[0]!.sequence,
    });
  }

  /** Typed pre-execution Sponsor decision; generic blocker resolution is forbidden for approval gates. */
  async decidePlanApprovalGate(
    input: WorkroomPlanGateDecisionInput,
  ): Promise<WorkroomPlanGateDecisionReceipt> {
    const normalized = normalizePlanGateDecision(input);
    const requestDigest = digestCanonicalWorkroomValue(normalized);
    let events = await this.#journal.read(normalized.runId);
    const replay = events.find(event => event.type === 'plan_gate.decided'
      && event.payload.operationId === normalized.operationId);
    if (replay) {
      if (replay.payload.requestDigest !== requestDigest) {
        throw new Error(`Plan Sponsor Gate operation payload conflict: ${normalized.operationId}`);
      }
      const state = replayWorkroom(events);
      assertProject(state, normalized.projectId);
      return planGateReceipt('duplicate', normalized, requestDigest, state);
    }
    const state = replayWorkroom(events);
    assertProject(state, normalized.projectId);
    if (state.sequence !== normalized.expectedSequence) {
      throw new WorkroomSequenceConflictError(normalized.runId, normalized.expectedSequence, state.sequence);
    }
    const planEvents = events.filter(event => event.type === 'plan.admitted');
    if (planEvents.length !== 1) throw new Error('Plan Sponsor Gate requires one exact admitted Plan');
    const plan = planEvents[0]!.payload.plan as WorkflowPlanProposal;
    assertWorkflowPlanProposal(plan);
    const plannedTask = plan.tasks.find(task => task.key === normalized.taskKey);
    const task = state.tasks[normalized.taskKey];
    if (!plannedTask || !task || task.revision !== normalized.taskRevision) {
      throw new Error('Plan Sponsor Gate decision targets a stale Task revision');
    }
    const gate = plannedTask.approvalGate;
    if (!gate || gate.id !== normalized.gateId
      || !task.blockers.some(blocker => blocker.id === gate.id && blocker.kind === 'approval')) {
      throw new Error('Plan Sponsor Gate decision targets an absent or settled gate');
    }
    const authority = this.#planGateAuthority;
    if (!authority) throw new Error('Plan Sponsor Gate authority is not installed');
    const authorizationInput = Object.freeze<WorkroomPlanGateAuthorizationInput>({
      version: 1,
      ...normalized,
      planProposalId: plan.proposalId,
      planDigest: plan.digest,
      projectRevision: plan.authority.projectRevision,
      projectDigest: plan.authority.projectDigest,
      sourceParameterDigest: plan.parameterDigest,
      profileRevisionId: plan.authority.profileRevisionId,
      profileDigest: plan.authority.profileDigest,
      policyRevisionId: gate.policyRevisionId,
      policyDigest: gate.policyDigest,
      gateOwner: gate.owner,
      gateDeadline: gate.deadline,
    });
    const authorization = await authority.authorize(authorizationInput);
    if (!authorization.authorized) throw new WorkroomPlanGateUnauthorizedError(authorization.reason);
    if (authorization.principalId !== normalized.sponsorPrincipalId
      || typeof authorization.authorizationRef !== 'string'
      || !authorization.authorizationRef.trim()) {
      throw new Error('Plan Sponsor Gate authority returned a stale principal proof');
    }
    const audit = this.#event('plan_gate.decided', {
      operationId: normalized.operationId,
      requestDigest,
      taskKey: normalized.taskKey,
      taskRevision: normalized.taskRevision,
      gateId: normalized.gateId,
      planDigest: plan.digest,
      policyRevisionId: gate.policyRevisionId,
      policyDigest: gate.policyDigest,
      decision: normalized.decision,
      sponsorPrincipalId: authorization.principalId,
      authorizedBy: authorization.authorizationRef,
      reasonDigest: digestCanonicalWorkroomValue({ reason: normalized.reason }),
    });
    const action = normalized.decision === 'approve'
      ? [this.#event('task.blocker_resolved', {
          taskKey: normalized.taskKey,
          blockerId: normalized.gateId,
        })]
      : normalized.decision === 'cancel'
        ? decideWorkroom(state, {
            type: 'cancel_run',
            reason: `Plan Sponsor Gate ${normalized.gateId} cancelled`,
            controlDeadline: state.now,
          }, (type, payload) => this.#event(type, payload))
        : [this.#event('task.failed', {
            taskKey: normalized.taskKey,
            reason: `Plan Sponsor Gate ${normalized.gateId} ${normalized.decision}`,
          })];
    await this.#journal.append(normalized.runId, normalized.expectedSequence, [audit, ...action]);
    events = await this.#journal.read(normalized.runId);
    return planGateReceipt('committed', normalized, requestDigest, replayWorkroom(events));
  }

  /** Kernel-owned CAS commit for one exact deterministic Scheduler selection. */
  async commitSchedulerDecision(
    decision: WorkroomScheduleDecision,
  ): Promise<WorkroomSchedulerCommitReceipt> {
    const events = await this.#journal.read(decision.runId);
    if (events.length === 0) throw new Error(`Workroom run ${decision.runId} not found`);
    const decisionEventType = decision.type === 'dispatch_task'
      ? 'scheduler.dispatch_requested' as const
      : 'scheduler.preemption_requested' as const;
    const duplicate = events.find(event => event.type === decisionEventType
      && event.payload.decisionId === decision.decisionId);
    if (duplicate) {
      if (canonicalWorkroomJson(duplicate.payload) !== canonicalWorkroomJson(decision)) {
        throw new Error(`Workroom Scheduler decision replay payload drift: ${decision.decisionId}`);
      }
      return Object.freeze({
        status: 'duplicate',
        decisionId: decision.decisionId,
        sequence: duplicate.sequence,
      });
    }
    const expected = decideWorkroomSchedule(events);
    if (!expected || canonicalWorkroomJson(expected) !== canonicalWorkroomJson(decision)) {
      throw new Error('Workroom Scheduler decision is stale or differs from the deterministic Kernel decision');
    }
    const state = replayWorkroom(events);
    assertProject(state, decision.projectId);
    if (state.sequence !== decision.expectedSequence) {
      throw new WorkroomSequenceConflictError(
        decision.runId,
        decision.expectedSequence,
        state.sequence,
      );
    }
    const drafts: readonly WorkroomEventDraft[] = decision.type === 'dispatch_task'
      ? [Object.freeze({
          eventId: decision.decisionId,
          occurredAt: state.now,
          type: 'scheduler.dispatch_requested' as const,
          payload: decision as unknown as Readonly<Record<string, unknown>>,
        })]
      : [
          Object.freeze({
            eventId: decision.decisionId,
            occurredAt: state.now,
            type: 'scheduler.preemption_requested' as const,
            payload: decision as unknown as Readonly<Record<string, unknown>>,
          }),
          this.#event('assignment.checkpoint_requested', {
            decisionId: decision.decisionId,
            assignmentId: decision.assignmentId,
            envelopeDigest: decision.assignmentEnvelopeDigest,
            reservedTaskKey: decision.reservedTaskKey,
            requestedAt: decision.requestedAt,
            deadline: decision.deadline,
            takeoverFence: decision.takeoverFence,
            owner: decision.owner,
            allowedSuccessors: decision.allowedSuccessors,
          }),
        ];
    const appended = await this.#journal.append(decision.runId, decision.expectedSequence, drafts);
    if (appended.length !== drafts.length) throw new Error('Workroom Scheduler Kernel append did not commit one decision batch');
    return Object.freeze({
      status: 'committed',
      decisionId: decision.decisionId,
      sequence: appended.at(-1)!.sequence,
    });
  }

  async execute(projectId: string, runId: string, command: WorkroomCommand): Promise<WorkroomRunState> {
    assertProjectId(projectId);
    const scopedProjectId = projectId.trim();
    assertRunId(runId);
    const state = await this.#readUnscoped(runId);
    assertProject(state, scopedProjectId);
    const events = command.type === 'advance_clock' ? await this.#journal.read(runId) : undefined;
    const drafts = [
      ...decideWorkroom(state, command, (type, payload) => this.#event(type, payload)),
      ...(command.type === 'advance_clock' && events
        ? decideWorkroomPreemptionTimeout(events, command.now, (type, payload) => this.#event(type, payload))
        : []),
    ];
    await this.#journal.append(runId, state.sequence, drafts);
    return drafts.length === 0 ? state : this.read(scopedProjectId, runId);
  }

  /** Sponsor-authorized, exact-sequence Run cancellation or durable replan request. */
  async controlRun(
    command: WorkroomRunControlCommand,
    authenticatedPrincipal: Readonly<{ principalId: string }>,
  ): Promise<WorkroomRunControlReceipt> {
    assertWorkroomRunControlCommand(command);
    const principalId = authenticatedPrincipal.principalId.trim();
    if (!principalId) throw new Error('Workroom Run control authenticated principal is required');
    const events = await this.#journal.read(command.runId);
    if (events.length === 0) throw new Error(`Workroom run ${command.runId} not found`);
    const state = replayWorkroom(events);
    assertProject(state, command.projectId);
    const requestDigest = workroomRunControlRequestDigest(command, principalId);
    const replay = events.find(event => event.type === 'run.control_decided'
      && event.payload.operationId === command.operationId);
    if (replay) {
      if (replay.payload.requestDigest !== requestDigest
        || replay.payload.action !== command.action
        || replay.payload.principalId !== principalId) {
        throw new Error(`Workroom Run control replay payload drift: ${command.operationId}`);
      }
      await this.#authorizeRunControl(command, principalId, requestDigest, {
        sequence: Number(replay.payload.stateSequence),
        status: replay.payload.stateStatus as WorkroomRunStatus,
        digest: String(replay.payload.stateDigest),
      }, 'commit');
      return runControlReceipt('duplicate', command, requestDigest, replay.eventId, state);
    }
    if (command.expectedSequence !== state.sequence) {
      await this.#authorizeRunControl(command, principalId, requestDigest, {
        sequence: state.sequence,
        status: state.status,
        digest: digestCanonicalWorkroomValue(state),
      }, 'stale_probe');
      return Object.freeze({ status: 'stale', actualSequence: state.sequence });
    }
    if (command.action === 'cancel' && state.cancelRequested) {
      throw new Error('Workroom Run cancellation is already active');
    }
    if (state.status === 'completed' || state.status === 'cancelled') {
      throw new Error(`Workroom run is terminal: ${state.status}`);
    }
    if (command.action === 'cancel' && command.controlDeadline < state.now) {
      throw new Error('Workroom Run cancellation deadline is before the current Kernel clock');
    }
    if (command.action === 'request_replan' && state.cancelRequested) {
      throw new Error('Cannot request replan while Run cancellation is active');
    }
    const stateDigest = digestCanonicalWorkroomValue(state);
    const authorization = await this.#authorizeRunControl(command, principalId, requestDigest, {
      sequence: state.sequence, status: state.status, digest: stateDigest,
    }, 'commit');
    const audit = this.#event('run.control_decided', {
      operationId: command.operationId,
      action: command.action,
      reasonCode: command.reasonCode,
      expectedSequence: command.expectedSequence,
      principalId,
      requestDigest,
      catalogRevision: authorization.catalogRevision,
      projectDigest: authorization.projectDigest,
      authorizationRef: authorization.authorizationRef,
      stateSequence: state.sequence,
      stateStatus: state.status,
      stateDigest,
    });
    const drafts = command.action === 'cancel'
      ? [
          audit,
          ...decideWorkroom(state, {
            type: 'cancel_run', reason: command.reasonCode,
            controlDeadline: command.controlDeadline,
          }, (type, payload) => this.#event(type, payload)),
        ]
      : [audit, this.#event('run.replan_requested', {
          operationId: command.operationId,
          reasonCode: command.reasonCode,
          requestDigest,
        })];
    const appended = await this.#journal.append(command.runId, state.sequence, drafts);
    if (appended.length !== drafts.length) {
      throw new Error('Workroom Run control append did not commit one exact batch');
    }
    const next = replayWorkroom([...events, ...appended]);
    return runControlReceipt('committed', command, requestDigest, appended[0]!.eventId, next);
  }

  async #authorizeRunControl(
    command: WorkroomRunControlCommand,
    principalId: string,
    requestDigest: string,
    state: Readonly<{ sequence: number; status: WorkroomRunStatus; digest: string }>,
    purpose: 'commit' | 'stale_probe',
  ) {
    if (!this.#runControlAuthority) {
      throw new WorkroomRunControlUnauthorizedError('authority_not_installed');
    }
    const authorization = await this.#runControlAuthority.authorize(Object.freeze({
      version: 1 as const,
      purpose,
      command,
      authenticatedPrincipalId: principalId,
      requestDigest,
      stateSequence: state.sequence,
      stateStatus: state.status,
      stateDigest: state.digest,
    }));
    if (!authorization.authorized) {
      throw new WorkroomRunControlUnauthorizedError(authorization.reason);
    }
    if (authorization.principalId !== principalId
      || !authorization.catalogRevision.trim()
      || !authorization.projectDigest.trim()
      || !authorization.authorizationRef.trim()) {
      throw new WorkroomRunControlUnauthorizedError('authority_decision_not_exact');
    }
    return authorization;
  }

  /** Atomically persists the local Assignment claim and its exact Envelope. */
  async previewLocalAssignment(
    input: WorkroomLocalAssignmentClaimRequest,
  ): Promise<WorkroomAssignmentIssuancePreview> {
    const request = normalizeWorkroomLocalAssignmentClaimRequest(input);
    const events = await this.#journal.read(request.runId);
    const state = replayWorkroom(events);
    assertProject(state, request.projectId);
    const existing = findLocalAssignmentIssuance(events, request.operationId);
    if (existing) assertLocalAssignmentReplay(existing, workroomLocalAssignmentRequestDigest(request));
    const task = state.tasks[request.taskKey];
    if (!task) throw new Error(`Task ${request.taskKey} not found`);
    if (!existing && task.status !== 'ready') throw new Error(`Task ${task.key} is ${task.status}`);
    return assignmentPreview({
      kind: 'local', assignmentRef: existing?.envelope.assignmentId
        ?? workroomLocalAssignmentId(request.operationId),
      claimDigest: digestCanonicalWorkroomValue({ kind: 'local', request }),
      taskRevision: existing?.envelope.taskRevision ?? task.revision,
      kernelSequence: existing?.envelope.factAnchor.sequence ?? state.sequence,
      kernelStateDigest: existing?.envelope.factAnchor.digest
        ?? digestCanonicalWorkroomValue(events),
    });
  }

  async findLocalAssignment(
    input: WorkroomLocalAssignmentClaimRequest,
  ): Promise<WorkroomLocalAssignmentIssuanceReceipt | undefined> {
    const request = normalizeWorkroomLocalAssignmentClaimRequest(input);
    const events = await this.#journal.read(request.runId);
    const issued = findLocalAssignmentIssuance(events, request.operationId);
    if (!issued) return undefined;
    assertLocalAssignmentReplay(issued, workroomLocalAssignmentRequestDigest(request));
    const state = replayWorkroom(events);
    assertProject(state, request.projectId);
    return Object.freeze({ ...issued, state });
  }

  async issueLocalAssignment(
    input: WorkroomLocalAssignmentClaimRequest,
  ): Promise<WorkroomLocalAssignmentIssuanceReceipt> {
    const request = normalizeWorkroomLocalAssignmentClaimRequest(input);
    const requestDigest = workroomLocalAssignmentRequestDigest(request);
    const existingEvents = await this.#journal.read(request.runId);
    const replayed = findLocalAssignmentIssuance(existingEvents, request.operationId);
    if (replayed) {
      assertLocalAssignmentReplay(replayed, requestDigest);
      const state = replayWorkroom(existingEvents);
      assertProject(state, request.projectId);
      return Object.freeze({ ...replayed, state });
    }
    const authorityPort = this.#localAssignmentAuthority;
    if (!authorityPort) throw new Error('Local Assignment authority resolver is not installed');
    const state = replayWorkroom(existingEvents);
    assertProject(state, request.projectId);
    const task = state.tasks[request.taskKey];
    if (!task) throw new Error(`Task ${request.taskKey} not found`);
    if (task.status !== 'ready') throw new Error(`Task ${task.key} is ${task.status}`);
    if (!task.acceptanceContract) {
      throw new Error(`Task ${task.key} Acceptance Contract is not pinned`);
    }
    const attempt = task.attempt + 1;
    const fence = Object.values(state.assignments)
      .filter(assignment => assignment.taskKey === task.key)
      .reduce((highest, assignment) => Math.max(highest, assignment.fence), 0) + 1;
    const assignmentId = workroomLocalAssignmentId(request.operationId);
    const factAnchor = Object.freeze({
      ref: `workroom-journal:${encodeURIComponent(state.runId)}:${state.sequence}`,
      sequence: state.sequence,
      digest: digestCanonicalWorkroomValue(existingEvents),
    });
    const assignment = Object.freeze({
      id: assignmentId,
      revision: 1,
      attempt,
      fence,
    });
    const authority = await authorityPort.resolveLocal(Object.freeze({
      projectId: state.projectId,
      runId: state.runId,
      task: Object.freeze({
        key: task.key,
        revision: task.revision,
        acceptanceContract: task.acceptanceContract,
      }),
      assignment,
      requestedAgentDefinitionId: request.agentDefinitionId,
      factAnchor,
    }));
    const timing = this.#trustedAssignmentTiming('Local');
    const issued = materializeWorkroomLocalAssignment({
      request,
      taskRevision: task.revision,
      assignmentId,
      assignmentRevision: assignment.revision,
      attempt,
      fence,
      issuedAt: timing.issuedAt,
      factAnchor,
      authority,
    });
    const claimDrafts = decideWorkroom(state, {
      type: 'claim_task',
      taskKey: task.key,
      assignmentId,
      assignmentRevision: issued.envelope.assignmentRevision,
      fence,
      envelopeDigest: issued.envelope.digest,
      owner: issued.envelope.principalId,
      role: issued.envelope.role,
      leaseExpiresAt: timing.leaseExpiresAt,
    }, (type, payload) => this.#event(type, payload));
    const drafts = Object.freeze([
      ...claimDrafts,
      this.#event('local_execution.requested', issued as unknown as Record<string, unknown>),
    ]);
    try {
      await this.#journal.append(request.runId, state.sequence, drafts);
    } catch (error) {
      if (!(error instanceof WorkroomSequenceConflictError)) throw error;
      const winnerEvents = await this.#journal.read(request.runId);
      const winner = findLocalAssignmentIssuance(winnerEvents, request.operationId);
      if (!winner) throw error;
      assertLocalAssignmentReplay(winner, requestDigest);
      const winnerState = replayWorkroom(winnerEvents);
      assertProject(winnerState, request.projectId);
      return Object.freeze({ ...winner, state: winnerState });
    }
    return Object.freeze({
      ...issued,
      state: await this.read(request.projectId, request.runId),
    });
  }

  /**
   * Atomically persists the Kernel claim and its exact Remote Dispatch intent.
   * A caller names only the desired definition/endpoint; the current-generation
   * authority port supplies every executable snapshot and grant.
   */
  async previewRemoteAssignment(
    input: WorkroomRemoteAssignmentClaimRequest,
  ): Promise<WorkroomAssignmentIssuancePreview> {
    const request = normalizeWorkroomRemoteAssignmentClaimRequest(input);
    const events = await this.#journal.read(request.runId);
    const state = replayWorkroom(events);
    assertProject(state, request.projectId);
    const existing = findRemoteAssignmentIssuance(events, request.operationId);
    if (existing) assertRemoteAssignmentReplay(existing, workroomRemoteAssignmentRequestDigest(request));
    const task = state.tasks[request.taskKey];
    if (!task) throw new Error(`Task ${request.taskKey} not found`);
    if (!existing && task.status !== 'ready') throw new Error(`Task ${task.key} is ${task.status}`);
    return assignmentPreview({
      kind: 'remote', assignmentRef: existing?.envelope.assignmentId
        ?? workroomRemoteAssignmentId(request.operationId),
      claimDigest: digestCanonicalWorkroomValue({ kind: 'remote', request }),
      taskRevision: existing?.envelope.taskRevision ?? task.revision,
      kernelSequence: existing?.envelope.factAnchor.sequence ?? state.sequence,
      kernelStateDigest: existing?.envelope.factAnchor.digest
        ?? digestCanonicalWorkroomValue(events),
    });
  }

  async findRemoteAssignment(
    input: WorkroomRemoteAssignmentClaimRequest,
  ): Promise<WorkroomRemoteAssignmentIssuanceReceipt | undefined> {
    const request = normalizeWorkroomRemoteAssignmentClaimRequest(input);
    const events = await this.#journal.read(request.runId);
    const issued = findRemoteAssignmentIssuance(events, request.operationId);
    if (!issued) return undefined;
    assertRemoteAssignmentReplay(issued, workroomRemoteAssignmentRequestDigest(request));
    const state = replayWorkroom(events);
    assertProject(state, request.projectId);
    return Object.freeze({ ...issued, state });
  }

  async issueRemoteAssignment(
    input: WorkroomRemoteAssignmentClaimRequest,
  ): Promise<WorkroomRemoteAssignmentIssuanceReceipt> {
    const request = normalizeWorkroomRemoteAssignmentClaimRequest(input);
    const requestDigest = workroomRemoteAssignmentRequestDigest(request);
    const existingEvents = await this.#journal.read(request.runId);
    const replayed = findRemoteAssignmentIssuance(existingEvents, request.operationId);
    if (replayed) {
      assertRemoteAssignmentReplay(replayed, requestDigest);
      const state = replayWorkroom(existingEvents);
      assertProject(state, request.projectId);
      return Object.freeze({ ...replayed, state });
    }
    const authorityPort = this.#remoteAssignmentAuthority;
    if (!authorityPort) {
      throw new Error('Remote Assignment authority resolver is not installed');
    }
    const state = replayWorkroom(existingEvents);
    assertProject(state, request.projectId);
    const task = state.tasks[request.taskKey];
    if (!task) throw new Error(`Task ${request.taskKey} not found`);
    if (task.status !== 'ready') throw new Error(`Task ${task.key} is ${task.status}`);
    if (!task.acceptanceContract) {
      throw new Error(`Task ${task.key} Acceptance Contract is not pinned`);
    }
    const attempt = task.attempt + 1;
    const fence = Object.values(state.assignments)
      .filter(assignment => assignment.taskKey === task.key)
      .reduce((highest, assignment) => Math.max(highest, assignment.fence), 0) + 1;
    const assignmentId = workroomRemoteAssignmentId(request.operationId);
    const factAnchor = Object.freeze({
      ref: `workroom-journal:${encodeURIComponent(state.runId)}:${state.sequence}`,
      sequence: state.sequence,
      digest: digestCanonicalWorkroomValue(existingEvents),
    });
    const assignment = Object.freeze({
      id: assignmentId,
      revision: 1,
      attempt,
      fence,
    });
    const authority = await authorityPort.resolve(Object.freeze({
      projectId: state.projectId,
      runId: state.runId,
      task: Object.freeze({
        key: task.key,
        revision: task.revision,
        acceptanceContract: task.acceptanceContract,
      }),
      assignment,
      requestedAgentDefinitionId: request.agentDefinitionId,
      requestedEndpointId: request.endpointId,
      factAnchor,
    }));
    const timing = this.#trustedAssignmentTiming('Remote');
    const leaseExpiresAt = timing.leaseExpiresAt;
    const issued = materializeWorkroomRemoteAssignment({
      request,
      taskRevision: task.revision,
      assignmentId,
      assignmentRevision: assignment.revision,
      attempt,
      fence,
      issuedAt: timing.issuedAt,
      leaseExpiresAt,
      reconcileDeadline: timing.reconcileDeadline,
      acceptanceContract: task.acceptanceContract,
      factAnchor,
      authority,
    });
    const claimDrafts = decideWorkroom(state, {
      type: 'claim_task',
      taskKey: task.key,
      assignmentId,
      assignmentRevision: issued.envelope.assignmentRevision,
      fence,
      envelopeDigest: issued.envelope.digest,
      owner: issued.envelope.principalId,
      role: issued.envelope.role,
      leaseExpiresAt,
    }, (type, payload) => this.#event(type, payload));
    const drafts = Object.freeze([
      ...claimDrafts,
      this.#event('remote_dispatch.requested', issued as unknown as Record<string, unknown>),
    ]);
    try {
      await this.#journal.append(request.runId, state.sequence, drafts);
    } catch (error) {
      if (!(error instanceof WorkroomSequenceConflictError)) throw error;
      const winnerEvents = await this.#journal.read(request.runId);
      const winner = findRemoteAssignmentIssuance(winnerEvents, request.operationId);
      if (!winner) throw error;
      assertRemoteAssignmentReplay(winner, requestDigest);
      const winnerState = replayWorkroom(winnerEvents);
      assertProject(winnerState, request.projectId);
      return Object.freeze({ ...winner, state: winnerState });
    }
    return Object.freeze({
      ...issued,
      state: await this.read(request.projectId, request.runId),
    });
  }

  async applyAssignmentObservation(
    envelope: AssignmentExecutionEnvelope,
    value: AssignmentExecutionObservation,
    expectedSequence: number,
  ): Promise<WorkroomRunState> {
    assertAssignmentExecutionEnvelope(envelope);
    const observation = validateAssignmentExecutionObservation(envelope, value);
    if (!Number.isSafeInteger(expectedSequence) || expectedSequence < 0) {
      throw new Error('Assignment observation expectedSequence must be a non-negative safe integer');
    }
    const events = await this.#journal.read(envelope.runId);
    if (events.length === 0) throw new Error(`Workroom run ${envelope.runId} not found`);
    const state = replayWorkroom(events);
    assertProject(state, envelope.projectId);
    const task = state.tasks[envelope.taskKey];
    const assignment = state.assignments[envelope.assignmentId];
    if (!task || !assignment
      || task.revision !== envelope.taskRevision
      || assignment.taskKey !== task.key
      || assignment.taskRevision !== envelope.taskRevision
      || assignment.revision !== envelope.assignmentRevision
      || assignment.attempt !== envelope.attempt
      || assignment.fence !== envelope.fence
      || assignment.envelopeDigest !== envelope.digest
      || assignment.owner !== envelope.principalId
      || assignment.role !== envelope.role) {
      throw new Error('Assignment observation Envelope is stale or targets another authority scope');
    }
    const observationDigest = digestCanonicalWorkroomValue(observation);
    const persistedDigest = assignment.observationDigests[observation.observationId];
    if (persistedDigest) {
      if (persistedDigest !== observationDigest) {
        throw new Error(`Assignment observationId conflict: ${observation.observationId}`);
      }
      return state;
    }
    if (task.currentAssignmentId !== assignment.id) {
      throw new Error('Assignment observation Envelope is stale or targets another authority scope');
    }
    if (state.sequence !== expectedSequence) {
      throw new WorkroomSequenceConflictError(envelope.runId, expectedSequence, state.sequence);
    }
    const header = {
      assignmentId: assignment.id,
      observationId: observation.observationId,
      observationDigest,
      envelopeDigest: envelope.digest,
    };
    let draft: WorkroomEventDraft;
    switch (observation.type) {
      case 'progress':
        requireObservationStatus(assignment.status, ['running']);
        draft = this.#event('assignment.progress', { ...header, progress: observation.progress });
        break;
      case 'heartbeat':
        requireObservationStatus(assignment.status, ['leased', 'running']);
        draft = this.#event('assignment.heartbeat', {
          ...header,
          leaseExpiresAt: this.#trustedHeartbeatLeaseExpiry(assignment.leaseExpiresAt),
        });
        break;
      case 'checkpoint':
        requireObservationStatus(assignment.status, ['running']);
        draft = this.#event('assignment.checkpointed', {
          ...header,
          checkpointRef: observation.checkpoint.ref,
          checkpointDigest: observation.checkpoint.digest,
        });
        break;
      case 'execution_completed':
        requireObservationStatus(assignment.status, ['running']);
        draft = this.#event('assignment.execution_completed', {
          ...header,
          reportRef: observation.completion.report.ref,
          reportDigest: observation.completion.report.digest,
          candidateRef: observation.completion.candidate.ref,
          candidateHash: observation.completion.candidate.hash,
          ...(observation.completion.completionReceiptDigest === undefined
            ? {}
            : { completionReceiptDigest: observation.completion.completionReceiptDigest }),
        });
        break;
    }
    const preemption = replayWorkroomPreemptions(events).pending;
    const drafts = observation.type === 'checkpoint'
      && preemption?.assignmentId === assignment.id
      ? [
          draft,
          this.#event('scheduler.preemption_checkpoint_acknowledged', {
            decisionId: preemption.decisionId,
            assignmentId: assignment.id,
            envelopeDigest: envelope.digest,
            observationId: observation.observationId,
            observationDigest,
            checkpointRef: observation.checkpoint.ref,
            checkpointDigest: observation.checkpoint.digest,
            assignmentAttempt: assignment.attempt,
            assignmentFence: assignment.fence,
            takeoverFence: preemption.takeoverFence,
          }),
          this.#event('assignment.preempted', {
            decisionId: preemption.decisionId,
            assignmentId: assignment.id,
            checkpointRef: observation.checkpoint.ref,
            checkpointDigest: observation.checkpoint.digest,
            outcome: 'interrupted',
          }),
        ]
      : [draft];
    await this.#journal.append(envelope.runId, expectedSequence, drafts);
    return this.read(envelope.projectId, envelope.runId);
  }

  async evaluateTaskAcceptance(
    projectId: string,
    runId: string,
    taskKey: string,
  ): Promise<WorkroomRunState> {
    assertProjectId(projectId);
    const scopedProjectId = projectId.trim();
    assertRunId(runId);
    const policy = this.#acceptancePolicy;
    if (!policy) throw new Error('Acceptance Policy Decision Port is not installed');
    const state = await this.#readUnscoped(runId);
    assertProject(state, scopedProjectId);
    const input = createAcceptanceDecisionInput(state, taskKey);
    const decision = await policy.decide(input);
    const assignment = state.assignments[input.assignment.id];
    if (!assignment?.candidateRef
      || !assignment.candidateHash
      || decision.candidate.id !== assignment.candidateRef
      || decision.candidate.hash !== assignment.candidateHash) {
      throw new Error('Acceptance Candidate does not match the Executor completion candidate');
    }
    const drafts = decideTaskAcceptance(input, decision, (type, payload) => this.#event(type, payload));
    await this.#journal.append(runId, input.expectedSequence, drafts);
    return this.read(scopedProjectId, runId);
  }

  async pinTaskAcceptance(
    projectId: string,
    runId: string,
    taskKey: string,
  ): Promise<WorkroomRunState> {
    assertProjectId(projectId);
    const scopedProjectId = projectId.trim();
    assertRunId(runId);
    const policy = this.#acceptancePolicy;
    if (!policy) throw new Error('Acceptance Policy Decision Port is not installed');
    const state = await this.#readUnscoped(runId);
    assertProject(state, scopedProjectId);
    const input = createAcceptanceContractPinInput(state, taskKey);
    const contract = await policy.pinContract(input);
    assertAcceptanceContract(contract, input.task.key, input.task.revision);
    const pinnedContract = freezeAcceptanceContract(contract);
    const drafts = [this.#event('task.acceptance_pinned', {
      taskKey: input.task.key,
      contract: pinnedContract,
    })];
    await this.#journal.append(runId, input.expectedSequence, drafts);
    return this.read(scopedProjectId, runId);
  }

  async claimReviewerAssignment(
    projectId: string,
    runId: string,
    assignmentId: string,
    principalId: string,
  ): Promise<WorkroomRunState> {
    const { scopedProjectId, state } = await this.#readProject(projectId, runId);
    const assignment = state.reviewerAssignments[assignmentId];
    if (!assignment) throw new Error(`Reviewer Assignment ${assignmentId} not found`);
    const authorization = await this.#authorize(state, {
      action: 'claim_review',
      principalId,
      requiredRole: 'reviewer',
      taskKey: assignment.taskKey,
      targetId: assignment.id,
    });
    const drafts = decideReviewerClaim(
      state,
      { assignmentId, principalId, authorization },
      (type, payload) => this.#event(type, payload),
    );
    await this.#journal.append(runId, state.sequence, drafts);
    return this.read(scopedProjectId, runId);
  }

  async submitReviewerVerdict(
    projectId: string,
    runId: string,
    assignmentId: string,
    principalId: string,
    verdict: ReviewerVerdict,
  ): Promise<WorkroomRunState> {
    const { scopedProjectId, state } = await this.#readProject(projectId, runId);
    const assignment = state.reviewerAssignments[assignmentId];
    if (!assignment) throw new Error(`Reviewer Assignment ${assignmentId} not found`);
    const authorization = await this.#authorize(state, {
      action: 'submit_review',
      principalId,
      requiredRole: 'reviewer',
      taskKey: assignment.taskKey,
      targetId: assignment.id,
    });
    const drafts = decideReviewerVerdict(
      state,
      { assignmentId, principalId, authorization, verdict },
      (type, payload) => this.#event(type, payload),
    );
    await this.#journal.append(runId, state.sequence, drafts);
    return this.read(scopedProjectId, runId);
  }

  async decideSponsorGate(
    projectId: string,
    runId: string,
    gateId: string,
    principalId: string,
    input: Readonly<{
      candidateHash: string;
      decision: WorkroomSponsorDecision;
      reason: string;
    }>,
  ): Promise<WorkroomRunState> {
    const { scopedProjectId, state } = await this.#readProject(projectId, runId);
    const gate = state.sponsorGates[gateId];
    if (!gate) throw new Error(`Sponsor Gate ${gateId} not found`);
    const authorization = await this.#authorize(state, {
      action: 'decide_sponsor',
      principalId,
      requiredRole: 'sponsor',
      taskKey: gate.taskKey,
      targetId: gate.id,
    });
    const drafts = decideSponsorGate(
      state,
      { gateId, principalId, authorization, ...input },
      (type, payload) => this.#event(type, payload),
    );
    await this.#journal.append(runId, state.sequence, drafts);
    return this.read(scopedProjectId, runId);
  }

  async read(projectId: string, runId: string): Promise<WorkroomRunState> {
    assertProjectId(projectId);
    const scopedProjectId = projectId.trim();
    assertRunId(runId);
    const state = await this.#readUnscoped(runId);
    assertProject(state, scopedProjectId);
    return state;
  }

  async list(projectId: string): Promise<readonly WorkroomRunState[]> {
    assertProjectId(projectId);
    const scopedProjectId = projectId.trim();
    const states = await Promise.all(
      (await this.#journal.listRunIds()).map(runId => this.#readUnscoped(runId)),
    );
    return Object.freeze(states
      .filter(state => state.projectId === scopedProjectId)
      .sort((left, right) => right.now - left.now));
  }

  /** Durable remote dispatch intents used by the generation recovery projector. */
  async listLocalAssignmentIssuances(): Promise<
    readonly WorkroomLocalAssignmentIssuanceReceipt[]
  > {
    const receipts: WorkroomLocalAssignmentIssuanceReceipt[] = [];
    for (const runId of await this.#journal.listRunIds()) {
      const events = await this.#journal.read(runId);
      if (events.length === 0) continue;
      const state = replayWorkroom(events);
      for (const event of events) {
        if (event.type !== 'local_execution.requested') continue;
        receipts.push(Object.freeze({
          ...parseWorkroomLocalAssignmentIssuance(event.payload),
          state,
        }));
      }
    }
    return Object.freeze(receipts.sort((left, right) =>
      compareCanonicalWorkroomText(left.operationId, right.operationId)));
  }

  /** Durable remote dispatch intents used by the generation recovery projector. */
  async listRemoteAssignmentIssuances(): Promise<
    readonly WorkroomRemoteAssignmentIssuanceReceipt[]
  > {
    const receipts: WorkroomRemoteAssignmentIssuanceReceipt[] = [];
    for (const runId of await this.#journal.listRunIds()) {
      const events = await this.#journal.read(runId);
      if (events.length === 0) continue;
      const state = replayWorkroom(events);
      for (const event of events) {
        if (event.type !== 'remote_dispatch.requested') continue;
        receipts.push(Object.freeze({
          ...parseWorkroomRemoteAssignmentIssuance(event.payload),
          state,
        }));
      }
    }
    return Object.freeze(receipts.sort((left, right) =>
      compareCanonicalWorkroomText(left.operationId, right.operationId)));
  }

  async #readUnscoped(runId: string): Promise<WorkroomRunState> {
    const events = await this.#journal.read(runId);
    if (events.length === 0) throw new Error(`Workroom run ${runId} not found`);
    return replayWorkroom(events);
  }

  async #readProject(
    projectId: string,
    runId: string,
  ): Promise<Readonly<{ scopedProjectId: string; state: WorkroomRunState }>> {
    assertProjectId(projectId);
    const scopedProjectId = projectId.trim();
    assertRunId(runId);
    const state = await this.#readUnscoped(runId);
    assertProject(state, scopedProjectId);
    return { scopedProjectId, state };
  }

  async #authorize(
    state: WorkroomRunState,
    input: Omit<WorkroomAcceptanceAuthorizationInput, 'projectId' | 'runId' | 'expectedSequence'>,
  ): Promise<WorkroomAcceptanceAuthorizationDecision> {
    const authority = this.#acceptanceAuthority;
    if (!authority) throw new Error('Workroom Acceptance Authority Port is not installed');
    return await authority.authorize(Object.freeze({
      ...input,
      projectId: state.projectId,
      runId: state.runId,
      expectedSequence: state.sequence,
    }));
  }

  #planTaskDrafts(task: WorkflowPlanTaskProposal): readonly WorkroomEventDraft[] {
    return Object.freeze([
      this.#event('task.planned', planTaskPayload(task)),
      ...(task.approvalGate ? [this.#planTaskBlockerDraft(task)] : []),
    ]);
  }

  #planTaskBlockerDraft(task: WorkflowPlanTaskProposal): WorkroomEventDraft {
    const gate = task.approvalGate;
    if (!gate) throw new Error(`Workflow Plan Task ${task.key} has no Sponsor Gate`);
    return this.#event('task.blocked', {
      taskKey: task.key,
      blockerId: gate.id,
      kind: 'approval',
      owner: gate.owner,
      reason: `Workflow Plan Sponsor Gate ${gate.id}`,
      deadline: gate.deadline,
    });
  }

  #event(type: WorkroomEventType, payload: Record<string, unknown>): WorkroomEventDraft {
    return Object.freeze({
      eventId: this.#createId(),
      occurredAt: this.#now(),
      type,
      payload: Object.freeze({ ...payload }),
    });
  }

  #trustedHeartbeatLeaseExpiry(currentLeaseExpiresAt: number): number {
    const now = this.#now();
    if (!Number.isFinite(now)) throw new Error('Assignment heartbeat clock must be finite');
    if (now >= currentLeaseExpiresAt) {
      throw new Error('Assignment heartbeat cannot revive an expired lease');
    }
    const leaseExpiresAt = now + this.#assignmentHeartbeatLeaseMs;
    if (!Number.isFinite(leaseExpiresAt)) throw new Error('Assignment heartbeat lease expiry must be finite');
    if (leaseExpiresAt <= currentLeaseExpiresAt) {
      throw new Error('Assignment heartbeat must strictly extend the current lease');
    }
    return leaseExpiresAt;
  }

  #trustedAssignmentTiming(kind: 'Local' | 'Remote'): Readonly<{
    issuedAt: number;
    leaseExpiresAt: number;
    reconcileDeadline: number;
  }> {
    const now = this.#now();
    if (!Number.isFinite(now) || now < 0) {
      throw new Error(`${kind} Assignment claim clock must be a finite timestamp`);
    }
    const expiresAt = now + this.#assignmentHeartbeatLeaseMs;
    const reconcileDeadline = expiresAt + this.#assignmentHeartbeatLeaseMs;
    if (!Number.isFinite(expiresAt) || !Number.isFinite(reconcileDeadline)) {
      throw new Error(`${kind} Assignment lease expiry must be finite`);
    }
    return Object.freeze({
      issuedAt: now,
      leaseExpiresAt: expiresAt,
      reconcileDeadline,
    });
  }
}

function assignmentPreview(
  input: Omit<WorkroomAssignmentIssuancePreview, 'version' | 'previewDigest'>,
): WorkroomAssignmentIssuancePreview {
  const body = Object.freeze({ version: 1 as const, ...input });
  return Object.freeze({ ...body, previewDigest: digestCanonicalWorkroomValue(body) });
}

function currentWorkflowPlan(
  events: readonly import('./kernel-contracts.js').WorkroomEvent[],
): Readonly<{ revision: number; plan: WorkflowPlanProposal }> {
  const admitted = events.filter(event => event.type === 'plan.admitted');
  if (admitted.length !== 1) throw new Error('Plan Revision requires one exact admitted Plan');
  let plan = admitted[0]!.payload.plan as WorkflowPlanProposal;
  assertWorkflowPlanProposal(plan);
  let revision = 1;
  for (const event of events) {
    if (event.type !== 'plan.revision_applied') continue;
    const candidate = event.payload.candidate as WorkflowPlanRevisionCandidate;
    assertWorkflowPlanRevisionCandidate(candidate);
    const nextRevision = Number(event.payload.planRevision);
    if (candidate.basePlanRevision !== revision || candidate.basePlanDigest !== plan.digest
      || nextRevision !== revision + 1) {
      throw new Error('Persisted Plan Revision chain is not contiguous');
    }
    plan = candidate.nextPlan;
    revision = nextRevision;
  }
  return Object.freeze({ revision, plan });
}

function planTaskPayload(task: WorkflowPlanTaskProposal): Record<string, unknown> {
  return {
    taskKey: task.key,
    title: task.title,
    required: task.required,
    maxAttempts: task.maxAttempts,
    role: task.role,
    dependsOn: task.dependsOn,
    requires: task.requires,
    sponsorLane: task.scheduler.sponsorLane,
    localRank: task.scheduler.localRank,
    deadline: task.scheduler.deadline,
    enqueuedAt: task.scheduler.enqueuedAt,
    preemptibility: task.scheduler.preemptibility,
    ...(task.approvalGate ? { approvalGate: task.approvalGate } : {}),
  };
}

function requireObservationStatus(
  status: import('./kernel-contracts.js').WorkroomAssignmentStatus,
  allowed: readonly import('./kernel-contracts.js').WorkroomAssignmentStatus[],
): void {
  if (!allowed.includes(status)) throw new Error(`Assignment cannot observe execution while ${status}`);
}

function assertRunId(runId: string): void {
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(runId)) {
    throw new Error('Workroom runId must contain only letters, digits, underscore or hyphen');
  }
}

function assertProjectId(projectId: string): void {
  if (!projectId.trim()) throw new Error('Workroom projectId is required');
}

function assertProject(state: WorkroomRunState, projectId: string): void {
  if (state.projectId !== projectId) throw new Error('Workroom run does not belong to the requested Project');
}

function runControlReceipt(
  status: 'committed' | 'duplicate',
  command: WorkroomRunControlCommand,
  requestDigest: string,
  receiptRef: string,
  state: WorkroomRunState,
): WorkroomRunControlReceipt {
  return Object.freeze({
    status,
    action: command.action,
    operationId: command.operationId,
    receiptRef,
    receiptDigest: digestCanonicalWorkroomValue({
      version: 1,
      operationId: command.operationId,
      action: command.action,
      requestDigest,
      receiptRef,
    }),
    state,
  });
}

function findLocalAssignmentIssuance(
  events: readonly import('./kernel-contracts.js').WorkroomEvent[],
  operationId: string,
): WorkroomLocalAssignmentIssuance | undefined {
  const matches = events.filter(event => event.type === 'local_execution.requested'
    && event.payload.operationId === operationId);
  if (matches.length > 1) {
    throw new Error(`Local Assignment operation ${operationId} is duplicated in the Kernel Journal`);
  }
  return matches[0]
    ? parseWorkroomLocalAssignmentIssuance(matches[0].payload)
    : undefined;
}

function assertLocalAssignmentReplay(
  issuance: WorkroomLocalAssignmentIssuance,
  requestDigest: string,
): void {
  if (issuance.requestDigest !== requestDigest) {
    throw new Error(`Local Assignment operation payload conflict: ${issuance.operationId}`);
  }
}

function findRemoteAssignmentIssuance(
  events: readonly import('./kernel-contracts.js').WorkroomEvent[],
  operationId: string,
): WorkroomRemoteAssignmentIssuance | undefined {
  const matches = events.filter(event => event.type === 'remote_dispatch.requested'
    && event.payload.operationId === operationId);
  if (matches.length > 1) {
    throw new Error(`Remote Assignment operation ${operationId} is duplicated in the Kernel Journal`);
  }
  return matches[0]
    ? parseWorkroomRemoteAssignmentIssuance(matches[0].payload)
    : undefined;
}

function assertRemoteAssignmentReplay(
  issuance: WorkroomRemoteAssignmentIssuance,
  requestDigest: string,
): void {
  if (issuance.requestDigest !== requestDigest) {
    throw new Error(`Remote Assignment operation payload conflict: ${issuance.operationId}`);
  }
}

function normalizePlanAdmission(input: WorkroomPlanAdmissionInput): WorkroomPlanAdmissionInput {
  requireCanonicalText(input.operationId, 'operationId');
  assertProjectId(input.projectId);
  requireCanonicalText(input.title, 'title');
  requireCanonicalText(input.sourceEventRef, 'sourceEventRef');
  requireDigest(input.sourceEventDigest, 'sourceEventDigest');
  requireCanonicalText(input.orchestratorAgentDefinitionId, 'orchestratorAgentDefinitionId');
  assertWorkflowPlanProposal(input.plan);
  if (input.plan.projectId !== input.projectId.trim()) {
    throw new Error('Workflow Plan proposal belongs to another Project');
  }
  return Object.freeze({
    ...structuredClone(input),
    projectId: input.projectId.trim(),
    title: input.title.trim(),
  });
}

function normalizePlanGateDecision(input: WorkroomPlanGateDecisionInput): WorkroomPlanGateDecisionInput {
  for (const [value, label] of [
    [input.operationId, 'operationId'], [input.projectId, 'projectId'], [input.runId, 'runId'],
    [input.taskKey, 'taskKey'], [input.gateId, 'gateId'], [input.reason, 'reason'],
    [input.sponsorPrincipalId, 'sponsorPrincipalId'], [input.sponsorAuthorityRef, 'sponsorAuthorityRef'],
  ] as const) requireCanonicalText(value, label);
  if (!Number.isSafeInteger(input.taskRevision) || input.taskRevision < 1) {
    throw new Error('Plan Sponsor Gate taskRevision must be a positive safe integer');
  }
  if (!Number.isSafeInteger(input.expectedSequence) || input.expectedSequence < 0) {
    throw new Error('Plan Sponsor Gate expectedSequence must be a non-negative safe integer');
  }
  if (!['approve', 'reject', 'request_changes', 'cancel'].includes(input.decision)) {
    throw new Error('Plan Sponsor Gate decision is invalid');
  }
  return Object.freeze(structuredClone(input));
}

function planGateReceipt(
  status: 'committed' | 'duplicate',
  input: WorkroomPlanGateDecisionInput,
  requestDigest: string,
  state: WorkroomRunState,
): WorkroomPlanGateDecisionReceipt {
  const receiptRef = `workroom-run:${input.runId}:plan-gate:${encodeURIComponent(input.operationId)}`;
  return Object.freeze({
    status,
    operationId: input.operationId,
    receiptRef,
    receiptDigest: digestCanonicalWorkroomValue({
      version: 1,
      operationId: input.operationId,
      requestDigest,
      decision: input.decision,
    }),
    state,
  });
}

function planAdmissionRunId(operationId: string): string {
  return `run-${digestCanonicalWorkroomValue({ operationId }).slice('sha256:'.length, 38)}`;
}

function planAdmissionReceipt(
  runId: string,
  operationId: string,
  sourceEventDigest: string,
  plan: WorkflowPlanProposal,
  state: WorkroomRunState,
): WorkroomPlanAdmissionReceipt {
  return Object.freeze({
    runId,
    receiptRef: `workroom-run:${runId}:plan:${encodeURIComponent(plan.proposalId)}`,
    receiptDigest: digestCanonicalWorkroomValue({
      version: 1,
      runId,
      operationId,
      planDigest: plan.digest,
      sourceEventDigest,
    }),
    state,
  });
}

function assertExactPlanAdmission(
  events: readonly import('./kernel-contracts.js').WorkroomEvent[],
  input: WorkroomPlanAdmissionInput,
  admittedPayload: Readonly<Record<string, unknown>>,
): void {
  const expectedTypes = [
    'run.created',
    'plan.admitted',
    ...input.plan.tasks.flatMap(task => [
      'task.planned',
      ...(task.approvalGate ? ['task.blocked'] : []),
    ]),
  ];
  if (events.length < expectedTypes.length
    || events.slice(0, expectedTypes.length)
      .some((event, index) => event.type !== expectedTypes[index])) {
    throw new Error('Workflow Plan operation replay conflicts with persisted Run shape');
  }
  const created = events[0]!;
  const admitted = events[1]!;
  if (created.payload.projectId !== input.projectId
    || created.payload.title !== input.title
    || canonicalWorkroomJson(admitted.payload) !== canonicalWorkroomJson(admittedPayload)) {
    throw new Error('Workflow Plan operation replay payload drift');
  }
  let cursor = 2;
  for (const task of input.plan.tasks) {
    const payload = events[cursor++]!.payload;
    const expected = {
      taskKey: task.key, title: task.title, required: task.required,
      maxAttempts: task.maxAttempts, role: task.role,
      dependsOn: task.dependsOn, requires: task.requires,
      sponsorLane: task.scheduler.sponsorLane,
      localRank: task.scheduler.localRank,
      deadline: task.scheduler.deadline,
      enqueuedAt: task.scheduler.enqueuedAt,
      preemptibility: task.scheduler.preemptibility,
      ...(task.approvalGate ? { approvalGate: task.approvalGate } : {}),
    };
    if (canonicalWorkroomJson(payload) !== canonicalWorkroomJson(expected)) {
      throw new Error('Workflow Plan operation replay Task payload drift');
    }
    if (task.approvalGate) {
      const blocker = events[cursor++]!.payload;
      const expectedBlocker = {
        taskKey: task.key,
        blockerId: task.approvalGate.id,
        kind: 'approval',
        owner: task.approvalGate.owner,
        reason: `Workflow Plan Sponsor Gate ${task.approvalGate.id}`,
        deadline: task.approvalGate.deadline,
      };
      if (canonicalWorkroomJson(blocker) !== canonicalWorkroomJson(expectedBlocker)) {
        throw new Error('Workflow Plan operation replay Sponsor Gate payload drift');
      }
    }
  }
}

function requireCanonicalText(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
    throw new Error(`Workroom Plan admission ${label} must be canonical text`);
  }
}

function requireDigest(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`Workroom Plan admission ${label} must be a canonical SHA-256 digest`);
  }
}
