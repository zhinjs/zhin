import type {
  DataGovernanceAuthorityRepository,
} from '../data-governance/governance-authority-repository.js';
import type { WorkroomCatalog } from './catalog.js';
import { digestWorkroomCatalogProjectBinding } from './catalog-definition.js';
import {
  deepFreezeWorkroomValue as deepFreeze,
  digestCanonicalWorkroomValue as digest,
} from './canonical-value.js';
import type {
  WorkroomAssignmentState,
  WorkroomBlocker,
  WorkroomBlockerKind,
  WorkroomRunStatus,
  WorkroomTaskState,
} from './kernel-contracts.js';
import type {
  WorkroomJournal,
  WorkroomStoredEventControl,
  WorkroomStoredRunHeaders,
} from './journal.js';

export interface WorkroomProjectionReadAuthorityInput {
  readonly destination: 'console';
  readonly projectId: string;
  readonly recipientPrincipalId: string;
  readonly requestedMode: 'metadata_only';
}

export interface WorkroomProjectionReadAuthority {
  readonly catalogRevision: string;
  readonly projectDigest: string;
  readonly governanceDigest: string;
  readonly bindingDigest: string;
}

/** Root-owned P12/Catalog join. Caller identity and Project scope are never accepted from content. */
export interface WorkroomProjectionReadAuthorityPort {
  authorize(
    input: WorkroomProjectionReadAuthorityInput,
  ): Promise<WorkroomProjectionReadAuthority | null>;
}

export interface WorkroomRuntimeReadInput {
  readonly projectId: string;
  readonly authenticatedPrincipal: Readonly<{ principalId: string }>;
}

export interface WorkroomTaskHeader {
  readonly version: 1;
  readonly ref: string;
  readonly status: WorkroomTaskState['status'];
  readonly revision: number;
  readonly attempt: number;
  readonly required: boolean;
  readonly blockerCount: number;
  readonly hasCurrentAssignment: boolean;
  readonly digest: string;
}

export interface WorkroomAssignmentHeader {
  readonly version: 1;
  readonly ref: string;
  readonly taskRef: string;
  readonly status: WorkroomAssignmentState['status'];
  readonly role: WorkroomAssignmentState['role'];
  readonly revision: number;
  readonly attempt: number;
  readonly fence: number;
  readonly outcome?: WorkroomAssignmentState['outcome'];
  readonly digest: string;
}

export interface WorkroomBlockerHeader {
  readonly version: 1;
  readonly taskRef: string;
  readonly blockerRef: string;
  readonly kind: WorkroomBlockerKind | 'unknown';
  readonly deadline?: number;
  readonly allowedActions: WorkroomBlocker['allowedActions'];
  readonly digest: string;
}

export interface WorkroomRunHeader {
  readonly version: 1;
  readonly projectId: string;
  readonly runId: string;
  readonly status: WorkroomRunStatus;
  readonly sequence: number;
  readonly cancelRequested: boolean;
  readonly counts: Readonly<{
    tasks: number;
    assignments: number;
    reviewerAssignments: number;
    sponsorGates: number;
  }>;
  /** Exact Catalog + P12 destination/recipient authorization used for this read. */
  readonly authorityDigest: string;
  readonly digest: string;
}

export interface WorkroomRunDetail extends WorkroomRunHeader {
  readonly tasks: readonly WorkroomTaskHeader[];
  readonly assignments: readonly WorkroomAssignmentHeader[];
  readonly blockers: readonly WorkroomBlockerHeader[];
}

export type WorkroomReadinessState = 'ready' | 'blocked' | 'needs_replan' | 'cancelling' | 'terminal';

export interface WorkroomRunReadiness {
  readonly version: 1;
  readonly projectId: string;
  readonly runId: string;
  readonly sequence: number;
  readonly state: WorkroomReadinessState;
  readonly blockers: readonly WorkroomBlockerHeader[];
  readonly recommendedActions: readonly ('resolve' | 'replan' | 'cancel')[];
  readonly authorityDigest: string;
  readonly digest: string;
}

export type WorkroomRunListResult =
  | Readonly<{ status: 'ready'; runs: readonly WorkroomRunHeader[] }>
  | Readonly<{ status: 'forbidden' }>;

