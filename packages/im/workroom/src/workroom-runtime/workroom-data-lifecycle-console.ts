import {
  canonicalWorkroomJson,
  compareCanonicalWorkroomText,
  deepFreezeWorkroomValue as deepFreeze,
  digestCanonicalWorkroomValue as digest,
} from '../workroom/canonical-value.js';
import type { WorkroomProjectionReadAuthorityPort } from '../workroom/runtime.js';
import {
  createPayloadLifecycleClockSnapshot,
  type PayloadLifecycleControlPort,
  type PayloadLifecycleClockSnapshot,
  type PayloadLifecycleKernelClockPort,
  type PayloadLifecycleRole,
  type PayloadLifecycleState,
  type PayloadSubjectErasureResolverPort,
} from '../data-governance/payload-lifecycle.js';
import { PayloadRetentionHoldOverdueProjection } from '../data-governance/payload-hold-overdue-projection.js';

export type WorkroomDataLifecycleConsoleAction =
  | 'display'
  | 'list_overdue'
  | 'place_hold'
  | 'review_hold'
  | 'release_hold'
  | 'request_subject_erasure'
  | 'export_subject'
  | 'purge_expired'
  | 'reconcile_purge';

export interface WorkroomDataLifecycleConsoleAuthorityRequest {
  readonly version: 1;
  readonly generation: number;
  readonly action: WorkroomDataLifecycleConsoleAction;
  readonly requiredRoles: readonly PayloadLifecycleRole[];
  readonly operationId: string;
  readonly authenticatedPrincipalId: string;
  readonly tenantId?: string;
  readonly projectId: string;
  readonly objectId?: string;
  readonly subjectExportCandidate?: WorkroomDataLifecycleSubjectExportCandidate;
  readonly digest: string;
}

export interface WorkroomDataLifecycleConsoleAuthorityDecision {
  readonly approved: true;
  readonly requestDigest: string;
  readonly principalId: string;
  readonly role: PayloadLifecycleRole;
  readonly authorityDigest: string;
}

/** Root-private role membership. It is never reachable from Runtime snapshots. */
export interface WorkroomDataLifecycleConsoleAuthorityPort {
  authorize(
    request: WorkroomDataLifecycleConsoleAuthorityRequest,
  ): Promise<WorkroomDataLifecycleConsoleAuthorityDecision | null>;
  /** Durable create-only/idempotent audit. Implementations must persist only the exact record supplied. */
  persistSubjectExportAudit?(
    record: WorkroomDataLifecycleSubjectExportAuditRecord,
  ): Promise<WorkroomDataLifecycleSubjectExportAuditReceipt | null>;
}

export type WorkroomDataLifecycleConsoleCommand =
  | Readonly<{ kind: 'place_hold'; operationId: string; projectId: string; objectId: string;
      holdId: string; reasonCode: 'legal_hold' | 'investigation' | 'regulatory_preservation'; reviewAt: number }>
  | Readonly<{ kind: 'review_hold'; operationId: string; projectId: string; objectId: string;
      holdId: string; approved: boolean }>
  | Readonly<{ kind: 'release_hold'; operationId: string; projectId: string; objectId: string; holdId: string }>
  | Readonly<{ kind: 'request_subject_erasure'; operationId: string;
      tenantId: string; projectId: string; subjectRef: string }>
  | Readonly<{ kind: 'export_subject'; operationId: string;
      tenantId: string; projectId: string; subjectRef: string; deadline: number }>
  | Readonly<{ kind: 'purge_expired'; operationId: string; projectId: string; objectId: string }>
  | Readonly<{ kind: 'reconcile_purge'; operationId: string; projectId: string; objectId: string; purgeId: string }>;

export interface WorkroomDataLifecycleProjection {
  readonly version: 1;
  readonly projectId: string;
  readonly objectId: string;
  readonly sequence: number;
  readonly stateDigest: string;
  readonly authorityDigest: string;
  readonly retention?: Readonly<{
    class: 'transient' | 'operational' | 'project_record' | 'regulated_record';
    minimumRetainUntil: number;
    deleteAfter: number;
  }>;
  readonly holds: readonly Readonly<{
    holdId: string;
    reasonCode: 'legal_hold' | 'investigation' | 'regulatory_preservation';
    placedAt: number;
    reviewAt: number;
    status: 'active' | 'review_overdue' | 'review_rejected' | 'reviewed' | 'released';
  }>[];
  readonly erasures: readonly Readonly<{ subjectDigest: string; requestedAt: number }>[];
  readonly purges: readonly Readonly<{
    purgeId: string;
    locationId: string;
    reason: 'retention_expired' | 'subject_erasure';
    attempt: number;
    status: 'pending' | 'confirmed' | 'failed' | 'outcome_unknown';
  }>[];
  readonly cryptoErased: boolean;
  readonly purgeComplete: boolean;
  readonly digest: string;
}

