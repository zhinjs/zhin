import { randomUUID } from 'node:crypto';
import type {
  WorkroomCommand,
  WorkroomEventDraft,
  WorkroomEventType,
  WorkroomRunState,
} from './kernel-contracts.js';
import type { WorkroomJournal } from './journal.js';
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
}

/** The sole command and state-transition authority for Workroom Run facts. */
export class WorkroomKernel {
  readonly #journal: WorkroomJournal;
  readonly #now: () => number;
  readonly #createId: () => string;
  readonly #acceptancePolicy?: WorkroomAcceptancePolicyDecisionPort;
  readonly #acceptanceAuthority?: WorkroomAcceptanceAuthorityPort;

  constructor(options: WorkroomKernelOptions) {
    this.#journal = options.journal;
    this.#now = options.now ?? Date.now;
    this.#createId = options.createId ?? (() => randomUUID());
    this.#acceptancePolicy = options.acceptancePolicy;
    this.#acceptanceAuthority = options.acceptanceAuthority;
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

  async execute(projectId: string, runId: string, command: WorkroomCommand): Promise<WorkroomRunState> {
    assertProjectId(projectId);
    const scopedProjectId = projectId.trim();
    assertRunId(runId);
    const state = await this.#readUnscoped(runId);
    assertProject(state, scopedProjectId);
    const drafts = decideWorkroom(state, command, (type, payload) => this.#event(type, payload));
    await this.#journal.append(runId, state.sequence, drafts);
    return drafts.length === 0 ? state : this.read(scopedProjectId, runId);
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

  #event(type: WorkroomEventType, payload: Record<string, unknown>): WorkroomEventDraft {
    return Object.freeze({
      eventId: this.#createId(),
      occurredAt: this.#now(),
      type,
      payload: Object.freeze({ ...payload }),
    });
  }
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