export type WorkroomRunReadResult =
  | Readonly<{ status: 'ready'; run: WorkroomRunDetail }>
  | Readonly<{ status: 'not_found' }>
  | Readonly<{ status: 'forbidden' }>;

export type WorkroomRunReadinessResult =
  | Readonly<{ status: 'ready'; readiness: WorkroomRunReadiness }>
  | Readonly<{ status: 'not_found' }>
  | Readonly<{ status: 'forbidden' }>;

/** Read-only, content-free generation projection for authenticated Console inspection. */
export interface WorkroomRuntimeHandle {
  listRuns(input: WorkroomRuntimeReadInput): Promise<WorkroomRunListResult>;
  getRun(input: WorkroomRuntimeReadInput & Readonly<{ runId: string }>): Promise<WorkroomRunReadResult>;
  getReadiness(
    input: WorkroomRuntimeReadInput & Readonly<{ runId: string }>,
  ): Promise<WorkroomRunReadinessResult>;
}

export function createWorkroomRuntime(
  journal: Pick<WorkroomJournal, 'scanStoredHeaders' | 'readStoredHeaders'>,
  authority: WorkroomProjectionReadAuthorityPort,
): WorkroomRuntimeHandle {
  return Object.freeze({
    listRuns: async (input: WorkroomRuntimeReadInput): Promise<WorkroomRunListResult> => {
      const authorization = await authorizeRead(authority, input);
      if (!authorization) return Object.freeze({ status: 'forbidden' });
      const storedRuns = await journal.scanStoredHeaders();
      return deepFreeze({
        status: 'ready' as const,
        runs: storedRuns
          .map(run => projectStoredRun(run, authorization.bindingDigest))
          .filter(run => run.projectId === input.projectId)
          .map(run => runHeader(run)),
      });
    },
    getRun: async (
      input: WorkroomRuntimeReadInput & Readonly<{ runId: string }>,
    ): Promise<WorkroomRunReadResult> => {
      const authorization = await authorizeRead(authority, input);
      if (!authorization) return Object.freeze({ status: 'forbidden' });
      const stored = await journal.readStoredHeaders(input.runId);
      if (!stored) return Object.freeze({ status: 'not_found' });
      const run = projectStoredRun(stored, authorization.bindingDigest);
      if (run.projectId !== input.projectId) return Object.freeze({ status: 'not_found' });
      return deepFreeze({ status: 'ready' as const, run });
    },
    getReadiness: async (
      input: WorkroomRuntimeReadInput & Readonly<{ runId: string }>,
    ): Promise<WorkroomRunReadinessResult> => {
      const authorization = await authorizeRead(authority, input);
      if (!authorization) return Object.freeze({ status: 'forbidden' });
      const stored = await journal.readStoredHeaders(input.runId);
      if (!stored) return Object.freeze({ status: 'not_found' });
      const run = projectStoredRun(stored, authorization.bindingDigest);
      if (run.projectId !== input.projectId) return Object.freeze({ status: 'not_found' });
      const actions = new Set<'resolve' | 'replan' | 'cancel'>();
      for (const blocker of run.blockers) {
        for (const action of blocker.allowedActions) actions.add(action);
      }
      if (run.status === 'needs_replan') {
        actions.add('replan');
        actions.add('cancel');
      }
      const body = deepFreeze({
        version: 1 as const,
        projectId: run.projectId,
        runId: run.runId,
        sequence: run.sequence,
        state: readinessState(run.status),
        blockers: run.blockers,
        recommendedActions: Object.freeze(
          (['resolve', 'replan', 'cancel'] as const).filter(action => actions.has(action)),
        ),
        authorityDigest: run.authorityDigest,
      });
      return deepFreeze({
        status: 'ready' as const,
        readiness: { ...body, digest: digest(body) },
      });
    },
  });
}

/**
 * Exact authorization adapter over the current persistent Catalog and P12 Project authority.
 * Only a Catalog Sponsor that is also an exact Project-scoped recipient of a metadata-only
 * Console sink may enumerate Project Run headers.
 */
export function createCatalogGovernedWorkroomProjectionAuthority(options: Readonly<{
  catalog: Pick<WorkroomCatalog, 'read'>;
  governance: Pick<DataGovernanceAuthorityRepository, 'readProject'>;
}>): WorkroomProjectionReadAuthorityPort {
  return createCatalogGovernedConsoleDisclosureAuthority(options, { requireSponsor: true });
}