export interface WorkroomDataLifecycleOverdueProjection {
  readonly projectId: string;
  readonly objectId: string;
  readonly holdId: string;
  readonly reviewAt: number;
  readonly stateDigest: string;
}

export interface WorkroomDataLifecycleSubjectExportProjection {
  readonly version: 1;
  readonly tenantId: string;
  readonly projectId: string;
  readonly subjectDigest: string;
  readonly resolverAuthorityDigest: string;
  readonly resolutionDigest: string;
  readonly authorityDigest: string;
  readonly candidateDigest: string;
  readonly auditReceiptDigest: string;
  readonly objects: readonly WorkroomDataLifecycleProjection[];
  readonly digest: string;
}

export interface WorkroomDataLifecycleSubjectExportCandidate {
  readonly version: 1;
  readonly generation: number;
  readonly tenantId: string;
  readonly projectId: string;
  readonly subjectDigest: string;
  readonly resolverAuthorityDigest: string;
  readonly resolutionDigest: string;
  readonly objects: readonly Readonly<{ objectId: string; stateDigest: string }>[];
  readonly observedAt: number;
  readonly clockRevision: number;
  readonly clockDigest: string;
  readonly deadline: number;
  readonly digest: string;
}

/** Content-free durable audit input. Raw subject refs, request bodies and plaintext never enter this record. */
export interface WorkroomDataLifecycleSubjectExportAuditRecord {
  readonly version: 1;
  readonly operationDigest: string;
  readonly principalDigest: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly subjectDigest: string;
  readonly resolverAuthorityDigest: string;
  readonly resolutionDigest: string;
  readonly candidateDigest: string;
  readonly authorizationDigest: string;
  readonly observedAt: number;
  readonly clockRevision: number;
  readonly clockDigest: string;
  readonly validatedAt: number;
  readonly validationClockRevision: number;
  readonly validationClockDigest: string;
  readonly deadline: number;
  readonly objectStateDigests: readonly Readonly<{ objectId: string; stateDigest: string }>[];
  readonly digest: string;
}

export interface WorkroomDataLifecycleSubjectExportAuditReceipt {
  readonly version: 1;
  readonly recordDigest: string;
  readonly persistedAt: number;
  readonly authorityDigest: string;
  readonly digest: string;
}

export type WorkroomDataLifecycleConsoleReadResult =
  | Readonly<{ status: 'ready'; projection: WorkroomDataLifecycleProjection }>
  | Readonly<{ status: 'forbidden' }>;

export type WorkroomDataLifecycleConsoleExecuteResult =
  | Readonly<{ status: 'ready'; projection: WorkroomDataLifecycleProjection }>
  | Readonly<{ status: 'ready'; projections: readonly WorkroomDataLifecycleProjection[] }>
  | Readonly<{ status: 'ready'; export: WorkroomDataLifecycleSubjectExportProjection }>
  | Readonly<{ status: 'stale'; candidateDigest: string }>
  | Readonly<{ status: 'unavailable'; reason: 'subject_export_audit' }>
  | Readonly<{ status: 'forbidden' }>;

export interface WorkroomDataLifecycleConsoleControlPort {
  read(
    input: Readonly<{ projectId: string; objectId: string }>,
    authenticatedPrincipal: Readonly<{ principalId: string }>,
  ): Promise<WorkroomDataLifecycleConsoleReadResult>;
  listOverdue(
    input: Readonly<{ operationId: string; projectId: string }>,
    authenticatedPrincipal: Readonly<{ principalId: string }>,
  ): Promise<Readonly<{ status: 'ready'; items: readonly WorkroomDataLifecycleOverdueProjection[] }>
    | Readonly<{ status: 'forbidden' }>>;
  execute(
    command: WorkroomDataLifecycleConsoleCommand,
    authenticatedPrincipal: Readonly<{ principalId: string }>,
    signal: AbortSignal,
  ): Promise<WorkroomDataLifecycleConsoleExecuteResult>;
}

export function createWorkroomDataLifecycleConsoleControl(options: Readonly<{
  generation: number;
  control: PayloadLifecycleControlPort;
  read(projectId: string, objectId: string): Promise<PayloadLifecycleState>;
  listObjectIds(projectId: string): Promise<readonly string[]>;
  clock: PayloadLifecycleKernelClockPort;
  subjects: PayloadSubjectErasureResolverPort;
  authority: WorkroomDataLifecycleConsoleAuthorityPort;
  disclosure: WorkroomProjectionReadAuthorityPort;
  overdueProjection?: PayloadRetentionHoldOverdueProjection;
}>): WorkroomDataLifecycleConsoleControlPort {
  positive(options.generation, 'Data Lifecycle Console generation');
  const overdueProjection = options.overdueProjection ?? new PayloadRetentionHoldOverdueProjection({
    source: Object.freeze({
      listObjectIds: options.listObjectIds,
      read: async (projectId: string, objectId: string) => {
        const state = await options.read(projectId, objectId);
        return Object.freeze({
          projectId: state.projectId,
          objectId: state.objectId,
          stateSequence: state.sequence,
          stateDigest: state.digest,
          holds: state.holds,
        });
      },
    }),
    clock: options.clock,
  });

  const authorize = async (input: Readonly<{
    action: WorkroomDataLifecycleConsoleAction;
    operationId: string;
    principalId: string;
    projectId: string;
    objectId?: string;
    tenantId?: string;
    subjectExportCandidate?: WorkroomDataLifecycleSubjectExportCandidate;
  }>): Promise<Readonly<{ authorityDigest: string }> | null> => {
    const requiredRoles = rolesFor(input.action);
    const body = deepFreeze({
      version: 1 as const,
      generation: options.generation,
      action: input.action,
      requiredRoles,
      operationId: text(input.operationId, 'Data Lifecycle Console operationId'),
      authenticatedPrincipalId: text(input.principalId, 'Data Lifecycle Console principal'),
      ...(input.tenantId === undefined ? {} : { tenantId: text(input.tenantId, 'Data Lifecycle Console tenantId') }),
      projectId: text(input.projectId, 'Data Lifecycle Console projectId'),
      ...(input.objectId === undefined ? {} : { objectId: text(input.objectId, 'Data Lifecycle Console objectId') }),
      ...(input.subjectExportCandidate === undefined
        ? {}
        : { subjectExportCandidate: validateSubjectExportCandidate(input.subjectExportCandidate, options.generation) }),
    });
    const request = deepFreeze<WorkroomDataLifecycleConsoleAuthorityRequest>({
      ...body,
      digest: digest(body),
    });
    const decision = await options.authority.authorize(request);
    if (!decision || decision.approved !== true || decision.requestDigest !== request.digest
      || decision.principalId !== request.authenticatedPrincipalId
      || !request.requiredRoles.includes(decision.role)
      || !isDigest(decision.authorityDigest)) return null;
    const disclosure = await options.disclosure.authorize({
      destination: 'console',
      projectId: request.projectId,
      recipientPrincipalId: request.authenticatedPrincipalId,
      requestedMode: 'metadata_only',
    });
    if (!disclosure) return null;
    return deepFreeze({ authorityDigest: digest({
      version: 1,
      requestDigest: request.digest,
      roleAuthorityDigest: decision.authorityDigest,
      disclosureBindingDigest: disclosure.bindingDigest,
    }) });
  };

  const read = async (
    input: Readonly<{ projectId: string; objectId: string }>,
    authenticatedPrincipal: Readonly<{ principalId: string }>,
  ): Promise<WorkroomDataLifecycleConsoleReadResult> => {
    exactKeys(input, ['projectId', 'objectId'], 'Data Lifecycle display input');
    const projectId = text(input.projectId, 'Data Lifecycle Console projectId');
    const objectId = text(input.objectId, 'Data Lifecycle Console objectId');
    const authorization = await authorize({
      action: 'display',
      operationId: `console:data-lifecycle:display:${encodeURIComponent(projectId)}:${encodeURIComponent(objectId)}`,
      principalId: authenticatedPrincipal?.principalId,
      projectId,
      objectId,
    });
    if (!authorization) return deepFreeze({ status: 'forbidden' as const });
    const state = await options.read(projectId, objectId);
    const now = await readClock(options.clock, `console:data-lifecycle:display:${state.sequence}`, projectId, objectId);
    return deepFreeze({
      status: 'ready' as const,
      projection: projectState(state, authorization.authorityDigest, now),
    });
  };

  const listOverdue = async (
    input: Readonly<{ operationId: string; projectId: string }>,
    authenticatedPrincipal: Readonly<{ principalId: string }>,
  ) => {
    exactKeys(input, ['operationId', 'projectId'], 'Data Lifecycle overdue input');
    const authorization = await authorize({
      action: 'list_overdue',
      operationId: input.operationId,
      principalId: authenticatedPrincipal?.principalId,
      projectId: input.projectId,
    });
    if (!authorization) return deepFreeze({ status: 'forbidden' as const });
    const overdue = await overdueProjection.project(input.projectId, new AbortController().signal);
    return deepFreeze({
      status: 'ready' as const,
      items: overdue.overdue.map(item => deepFreeze({
        projectId: overdue.projectId,
        objectId: item.objectId,
        holdId: item.holdId,
        reviewAt: item.reviewAt,
        stateDigest: item.stateDigest,
      })),
    });
  };

  const execute = async (
    input: WorkroomDataLifecycleConsoleCommand,
    authenticatedPrincipal: Readonly<{ principalId: string }>,
    signal: AbortSignal,
  ): Promise<WorkroomDataLifecycleConsoleExecuteResult> => {
    signal.throwIfAborted();
    const command = parseCommand(input);
    const principalId = text(authenticatedPrincipal?.principalId, 'Data Lifecycle Console principal');
    if (command.kind === 'export_subject') {
      if (typeof options.authority.persistSubjectExportAudit !== 'function') {
        return deepFreeze({ status: 'unavailable' as const, reason: 'subject_export_audit' as const });
      }
      const candidate = await buildSubjectExportCandidate(options, command, signal);
      const authorization = await authorize({
        action: command.kind,
        operationId: command.operationId,
        principalId,
        projectId: command.projectId,
        tenantId: command.tenantId,
        subjectExportCandidate: candidate,
      });
      if (!authorization) return deepFreeze({ status: 'forbidden' as const });
      const current = await revalidateSubjectExportCandidate(options, command, candidate, signal);
      if (!current) {
        return deepFreeze({ status: 'stale' as const, candidateDigest: candidate.digest });
      }
      const auditRecord = createSubjectExportAuditRecord({
        operationId: command.operationId,
        principalId,
        candidate,
        authorizationDigest: authorization.authorityDigest,
        validatedClock: current.clock,
      });
      const auditReceipt = await options.authority.persistSubjectExportAudit(auditRecord);
      if (!auditReceipt) {
        return deepFreeze({ status: 'unavailable' as const, reason: 'subject_export_audit' as const });
      }
      validateSubjectExportAuditReceipt(auditReceipt, auditRecord, current.clock.now);
      const objects = current.states.map(state =>
        projectState(state, authorization.authorityDigest, current.clock.now));
      const body = deepFreeze({
        version: 1 as const,
        tenantId: command.tenantId,
        projectId: command.projectId,
        subjectDigest: candidate.subjectDigest,
        resolverAuthorityDigest: candidate.resolverAuthorityDigest,
        resolutionDigest: candidate.resolutionDigest,
        authorityDigest: authorization.authorityDigest,
        candidateDigest: candidate.digest,
        auditReceiptDigest: auditReceipt.digest,
        objects,
      });
      return deepFreeze({ status: 'ready' as const, export: { ...body, digest: digest(body) } });
    }
    const authorization = await authorize({
      action: command.kind,
      operationId: command.operationId,
      principalId: authenticatedPrincipal?.principalId,
      projectId: command.projectId,
      ...('objectId' in command ? { objectId: command.objectId } : {}),
      ...('tenantId' in command ? { tenantId: command.tenantId } : {}),
    });
    if (!authorization) return deepFreeze({ status: 'forbidden' as const });
    let states: readonly PayloadLifecycleState[];
    if (command.kind === 'request_subject_erasure') {
      states = await options.control.requestSubjectErasure({
        version: 1, operationId: command.operationId, authenticatedPrincipalId: principalId,
        tenantId: command.tenantId, projectId: command.projectId, subjectRef: command.subjectRef,
      }, signal);
    } else {
      const common = { version: 1 as const, operationId: command.operationId,
        authenticatedPrincipalId: principalId, projectId: command.projectId, objectId: command.objectId };
      let state: PayloadLifecycleState;
      switch (command.kind) {
        case 'place_hold':
          state = await options.control.placeHold({ ...common, holdId: command.holdId,
            ownerPrincipalId: principalId, reasonCode: command.reasonCode, reviewAt: command.reviewAt }, signal);
          break;
        case 'review_hold':
          state = await options.control.reviewHold({ ...common, holdId: command.holdId,
            approved: command.approved }, signal);
          break;
        case 'release_hold':
          state = await options.control.releaseHold({ ...common, holdId: command.holdId }, signal);
          break;
        case 'purge_expired':
          state = await options.control.evaluateRetention(common, signal);
          break;
        case 'reconcile_purge':
          state = await options.control.reconcile({ ...common, purgeId: command.purgeId }, signal);
          break;
      }
      states = [state];
    }
    const projections: WorkroomDataLifecycleProjection[] = [];
    for (const state of states) {
      const now = await readClock(options.clock, command.operationId, state.projectId, state.objectId);
      projections.push(projectState(state, authorization.authorityDigest, now));
    }
    return projections.length === 1
      ? deepFreeze({ status: 'ready' as const, projection: projections[0]! })
      : deepFreeze({ status: 'ready' as const, projections });
  };

  return Object.freeze({ read, listOverdue, execute });
}