/** Current Catalog + P12 Console recipient join for root-authorized non-Sponsor control planes. */
export function createCatalogGovernedConsoleDisclosureAuthority(options: Readonly<{
  catalog: Pick<WorkroomCatalog, 'read'>;
  governance: Pick<DataGovernanceAuthorityRepository, 'readProject'>;
}>, policy: Readonly<{ requireSponsor: boolean }> = { requireSponsor: false }): WorkroomProjectionReadAuthorityPort {
  return Object.freeze({
    async authorize(input: WorkroomProjectionReadAuthorityInput) {
      if (input.destination !== 'console' || input.requestedMode !== 'metadata_only'
        || !input.projectId.trim() || !input.recipientPrincipalId.trim()) return null;
      const catalog = await options.catalog.read();
      const definition = catalog.definitions[input.projectId];
      if (!definition || definition.enabled === false
        || policy.requireSponsor && !definition.sponsors?.includes(input.recipientPrincipalId)) return null;
      const projectDigest = digestWorkroomCatalogProjectBinding(definition);
      const governance = await options.governance.readProject(input.projectId);
      if (!governance
        || governance.governanceDecision.catalogRevision !== catalog.revision
        || governance.governanceDecision.catalogBindingDigest !== projectDigest) return null;
      const sinkEntry = Object.entries(governance.sinks).find(([, sink]) => {
        if (sink.channel !== 'console' || sink.requestedMode !== 'metadata_only'
          || sink.fixedPrincipalId !== undefined && sink.fixedPrincipalId !== input.recipientPrincipalId
          || !sink.principal.allowedPurposes.includes(sink.purpose)) return false;
        const destination = governance.policy.destinations[sink.destinationId];
        if (!destination
          || destination.recipientSnapshotRevision !== sink.recipients.revision
          || destination.recipientSnapshotDigest !== sink.recipients.digest) return false;
        return sink.recipients.recipients.some(recipient => (
          recipient.principalId === input.recipientPrincipalId
          && recipient.projectId === input.projectId
        ));
      });
      if (!sinkEntry) return null;
      const [sinkRuleId, sink] = sinkEntry;
      const bindingDigest = digest({
        version: 1,
        destination: 'console',
        requestedMode: 'metadata_only',
        projectId: input.projectId,
        recipientPrincipalId: input.recipientPrincipalId,
        catalogRevision: catalog.revision,
        projectDigest,
        governanceDigest: governance.digest,
        sinkRuleId,
        destinationId: sink.destinationId,
        recipientRevision: sink.recipients.revision,
        recipientDigest: sink.recipients.digest,
      });
      return deepFreeze({
        catalogRevision: catalog.revision,
        projectDigest,
        governanceDigest: governance.digest,
        bindingDigest,
      });
    },
  });
}

async function authorizeRead(
  authority: WorkroomProjectionReadAuthorityPort,
  input: WorkroomRuntimeReadInput,
): Promise<WorkroomProjectionReadAuthority | null> {
  const projectId = input.projectId.trim();
  const recipientPrincipalId = input.authenticatedPrincipal.principalId.trim();
  if (!projectId || projectId !== input.projectId || !recipientPrincipalId) return null;
  return await authority.authorize({
    destination: 'console', projectId, recipientPrincipalId, requestedMode: 'metadata_only',
  });
}

interface ProjectedTask {
  readonly key: string;
  status: WorkroomTaskState['status'];
  revision: number;
  attempt: number;
  maxAttempts: number;
  required: boolean;
  readonly blockers: Map<string, Readonly<{
    kind: WorkroomBlockerKind | 'unknown';
    deadline?: number;
    allowedActions: WorkroomBlocker['allowedActions'];
  }>>;
  currentAssignmentId?: string;
  currentReviewerAssignmentId?: string;
  currentSponsorGateId?: string;
}

interface ProjectedAssignment {
  readonly id: string;
  readonly taskKey: string;
  status: WorkroomAssignmentState['status'];
  readonly role: WorkroomAssignmentState['role'];
  readonly revision: number;
  readonly attempt: number;
  readonly fence: number;
  outcome?: WorkroomAssignmentState['outcome'];
}