type SubjectExportCommand = Extract<WorkroomDataLifecycleConsoleCommand, { kind: 'export_subject' }>;

interface SubjectExportDependencies {
  readonly generation: number;
  read(projectId: string, objectId: string): Promise<PayloadLifecycleState>;
  readonly clock: PayloadLifecycleKernelClockPort;
  readonly subjects: PayloadSubjectErasureResolverPort;
}

async function buildSubjectExportCandidate(
  options: SubjectExportDependencies,
  command: SubjectExportCommand,
  signal: AbortSignal,
): Promise<WorkroomDataLifecycleSubjectExportCandidate> {
  const current = await readSubjectExportCurrentState(options, command, signal);
  const clock = await readClockSnapshot(
    options.clock, command.operationId, command.projectId, 'subject-export',
  );
  const body = deepFreeze({
    version: 1 as const,
    generation: options.generation,
    tenantId: command.tenantId,
    projectId: command.projectId,
    subjectDigest: current.subjectDigest,
    resolverAuthorityDigest: current.resolverAuthorityDigest,
    resolutionDigest: current.resolutionDigest,
    objects: current.objects,
    observedAt: clock.now,
    clockRevision: clock.revision,
    clockDigest: clock.digest,
    deadline: command.deadline,
  });
  return deepFreeze({ ...body, digest: digest(body) });
}