function projectStoredRun(
  stored: WorkroomStoredRunHeaders,
  authorityDigest: string,
): WorkroomRunDetail {
  const first = stored.events[0];
  if (!first || first.sequence !== 0 || first.type !== 'run.created') {
    throw new Error('Stored Workroom header replay must begin with run.created');
  }
  const projectId = headerText(first.control, 'projectId');
  const tasks = new Map<string, ProjectedTask>();
  const assignments = new Map<string, ProjectedAssignment>();
  const reviewerStatuses = new Map<string, string>();
  const sponsorStatuses = new Map<string, string>();
  let cancelRequested = false;
  let replanRequested = false;
  let explicitlyCancelled = false;
  for (const event of stored.events) {
    const payload = event.control;
    switch (event.type) {
      case 'run.created':
      case 'plan.admitted':
      case 'plan_gate.decided':
      case 'run.control_decided':
      case 'local_execution.requested':
      case 'remote_dispatch.requested':
      case 'scheduler.dispatch_requested':
      case 'scheduler.priority_changed':
      case 'scheduler.preemption_requested':
      case 'scheduler.preemption_checkpoint_acknowledged':
      case 'scheduler.preemption_timed_out':
      case 'assignment.checkpoint_requested':
      case 'clock.advanced': break;
      case 'plan.revision_applied': replanRequested = false; break;
      case 'run.replan_requested': replanRequested = true; break;
      case 'run.cancel_requested': cancelRequested = true; break;
      case 'run.cancelled': explicitlyCancelled = true; break;
      case 'task.planned': {
        const key = headerText(payload, 'taskKey');
        if (tasks.has(key)) throw new Error('Stored Workroom header contains duplicate Task');
        tasks.set(key, {
          key, status: 'ready', revision: 1, attempt: 0,
          maxAttempts: headerPositiveInteger(payload, 'maxAttempts'),
          required: payload.required === true, blockers: new Map(),
        });
        break;
      }
      case 'task.blocked': {
        const task = requireProjectedTask(tasks, payload);
        task.blockers.set(headerText(payload, 'blockerId'), Object.freeze({
          kind: payload.blockerKind === undefined ? 'unknown' : headerBlockerKind(payload.blockerKind),
          ...(payload.blockerDeadline === undefined
            ? {}
            : { deadline: headerNonNegativeInteger(payload, 'blockerDeadline') }),
          allowedActions: payload.blockerAllowedActions === undefined
            ? Object.freeze(['resolve', 'replan', 'cancel'] as const)
            : headerBlockerActions(payload.blockerAllowedActions),
        }));
        task.status = 'blocked';
        break;
      }
      case 'task.blocker_resolved': {
        const task = requireProjectedTask(tasks, payload);
        task.blockers.delete(headerText(payload, 'blockerId'));
        task.status = task.blockers.size > 0 ? 'blocked' : 'ready';
        break;
      }
      case 'assignment.claimed': {
        const task = requireProjectedTask(tasks, payload);
        const id = headerText(payload, 'assignmentId');
        if (assignments.has(id)) throw new Error('Stored Workroom header contains duplicate Assignment');
        const assignment: ProjectedAssignment = {
          id,
          taskKey: task.key,
          status: 'leased',
          role: headerRole(payload.role),
          revision: headerPositiveInteger(payload, 'assignmentRevision'),
          attempt: headerPositiveInteger(payload, 'attempt'),
          fence: headerPositiveInteger(payload, 'fence'),
        };
        assignments.set(id, assignment);
        task.status = 'executing';
        task.attempt = assignment.attempt;
        task.currentAssignmentId = id;
        break;
      }
      case 'assignment.started':
        requireProjectedAssignment(assignments, payload).status = 'running';
        break;
      case 'assignment.progress':
      case 'assignment.heartbeat':
      case 'assignment.checkpointed':
        requireProjectedAssignment(assignments, payload);
        break;
      case 'assignment.preempted': {
        const assignment = requireProjectedAssignment(assignments, payload);
        assignment.status = 'cancelled'; assignment.outcome = 'interrupted';
        const task = requireProjectedTaskByKey(tasks, assignment.taskKey);
        task.status = 'ready'; task.currentAssignmentId = undefined;
        break;
      }
      case 'assignment.execution_completed': {
        const assignment = requireProjectedAssignment(assignments, payload);
        assignment.status = 'execution_completed';
        requireProjectedTaskByKey(tasks, assignment.taskKey).status = 'awaiting_acceptance';
        break;
      }
      case 'assignment.cancel_requested': {
        const assignment = requireProjectedAssignment(assignments, payload);
        assignment.status = 'cancel_requested';
        requireProjectedTaskByKey(tasks, assignment.taskKey).status = 'cancelling';
        break;
      }
      case 'assignment.cancelled': {
        const assignment = requireProjectedAssignment(assignments, payload);
        assignment.status = 'cancelled'; assignment.outcome = headerOutcome(payload.outcome);
        requireProjectedTaskByKey(tasks, assignment.taskKey).status = 'cancelled';
        break;
      }
      case 'assignment.lease_expired': {
        const assignment = requireProjectedAssignment(assignments, payload);
        assignment.status = 'lost'; assignment.outcome = 'outcome_unknown';
        const task = requireProjectedTaskByKey(tasks, assignment.taskKey);
        task.status = task.attempt >= task.maxAttempts ? 'failed' : 'ready';
        if (task.status === 'ready') task.currentAssignmentId = undefined;
        break;
      }
      case 'task.accepted': {
        const task = requireProjectedTask(tasks, payload);
        task.status = 'accepted';
        task.currentReviewerAssignmentId = undefined;
        task.currentSponsorGateId = undefined;
        break;
      }
      case 'task.acceptance_pinned':
      case 'task.acceptance_blocked':
        requireProjectedTask(tasks, payload);
        break;
      case 'reviewer.assigned': {
        const task = requireProjectedTask(tasks, payload);
        const id = headerText(payload, 'waitId');
        reviewerStatuses.set(id, headerText(payload, 'waitStatus'));
        task.currentReviewerAssignmentId = id;
        task.currentSponsorGateId = undefined;
        break;
      }
      case 'reviewer.claimed': {
        const id = headerText(payload, 'waitId');
        requireHeaderWait(reviewerStatuses, id, 'Reviewer Assignment');
        reviewerStatuses.set(id, 'claimed');
        break;
      }
      case 'reviewer.verdict_recorded': {
        const id = headerText(payload, 'waitId');
        requireHeaderWait(reviewerStatuses, id, 'Reviewer Assignment');
        reviewerStatuses.set(id, payload.verdictOutcome === 'passed' ? 'passed' : 'rework');
        break;
      }
      case 'reviewer.expired': {
        const id = headerText(payload, 'waitId');
        requireHeaderWait(reviewerStatuses, id, 'Reviewer Assignment');
        reviewerStatuses.set(id, 'expired');
        break;
      }
      case 'sponsor_gate.opened': {
        const task = requireProjectedTask(tasks, payload);
        const id = headerText(payload, 'waitId');
        sponsorStatuses.set(id, headerText(payload, 'waitStatus'));
        task.currentSponsorGateId = id;
        task.currentReviewerAssignmentId = undefined;
        break;
      }
      case 'sponsor_gate.decided': {
        const id = headerText(payload, 'waitId');
        requireHeaderWait(sponsorStatuses, id, 'Sponsor Gate');
        sponsorStatuses.set(id, payload.decision === 'approve' ? 'approved'
          : payload.decision === 'request_changes' ? 'changes_requested'
            : payload.decision === 'reject' ? 'rejected' : 'cancelled');
        break;
      }
      case 'sponsor_gate.expired': {
        const id = headerText(payload, 'waitId');
        requireHeaderWait(sponsorStatuses, id, 'Sponsor Gate');
        sponsorStatuses.set(id, 'expired');
        break;
      }
      case 'task.rework_requested':
      case 'task.revised': {
        const task = requireProjectedTask(tasks, payload);
        resetProjectedTask(task);
        task.revision += 1;
        if (event.type === 'task.revised') {
          task.maxAttempts = headerPositiveInteger(payload, 'maxAttempts');
        }
        break;
      }
      case 'task.plan_revised': {
        const task = requireProjectedTask(tasks, payload);
        resetProjectedTask(task);
        task.revision = headerPositiveInteger(payload, 'newTaskRevision');
        task.maxAttempts = headerPositiveInteger(payload, 'maxAttempts');
        task.required = payload.required === true;
        task.blockers.clear();
        break;
      }
      case 'task.cancel_requested': requireProjectedTask(tasks, payload).status = 'cancelling'; break;
      case 'task.cancelled': requireProjectedTask(tasks, payload).status = 'cancelled'; break;
      case 'task.failed': requireProjectedTask(tasks, payload).status = 'failed'; break;
    }
  }
  const taskValues = [...tasks.values()];
  const status = deriveHeaderRunStatus(
    taskValues, reviewerStatuses, sponsorStatuses, cancelRequested, replanRequested,
    explicitlyCancelled,
  );
  const taskHeaders = taskValues.map(task => projectTaskHeader(task));
  const assignmentHeaders = [...assignments.values()].map(assignment =>
    projectAssignmentHeader(assignment));
  const blockerHeaders = taskValues.flatMap(task => [...task.blockers.entries()].map(
    ([blockerRef, blocker]) => projectBlockerHeader(task.key, blockerRef, blocker),
  ));
  const body = deepFreeze({
    version: 1 as const,
    projectId,
    runId: stored.runId,
    status,
    sequence: stored.events.at(-1)?.sequence ?? -1,
    cancelRequested,
    counts: {
      tasks: tasks.size,
      assignments: assignments.size,
      reviewerAssignments: reviewerStatuses.size,
      sponsorGates: sponsorStatuses.size,
    },
    authorityDigest,
    tasks: taskHeaders,
    assignments: assignmentHeaders,
    blockers: blockerHeaders,
  });
  return deepFreeze({ ...body, digest: digest(body) });
}