async function revalidateSubjectExportCandidate(
  options: SubjectExportDependencies,
  command: SubjectExportCommand,
  candidate: WorkroomDataLifecycleSubjectExportCandidate,
  signal: AbortSignal,
): Promise<Readonly<{ states: readonly PayloadLifecycleState[]; clock: PayloadLifecycleClockSnapshot }> | null> {
  signal.throwIfAborted();
  let current: Awaited<ReturnType<typeof readSubjectExportCurrentState>>;
  try {
    current = await readSubjectExportCurrentState(options, command, signal);
  } catch (error) {
    if (error instanceof SubjectExportCandidateBindingError) return null;
    throw error;
  }
  const clock = await readClockSnapshot(
    options.clock, command.operationId, command.projectId, 'subject-export',
  );
  if (current.subjectDigest !== candidate.subjectDigest
    || current.resolverAuthorityDigest !== candidate.resolverAuthorityDigest
    || current.resolutionDigest !== candidate.resolutionDigest
    || canonicalWorkroomJson(current.objects) !== canonicalWorkroomJson(candidate.objects)
    || clock.now < candidate.observedAt || clock.revision < candidate.clockRevision
    || clock.now > candidate.deadline) return null;
  return deepFreeze({ states: current.states, clock });
}

async function readSubjectExportCurrentState(
  options: Pick<SubjectExportDependencies, 'read' | 'subjects'>,
  command: SubjectExportCommand,
  signal: AbortSignal,
): Promise<Readonly<{
  subjectDigest: string;
  resolverAuthorityDigest: string;
  resolutionDigest: string;
  objects: readonly Readonly<{ objectId: string; stateDigest: string }>[];
  states: readonly PayloadLifecycleState[];
}>> {
  signal.throwIfAborted();
  const resolution = await options.subjects.resolve({
    tenantId: command.tenantId, projectId: command.projectId, subjectRef: command.subjectRef,
  }, signal);
  validateSubjectExportResolution(resolution, command.tenantId, command.projectId);
  const handles = [...resolution.handles].sort((left, right) =>
    compareCanonicalWorkroomText(left.objectId, right.objectId));
  if (new Set(handles.map(handle => handle.objectId)).size !== handles.length) {
    throw new SubjectExportCandidateBindingError('Trusted subject export resolution contains duplicate objects');
  }
  const states: PayloadLifecycleState[] = [];
  const objects: Array<Readonly<{ objectId: string; stateDigest: string }>> = [];
  for (const handle of handles) {
    signal.throwIfAborted();
    if (handle.tenantId !== command.tenantId || handle.projectId !== command.projectId) {
      throw new SubjectExportCandidateBindingError('Subject export resolution escaped its Project authority');
    }
    const state = await options.read(command.projectId, handle.objectId);
    if (state.projectId !== command.projectId || state.objectId !== handle.objectId
      || !isDigest(state.digest)
      || state.authority?.handle.vaultObjectId !== handle.vaultObjectId
      || !state.authority.subjectDigests.includes(resolution.subjectDigest)) {
      throw new SubjectExportCandidateBindingError('Subject export object authority is stale');
    }
    states.push(state);
    objects.push(deepFreeze({ objectId: state.objectId, stateDigest: state.digest }));
  }
  return deepFreeze({
    subjectDigest: resolution.subjectDigest,
    resolverAuthorityDigest: resolution.authorityDigest,
    resolutionDigest: resolution.digest,
    objects,
    states,
  });
}

function validateSubjectExportResolution(
  value: Awaited<ReturnType<PayloadSubjectErasureResolverPort['resolve']>>,
  tenantId: string,
  projectId: string,
): asserts value is NonNullable<Awaited<ReturnType<PayloadSubjectErasureResolverPort['resolve']>>> {
  if (!value || value.version !== 1 || value.tenantId !== tenantId || value.projectId !== projectId
    || !Array.isArray(value.handles) || value.handles.length === 0
    || !isDigest(value.subjectDigest) || !isDigest(value.authorityDigest)) {
    throw new SubjectExportCandidateBindingError('Trusted subject export resolution is unavailable');
  }
  const { digest: supplied, ...body } = value;
  if (supplied !== digest(body)) {
    throw new SubjectExportCandidateBindingError('Trusted subject export resolution digest mismatch');
  }
}

class SubjectExportCandidateBindingError extends Error {}

function validateSubjectExportCandidate(
  value: WorkroomDataLifecycleSubjectExportCandidate,
  generation: number,
): WorkroomDataLifecycleSubjectExportCandidate {
  if (!value || value.version !== 1 || value.generation !== generation
    || !isDigest(value.subjectDigest) || !isDigest(value.resolverAuthorityDigest)
    || !isDigest(value.resolutionDigest) || !isDigest(value.clockDigest)
    || !Number.isSafeInteger(value.observedAt) || value.observedAt < 0
    || !Number.isSafeInteger(value.clockRevision) || value.clockRevision < 0
    || !Number.isSafeInteger(value.deadline) || value.deadline < value.observedAt
    || !Array.isArray(value.objects) || value.objects.length === 0) {
    throw new Error('Data Lifecycle subject export candidate is invalid');
  }
  const objectIds = value.objects.map(object => {
    exactKeys(object, ['objectId', 'stateDigest'], 'Data Lifecycle subject export object');
    text(object.objectId, 'Data Lifecycle subject export object id');
    if (!isDigest(object.stateDigest)) throw new Error('Data Lifecycle subject export state digest is invalid');
    return object.objectId;
  });
  if (new Set(objectIds).size !== objectIds.length
    || objectIds.some((objectId, index) => index > 0
      && compareCanonicalWorkroomText(objectIds[index - 1]!, objectId) >= 0)) {
    throw new Error('Data Lifecycle subject export object set is invalid');
  }
  const { digest: supplied, ...body } = value;
  if (supplied !== digest(body)) throw new Error('Data Lifecycle subject export candidate digest mismatch');
  return deepFreeze(structuredClone(value));
}