function runHeader(detail: WorkroomRunDetail): WorkroomRunHeader {
  const body = deepFreeze({
    version: detail.version,
    projectId: detail.projectId,
    runId: detail.runId,
    status: detail.status,
    sequence: detail.sequence,
    cancelRequested: detail.cancelRequested,
    counts: detail.counts,
    authorityDigest: detail.authorityDigest,
  });
  return deepFreeze({ ...body, digest: digest(body) });
}

function projectTaskHeader(task: ProjectedTask): WorkroomTaskHeader {
  const body = deepFreeze({
    version: 1 as const,
    ref: task.key,
    status: task.status,
    revision: task.revision,
    attempt: task.attempt,
    required: task.required,
    blockerCount: task.blockers.size,
    hasCurrentAssignment: task.currentAssignmentId !== undefined,
  });
  return deepFreeze({ ...body, digest: digest(body) });
}

function projectAssignmentHeader(
  assignment: ProjectedAssignment,
): WorkroomAssignmentHeader {
  const body = deepFreeze({
    version: 1 as const,
    ref: assignment.id,
    taskRef: assignment.taskKey,
    status: assignment.status,
    role: assignment.role,
    revision: assignment.revision,
    attempt: assignment.attempt,
    fence: assignment.fence,
    ...(assignment.outcome === undefined ? {} : { outcome: assignment.outcome }),
  });
  return deepFreeze({ ...body, digest: digest(body) });
}