function createSubjectExportAuditRecord(input: Readonly<{
  operationId: string;
  principalId: string;
  candidate: WorkroomDataLifecycleSubjectExportCandidate;
  authorizationDigest: string;
  validatedClock: PayloadLifecycleClockSnapshot;
}>): WorkroomDataLifecycleSubjectExportAuditRecord {
  const body = deepFreeze({
    version: 1 as const,
    operationDigest: digest({ operationId: input.operationId }),
    principalDigest: digest({ principalId: input.principalId }),
    tenantId: input.candidate.tenantId,
    projectId: input.candidate.projectId,
    subjectDigest: input.candidate.subjectDigest,
    resolverAuthorityDigest: input.candidate.resolverAuthorityDigest,
    resolutionDigest: input.candidate.resolutionDigest,
    candidateDigest: input.candidate.digest,
    authorizationDigest: input.authorizationDigest,
    observedAt: input.candidate.observedAt,
    clockRevision: input.candidate.clockRevision,
    clockDigest: input.candidate.clockDigest,
    validatedAt: input.validatedClock.now,
    validationClockRevision: input.validatedClock.revision,
    validationClockDigest: input.validatedClock.digest,
    deadline: input.candidate.deadline,
    objectStateDigests: input.candidate.objects,
  });
  return deepFreeze({ ...body, digest: digest(body) });
}

function validateSubjectExportAuditReceipt(
  value: WorkroomDataLifecycleSubjectExportAuditReceipt,
  record: WorkroomDataLifecycleSubjectExportAuditRecord,
  currentTime: number,
): void {
  if (!value || value.version !== 1 || value.recordDigest !== record.digest
    || !Number.isSafeInteger(value.persistedAt) || value.persistedAt < 0
    || value.persistedAt !== currentTime || value.persistedAt !== record.validatedAt
    || !isDigest(value.authorityDigest)) {
    throw new Error('Data Lifecycle subject export audit receipt authority drift');
  }
  exactKeys(value, ['version', 'recordDigest', 'persistedAt', 'authorityDigest', 'digest'],
    'Data Lifecycle subject export audit receipt');
  const { digest: supplied, ...body } = value;
  if (supplied !== digest(body)) throw new Error('Data Lifecycle subject export audit receipt digest mismatch');
}

function projectState(
  state: PayloadLifecycleState,
  authorityDigest: string,
  now: number,
): WorkroomDataLifecycleProjection {
  const holds = Object.values(state.holds)
    .sort((left, right) => compareCanonicalWorkroomText(left.id, right.id))
    .map(hold => deepFreeze({
      holdId: hold.id,
      reasonCode: hold.reasonCode,
      placedAt: hold.placedAt,
      reviewAt: hold.reviewAt,
      status: hold.release ? 'released' as const
        : hold.review?.approved ? 'reviewed' as const
          : hold.review ? 'review_rejected' as const
            : hold.reviewAt <= now ? 'review_overdue' as const : 'active' as const,
    }));
  const erasures = state.erasures.map(value => deepFreeze({
    subjectDigest: value.subjectDigest,
    requestedAt: value.requestedAt,
  }));
  const purges = Object.values(state.purges)
    .sort((left, right) => compareCanonicalWorkroomText(left.dispatch.id, right.dispatch.id))
    .map(value => deepFreeze({
      purgeId: value.dispatch.id,
      locationId: value.dispatch.location.id,
      reason: value.dispatch.reason,
      attempt: value.dispatch.attempt,
      status: value.receipt?.status ?? 'pending' as const,
    }));
  const body = deepFreeze({
    version: 1 as const,
    projectId: state.projectId,
    objectId: state.objectId,
    sequence: state.sequence,
    stateDigest: state.digest,
    authorityDigest,
    ...(state.authority ? { retention: structuredClone(state.authority.retention) } : {}),
    holds,
    erasures,
    purges,
    cryptoErased: !!state.cryptoErased,
    purgeComplete: !!state.purgeComplete,
  });
  return deepFreeze({ ...body, digest: digest(body) });
}