function projectBlockerHeader(
  taskRef: string,
  blockerRef: string,
  blocker: Readonly<{
    kind: WorkroomBlockerKind | 'unknown';
    deadline?: number;
    allowedActions: WorkroomBlocker['allowedActions'];
  }>,
): WorkroomBlockerHeader {
  const body = deepFreeze({
    version: 1 as const,
    taskRef,
    blockerRef,
    kind: blocker.kind,
    ...(blocker.deadline === undefined ? {} : { deadline: blocker.deadline }),
    allowedActions: blocker.allowedActions,
  });
  return deepFreeze({ ...body, digest: digest(body) });
}

function requireProjectedTask(
  tasks: ReadonlyMap<string, ProjectedTask>,
  payload: WorkroomStoredEventControl,
): ProjectedTask {
  return requireProjectedTaskByKey(tasks, headerText(payload, 'taskKey'));
}

function requireProjectedTaskByKey(
  tasks: ReadonlyMap<string, ProjectedTask>,
  key: string,
): ProjectedTask {
  const task = tasks.get(key);
  if (!task) throw new Error(`Stored Workroom header references unknown Task ${key}`);
  return task;
}

function requireProjectedAssignment(
  assignments: ReadonlyMap<string, ProjectedAssignment>,
  payload: WorkroomStoredEventControl,
): ProjectedAssignment {
  const id = headerText(payload, 'assignmentId');
  const assignment = assignments.get(id);
  if (!assignment) throw new Error(`Stored Workroom header references unknown Assignment ${id}`);
  return assignment;
}