function parseCommand(value: WorkroomDataLifecycleConsoleCommand): WorkroomDataLifecycleConsoleCommand {
  if (!value || typeof value !== 'object') throw new Error('Data Lifecycle Console command exact schema is invalid');
  switch (value.kind) {
    case 'place_hold':
      exactKeys(value, ['kind', 'operationId', 'projectId', 'objectId', 'holdId', 'reasonCode', 'reviewAt'],
        'Data Lifecycle place Hold command');
      if (!['legal_hold', 'investigation', 'regulatory_preservation'].includes(value.reasonCode)
        || !Number.isSafeInteger(value.reviewAt) || value.reviewAt < 0) {
        throw new Error('Data Lifecycle place Hold command is invalid');
      }
      text(value.holdId, 'Data Lifecycle Hold id');
      break;
    case 'review_hold':
      exactKeys(value, ['kind', 'operationId', 'projectId', 'objectId', 'holdId', 'approved'],
        'Data Lifecycle review Hold command');
      if (typeof value.approved !== 'boolean') throw new Error('Data Lifecycle Hold review is invalid');
      text(value.holdId, 'Data Lifecycle Hold id');
      break;
    case 'release_hold':
      exactKeys(value, ['kind', 'operationId', 'projectId', 'objectId', 'holdId'],
        'Data Lifecycle release Hold command');
      text(value.holdId, 'Data Lifecycle Hold id');
      break;
    case 'request_subject_erasure':
      exactKeys(value, ['kind', 'operationId', 'tenantId', 'projectId', 'subjectRef'],
        'Data Lifecycle subject command');
      text(value.tenantId, 'Data Lifecycle tenantId');
      text(value.subjectRef, 'Data Lifecycle subject ref');
      break;
    case 'export_subject':
      exactKeys(value, ['kind', 'operationId', 'tenantId', 'projectId', 'subjectRef', 'deadline'],
        'Data Lifecycle subject export command');
      text(value.tenantId, 'Data Lifecycle tenantId');
      text(value.subjectRef, 'Data Lifecycle subject ref');
      if (!Number.isSafeInteger(value.deadline) || value.deadline < 0) {
        throw new Error('Data Lifecycle subject export deadline is invalid');
      }
      break;
    case 'purge_expired':
      exactKeys(value, ['kind', 'operationId', 'projectId', 'objectId'], 'Data Lifecycle purge command');
      break;
    case 'reconcile_purge':
      exactKeys(value, ['kind', 'operationId', 'projectId', 'objectId', 'purgeId'],
        'Data Lifecycle reconcile command');
      text(value.purgeId, 'Data Lifecycle purge id');
      break;
    default:
      throw new Error('Data Lifecycle Console command exact schema is invalid');
  }
  text(value.operationId, 'Data Lifecycle operationId');
  text(value.projectId, 'Data Lifecycle projectId');
  if ('objectId' in value) text(value.objectId, 'Data Lifecycle objectId');
  return deepFreeze(structuredClone(value));
}

function rolesFor(action: WorkroomDataLifecycleConsoleAction): readonly PayloadLifecycleRole[] {
  if (action === 'display') return deepFreeze(['data_steward', 'privacy', 'compliance'] as const);
  if (action === 'review_hold') return deepFreeze(['compliance'] as const);
  if (action === 'request_subject_erasure' || action === 'export_subject') {
    return deepFreeze(['privacy'] as const);
  }
  return deepFreeze(['data_steward'] as const);
}

async function readClock(
  clock: PayloadLifecycleKernelClockPort,
  operationId: string,
  projectId: string,
  objectId: string,
): Promise<number> {
  return (await readClockSnapshot(clock, operationId, projectId, objectId)).now;
}

async function readClockSnapshot(
  clock: PayloadLifecycleKernelClockPort,
  operationId: string,
  projectId: string,
  objectId: string,
): Promise<PayloadLifecycleClockSnapshot> {
  const value = await clock.read({ operationId, projectId, objectId, purpose: 'control' });
  if (!value) {
    throw new Error('Data Lifecycle Console clock authority is unavailable');
  }
  const snapshot = createPayloadLifecycleClockSnapshot(value);
  if (canonicalWorkroomJson(snapshot) !== canonicalWorkroomJson(value)) {
    throw new Error('Data Lifecycle Console clock authority drift');
  }
  return snapshot;
}

function exactKeys(value: object, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} exact schema is invalid`);
  }
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.trim() !== value) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function positive(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} is invalid`);
}

function isDigest(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('sha256:') && value.length > 'sha256:'.length;
}