function resetProjectedTask(task: ProjectedTask): void {
  task.status = 'ready';
  task.attempt = 0;
  task.currentAssignmentId = undefined;
  task.currentReviewerAssignmentId = undefined;
  task.currentSponsorGateId = undefined;
}

function deriveHeaderRunStatus(
  tasks: readonly ProjectedTask[],
  reviewers: ReadonlyMap<string, string>,
  sponsors: ReadonlyMap<string, string>,
  cancelRequested: boolean,
  replanRequested: boolean,
  explicitlyCancelled: boolean,
): WorkroomRunStatus {
  if (explicitlyCancelled) return 'cancelled';
  if (cancelRequested) return 'cancelling';
  if (replanRequested) return 'needs_replan';
  const terminal = new Set<WorkroomTaskState['status']>(['accepted', 'failed', 'cancelled']);
  if (tasks.length > 0 && tasks.every(task =>
    task.status === 'accepted' || !task.required && terminal.has(task.status))) return 'completed';
  if (tasks.some(task => task.required && (task.status === 'failed' || task.status === 'cancelled'))) {
    return 'needs_replan';
  }
  if (tasks.some(task => (
    task.currentReviewerAssignmentId !== undefined
      && reviewers.get(task.currentReviewerAssignmentId) === 'expired'
  ) || (
    task.currentSponsorGateId !== undefined
      && sponsors.get(task.currentSponsorGateId) === 'expired'
  ))) return 'blocked';
  return tasks.some(task => task.status === 'blocked') ? 'blocked' : 'active';
}

function readinessState(status: WorkroomRunStatus): WorkroomReadinessState {
  if (status === 'completed' || status === 'cancelled') return 'terminal';
  if (status === 'active') return 'ready';
  return status;
}

function headerText(payload: object, key: string): string {
  const value = Reflect.get(payload, key) as unknown;
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Stored Workroom header ${key} is invalid`);
  }
  return value;
}

function headerNonNegativeInteger(payload: object, key: string): number {
  const value = Reflect.get(payload, key) as unknown;
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`Stored Workroom header ${key} is invalid`);
  }
  return Number(value);
}

function headerBlockerKind(value: unknown): WorkroomBlockerKind {
  if (value !== 'dependency' && value !== 'approval' && value !== 'capability'
    && value !== 'external' && value !== 'human_input') {
    throw new Error('Stored Workroom header blockerKind is invalid');
  }
  return value;
}

function headerBlockerActions(value: unknown): WorkroomBlocker['allowedActions'] {
  if (!Array.isArray(value)
    || JSON.stringify(value) !== JSON.stringify(['resolve', 'replan', 'cancel'])) {
    throw new Error('Stored Workroom header blockerAllowedActions are invalid');
  }
  return Object.freeze([...value]) as WorkroomBlocker['allowedActions'];
}

function headerPositiveInteger(payload: object, key: string): number {
  const value = Reflect.get(payload, key) as unknown;
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new Error(`Stored Workroom header ${key} is invalid`);
  }
  return Number(value);
}

function headerRole(value: unknown): WorkroomAssignmentState['role'] {
  if (value !== 'executor' && value !== 'reviewer' && value !== 'integration') {
    throw new Error('Stored Workroom header Assignment role is invalid');
  }
  return value;
}

function headerOutcome(value: unknown): WorkroomAssignmentState['outcome'] {
  if (value !== 'interrupted' && value !== 'committed' && value !== 'outcome_unknown') {
    throw new Error('Stored Workroom header Assignment outcome is invalid');
  }
  return value;
}

function requireHeaderWait(statuses: ReadonlyMap<string, string>, id: string, label: string): void {
  if (!statuses.has(id)) throw new Error(`Stored Workroom header references unknown ${label} ${id}`);
}
