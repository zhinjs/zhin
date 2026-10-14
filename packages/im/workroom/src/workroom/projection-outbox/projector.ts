import type { WorkroomEvent, WorkroomExecutionRole } from '../kernel-contracts.js';
import {
  compareCanonicalWorkroomText,
  deepFreezeWorkroomValue as deepFreeze,
  digestCanonicalWorkroomValue as digest,
} from '../canonical-value.js';
import type { GovernedProjectionDisclosureResult } from '../../data-governance/disclosure-authority.js';
import { createWorkroomGovernedDispatchReason } from '../governed-dispatch-reasons.js';
import type { PortfolioSponsorProjection } from '../../portfolio/sponsor-projection.js';
import type {
  WorkroomLifecycleHoldOverdueSnapshot,
  WorkroomProjectionAgentIdentity,
  WorkroomProjectionBinding,
  WorkroomProjectionConversation,
  WorkroomProjectionOutboxItem,
  WorkroomProjectionTarget,
} from './contracts.js';

interface AssignmentProjectionScope {
  readonly assignmentId: string;
  readonly taskKey: string;
  readonly taskRevision: number;
  readonly assignmentRevision: number;
  readonly owner: string;
  readonly role: WorkroomExecutionRole;
}

type WorkroomProjectionDraft = Omit<WorkroomProjectionOutboxItem, 'cursorId' | 'content' | 'disclosure'>
  & Readonly<{ content: string }>;

export function projectEvents(
  events: readonly WorkroomEvent[],
  cursor: number,
  binding: WorkroomProjectionBinding,
): Readonly<{ items: readonly WorkroomProjectionDraft[]; cursor: number }> {
  const assignments = new Map<string, AssignmentProjectionScope>();
  const taskRevisions = new Map<string, number>();
  const taskAssignments = new Map<string, string>();
  const items: WorkroomProjectionDraft[] = [];
  let capturedThrough = cursor;
  let pendingProgress: WorkroomEvent[] = [];

  const flushProgress = () => {
    if (pendingProgress.length === 0) return;
    const byAssignment = new Map<string, WorkroomEvent[]>();
    for (const progressEvent of pendingProgress) {
      const assignmentId = String(progressEvent.payload.assignmentId);
      byAssignment.set(assignmentId, [...(byAssignment.get(assignmentId) ?? []), progressEvent]);
    }
    for (const progressEvents of byAssignment.values()) {
      const latest = progressEvents.at(-1)!;
      const item = projectEvent(
        latest,
        binding,
        assignments,
        taskRevisions,
        taskAssignments,
        progressProjectionDefinition(latest, assignments, taskAssignments, progressEvents.length),
        progressEvents,
      );
      if (item) items.push(item);
    }
    capturedThrough = pendingProgress.at(-1)!.sequence;
    pendingProgress = [];
  };

  for (const event of events) {
    if (event.type === 'task.planned') taskRevisions.set(String(event.payload.taskKey), 1);
    if (event.type === 'task.revised') {
      const taskKey = String(event.payload.taskKey);
      taskRevisions.set(taskKey, (taskRevisions.get(taskKey) ?? 0) + 1);
    }
    if (event.type === 'assignment.claimed') {
      const scope = {
        assignmentId: String(event.payload.assignmentId),
        taskKey: String(event.payload.taskKey),
        taskRevision: Number(event.payload.taskRevision),
        assignmentRevision: Number(event.payload.assignmentRevision),
        owner: String(event.payload.owner),
        role: event.payload.role as WorkroomExecutionRole,
      };
      assignments.set(scope.assignmentId, scope);
      taskAssignments.set(scope.taskKey, scope.assignmentId);
    }
    if (event.sequence <= cursor) continue;
    if (event.type === 'assignment.progress') {
      pendingProgress.push(event);
      if (pendingProgress.length >= progressWindowSizeForPolicy(binding.projectionPolicyRevision)) {
        flushProgress();
      }
      continue;
    }
    const item = projectEvent(event, binding, assignments, taskRevisions, taskAssignments);
    if (item) {
      // Observable boundaries are immediate. Any partial progress window is
      // deterministically closed before the boundary rather than timer-flushed.
      flushProgress();
      items.push(item);
      capturedThrough = event.sequence;
    } else if (pendingProgress.length === 0) {
      capturedThrough = event.sequence;
    }
  }
  return deepFreeze({ items, cursor: capturedThrough });
}

function projectEvent(
  event: WorkroomEvent,
  binding: WorkroomProjectionBinding,
  assignments: ReadonlyMap<string, AssignmentProjectionScope>,
  taskRevisions: ReadonlyMap<string, number>,
  taskAssignments: ReadonlyMap<string, string>,
  definitionOverride?: Readonly<{
    kind: WorkroomProjectionOutboxItem['kind'];
    content: string;
  }>,
  sourceEvents: readonly WorkroomEvent[] = [event],
): WorkroomProjectionDraft | undefined {
  const assignmentId = assignmentIdForEvent(event, taskAssignments);
  const assignment = assignmentId ? assignments.get(assignmentId) : undefined;
  const definition = definitionOverride ?? projectionDefinition(event, assignment);
  if (!definition) return undefined;
  const speaker = assignment
    ? requireAgentIdentity(binding, assignment)
    : binding.orchestrator;
  const taskKey = assignment?.taskKey ?? taskKeyForEvent(event);
  const taskRevision = assignment?.taskRevision
    ?? (taskKey ? taskRevisions.get(taskKey) : undefined);
  const target = deepFreeze({
    projectId: binding.projectId,
    runId: event.runId,
    ...(taskKey ? { taskKey } : {}),
    ...(taskRevision ? { taskRevision } : {}),
    ...(assignment ? { assignmentId: assignment.assignmentId } : {}),
    ...(assignment ? { assignmentRevision: assignment.assignmentRevision } : {}),
    agentDefinitionId: speaker.agentDefinitionId,
  });
  const immutableProjection = {
    version: 1 as const,
    audience: 'workroom' as const,
    projectId: binding.projectId,
    runId: event.runId,
    sourceEventIds: sourceEvents.map(sourceEvent => sourceEvent.eventId),
    sourceSequence: event.sequence,
    bindingRevision: binding.bindingRevision,
    projectionPolicyRevision: binding.projectionPolicyRevision,
    conversation: projectionConversationForSpeaker(binding, speaker),
    speaker,
    kind: definition.kind,
    content: `[${speaker.displayName} · ${speaker.role}] ${definition.content}`,
    target,
  };
  const itemDigest = digest(immutableProjection);
  const id = `projection:${itemDigest.slice('sha256:'.length)}`;
  return deepFreeze({
    ...immutableProjection,
    id,
    idempotencyKey: id,
    digest: itemDigest,
    delivery: { status: 'pending' as const, attempts: 0, fence: 0 },
  });
}

export function workroomLifecycleProjectionCursorKey(projectId: string, objectId: string): string {
  requireText(projectId, 'Lifecycle Projection projectId');
  requireText(objectId, 'Lifecycle Projection objectId');
  return `payload-lifecycle:${digest({ version: 1, projectId, objectId }).slice('sha256:'.length)}`;
}

export function projectionBindingCursorKey(
  sourceKey: string,
  binding: WorkroomProjectionBinding,
): string {
  requireText(sourceKey, 'Projection cursor source key');
  return `binding-cursor:${digest({
    version: 1,
    sourceKey,
    projectId: binding.projectId,
    audience: projectionAudience(binding),
    bindingRevision: binding.bindingRevision,
    catalogBindingDigest: binding.catalogBindingDigest,
    conversation: binding.conversation,
  }).slice('sha256:'.length)}`;
}

export function workroomPortfolioProjectionCursorKey(portfolioId: string, projectId: string): string {
  requireText(portfolioId, 'Portfolio Projection portfolioId');
  requireText(projectId, 'Portfolio Projection projectId');
  return `portfolio-sponsor:${digest({ version: 1, portfolioId, projectId }).slice('sha256:'.length)}`;
}

export function portfolioSponsorDraft(
  binding: WorkroomProjectionBinding,
  projection: PortfolioSponsorProjection,
  runId: string,
): WorkroomProjectionDraft {
  const project = projection.projects[binding.projectId]!;
  const speaker = binding.orchestrator;
  const sourceEventIds = [`portfolio-sponsor:${digest({
    version: 1,
    portfolioId: projection.portfolioId,
    projectId: binding.projectId,
    sourceSequence: projection.sourceSequence,
    projectionDigest: projection.digest,
  }).slice('sha256:'.length)}`];
  const queue = project.queueHead
    ? `queue=${boundedProjectionText(project.queueHead.opaqueHeadId, 'opaque')} `
      + `starvationAt=${project.queueHead.starvationAt}`
    : 'queue=empty';
  const rate = Object.entries(project.rate)
    .sort(([left], [right]) => compareCanonicalWorkroomText(left, right))
    .map(([poolId, window]) => `${boundedProjectionText(poolId, 'pool')}:`
      + `${window.usedUnits}/${window.limitUnits}@${window.windowStart}-${window.windowEnd}`)
    .join(',') || 'none';
  const immutableProjection = {
    version: 1 as const,
    audience: 'sponsor_room' as const,
    projectId: binding.projectId,
    runId,
    sourceEventIds,
    sourceSequence: projection.sourceSequence,
    bindingRevision: binding.bindingRevision,
    projectionPolicyRevision: binding.projectionPolicyRevision,
    conversation: binding.conversation,
    speaker,
    kind: (project.blockers.length > 0 ? 'attention' : 'status') as WorkroomProjectionOutboxItem['kind'],
    content: `[${speaker.displayName} · ${speaker.role}] Portfolio ${boundedProjectionText(projection.portfolioId, 'portfolio')} / Project ${boundedProjectionText(binding.projectId, 'project')}：`
      + `lane=${project.lane} status=${project.status} ${queue} `
      + `grants=${project.grants.length} reclaims=${project.reclaims.length} `
      + `budget=${project.budget.availableMicros}/${project.budget.limitMicros} `
      + `rate=${rate} fairness=${project.fairness.weightedService} `
      + `blockers=${project.blockers.join(',') || 'none'}`,
    target: deepFreeze({
      projectId: binding.projectId,
      runId,
      agentDefinitionId: speaker.agentDefinitionId,
    }),
  };
  const itemDigest = digest(immutableProjection);
  const id = `projection:${itemDigest.slice('sha256:'.length)}`;
  return deepFreeze({
    ...immutableProjection,
    id,
    idempotencyKey: id,
    digest: itemDigest,
    delivery: { status: 'pending' as const, attempts: 0, fence: 0 },
  });
}

export function lifecycleOverdueSourceEventId(
  projectId: string,
  value: WorkroomLifecycleHoldOverdueSnapshot['overdue'][number],
): string {
  return `payload-hold-overdue:${digest({
    version: 1,
    projectId,
    objectId: value.objectId,
    holdId: value.holdId,
    reasonCode: value.reasonCode,
    placedAt: value.placedAt,
    reviewAt: value.reviewAt,
  }).slice('sha256:'.length)}`;
}

export function lifecycleOverdueDraft(
  binding: WorkroomProjectionBinding,
  runId: string,
  value: WorkroomLifecycleHoldOverdueSnapshot['overdue'][number],
  sourceSequence: number,
): WorkroomProjectionDraft {
  const speaker = binding.orchestrator;
  const sourceEventIds = [lifecycleOverdueSourceEventId(binding.projectId, value)];
  const immutableProjection = {
    version: 1 as const,
    audience: 'sponsor_room' as const,
    projectId: binding.projectId,
    runId,
    sourceEventIds,
    sourceSequence,
    bindingRevision: binding.bindingRevision,
    projectionPolicyRevision: binding.projectionPolicyRevision,
    conversation: binding.conversation,
    speaker,
    kind: 'attention' as const,
    content: `[${speaker.displayName} · ${speaker.role}] Retention Hold review overdue：`
      + `object ${boundedProjectionText(value.objectId, 'unknown')}；`
      + `hold ${boundedProjectionText(value.holdId, 'unknown')}；reviewAt ${value.reviewAt}`,
    target: deepFreeze({
      projectId: binding.projectId,
      runId,
      agentDefinitionId: speaker.agentDefinitionId,
    }),
  };
  const itemDigest = digest(immutableProjection);
  const id = `projection:${itemDigest.slice('sha256:'.length)}`;
  return deepFreeze({
    ...immutableProjection,
    id,
    idempotencyKey: id,
    digest: itemDigest,
    delivery: { status: 'pending' as const, attempts: 0, fence: 0 },
  });
}

export function validateLifecycleOverdueSnapshot(
  value: WorkroomLifecycleHoldOverdueSnapshot,
): WorkroomLifecycleHoldOverdueSnapshot {
  if (!value || value.version !== 1 || !Array.isArray(value.overdue)
    || !Number.isSafeInteger(value.clockRevision) || value.clockRevision < 0
    || !Number.isSafeInteger(value.observedAt) || value.observedAt < 0) {
    throw new Error('Workroom Lifecycle overdue projection is invalid');
  }
  requireText(value.projectId, 'Lifecycle overdue Project');
  const identities = new Set<string>();
  for (const item of value.overdue) {
    requireText(item.objectId, 'Lifecycle overdue object');
    requireText(item.holdId, 'Lifecycle overdue Hold');
    requireText(item.ownerPrincipalId, 'Lifecycle overdue owner');
    if (!Number.isSafeInteger(item.stateSequence) || item.stateSequence < 0
      || !/^sha256:[a-f0-9]{64}$/u.test(item.stateDigest)
      || !['legal_hold', 'investigation', 'regulatory_preservation'].includes(item.reasonCode)
      || !Number.isSafeInteger(item.placedAt) || item.placedAt < 0
      || !Number.isSafeInteger(item.reviewAt) || item.reviewAt <= item.placedAt
      || !Number.isSafeInteger(item.overdueBy) || item.overdueBy < 0) {
      throw new Error('Workroom Lifecycle overdue Hold is invalid');
    }
    const identity = lifecycleOverdueSourceEventId(value.projectId, item);
    if (identities.has(identity)) throw new Error('Workroom Lifecycle overdue projection contains duplicates');
    identities.add(identity);
  }
  const { digest: supplied, ...body } = value;
  if (supplied !== digest(body)) throw new Error('Workroom Lifecycle overdue projection digest mismatch');
  return deepFreeze(structuredClone(value));
}

export function materializeProjectionItem(
  draft: WorkroomProjectionDraft & Readonly<{ cursorId: string }>,
  governed: Extract<GovernedProjectionDisclosureResult, { status: 'ready' }>,
): WorkroomProjectionOutboxItem {
  const {
    content: _body,
    id: _draftId,
    idempotencyKey: _draftKey,
    digest: _draftDigest,
    delivery,
    ...header
  } = draft;
  const projection = deepFreeze({
    ...header,
    disclosure: {
      request: structuredClone(governed.request),
      manifest: structuredClone(governed.manifest),
    },
  });
  const itemDigest = digest(projection);
  const id = `projection:${itemDigest.slice('sha256:'.length)}`;
  return deepFreeze({
    ...projection,
    id,
    idempotencyKey: id,
    digest: itemDigest,
    delivery: structuredClone(delivery),
  });
}

function projectionDefinition(
  event: WorkroomEvent,
  assignment: AssignmentProjectionScope | undefined,
): Readonly<{
  kind: WorkroomProjectionOutboxItem['kind'];
  content: string;
}> | undefined {
  const taskKey = assignment?.taskKey ?? taskKeyForEvent(event);
  switch (event.type) {
    case 'run.created':
      return { kind: 'status', content: `Run 已启动：${boundedProjectionText(event.payload.title, '未命名 Run')}` };
    case 'task.planned':
      return { kind: 'status', content: `${taskKey}：已规划` };
    case 'assignment.claimed':
      return { kind: 'status', content: `${taskKey}：已领取当前工作` };
    case 'assignment.started':
      return { kind: 'status', content: `${taskKey}：正在执行` };
    case 'assignment.checkpointed':
      return { kind: 'milestone', content: `${taskKey}：已形成 checkpoint` };
    case 'assignment.execution_completed':
      return { kind: 'conclusion', content: `${taskKey}：已提交执行结论，等待验收` };
    case 'task.blocked':
      return { kind: 'attention', content: `${taskKey}：阻塞——${boundedProjectionText(event.payload.reason, '原因未说明')}` };
    case 'task.accepted':
      return { kind: 'conclusion', content: `${taskKey}：已验收` };
    case 'task.failed':
      return { kind: 'attention', content: `${taskKey}：失败——${boundedProjectionText(event.payload.reason, '原因未说明')}` };
    case 'reviewer.assigned':
      return { kind: 'attention', content: `${taskKey}：已进入 Reviewer 验收` };
    case 'sponsor_gate.opened':
      return { kind: 'attention', content: `${taskKey}：等待 Sponsor 决策` };
    case 'sponsor_gate.expired':
      return { kind: 'attention', content: `${taskKey}：Sponsor 决策已过期` };
    case 'sponsor_gate.decided':
      return {
        kind: 'attention',
        content: `${taskKey}：Sponsor 已${sponsorDecisionLabel(event.payload.decision)}`,
      };
    case 'plan_gate.decided':
      return {
        kind: 'attention',
        content: `${taskKey}：Sponsor 已对执行前 Plan Gate ${sponsorDecisionLabel(event.payload.decision)}`,
      };
    case 'task.rework_requested':
      return {
        kind: 'attention',
        content: `${taskKey}：已要求返工——${boundedProjectionText(event.payload.reason, '原因未说明')}`,
      };
    case 'assignment.lease_expired':
      return { kind: 'attention', content: `${taskKey}：执行租约已过期，等待恢复` };
    case 'assignment.cancel_requested':
      return { kind: 'attention', content: `${taskKey}：执行已请求取消` };
    case 'assignment.cancelled':
      return { kind: 'attention', content: `${taskKey}：执行已取消` };
    case 'task.cancel_requested':
      return { kind: 'attention', content: `${taskKey}：已请求取消` };
    case 'run.cancel_requested':
      return {
        kind: 'attention',
        content: `Run 已请求取消——${boundedProjectionText(event.payload.reason, '原因未说明')}`,
      };
    case 'task.cancelled':
      return { kind: 'attention', content: `${taskKey}：已取消` };
    case 'run.cancelled':
      return { kind: 'attention', content: 'Run 已取消' };
    default:
      return undefined;
  }
}

function progressProjectionDefinition(
  event: WorkroomEvent,
  assignments: ReadonlyMap<string, AssignmentProjectionScope>,
  taskAssignments: ReadonlyMap<string, string>,
  count: number,
): Readonly<{ kind: 'progress'; content: string }> {
  const assignmentId = assignmentIdForEvent(event, taskAssignments);
  const taskKey = assignmentId ? assignments.get(assignmentId)?.taskKey : undefined;
  const progress = event.payload.progress as Readonly<Record<string, unknown>>;
  const completedUnits = progress.completedUnits;
  const totalUnits = progress.totalUnits;
  const units = typeof completedUnits === 'number' && Number.isFinite(completedUnits)
    && typeof totalUnits === 'number' && Number.isFinite(totalUnits)
    ? `（${completedUnits}/${totalUnits}）`
    : '';
  const window = count > 1 ? `；本窗口 ${count} 次更新` : '';
  return {
    kind: 'progress',
    content: `${taskKey ?? '未知任务'}：${boundedProjectionText(progress.summary, '进度已更新')}${units}${window}`,
  };
}

/** Policy revision pins the aggregation contract; source Kernel order closes each fixed window. */
function progressWindowSizeForPolicy(projectionPolicyRevision: number): number {
  requirePositiveInteger(projectionPolicyRevision, 'projectionPolicyRevision');
  return 3;
}

function boundedProjectionText(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const canonical = value.replace(/[\p{Cc}\p{Cf}\s]+/gu, ' ').trim();
  return (canonical || fallback).slice(0, 240);
}

function sponsorDecisionLabel(value: unknown): string {
  switch (value) {
    case 'approve': return '批准';
    case 'reject': return '拒绝';
    case 'request_changes': return '要求修改';
    case 'cancel': return '取消';
    default: return '作出决策';
  }
}

function assignmentIdForEvent(
  event: WorkroomEvent,
  taskAssignments: ReadonlyMap<string, string>,
): string | undefined {
  if (event.type.startsWith('assignment.')) return String(event.payload.assignmentId ?? '') || undefined;
  const taskKey = taskKeyForEvent(event);
  return taskKey ? taskAssignments.get(taskKey) : undefined;
}

function taskKeyForEvent(event: WorkroomEvent): string | undefined {
  const value = event.payload.taskKey;
  return typeof value === 'string' && value ? value : undefined;
}

function requireAgentIdentity(
  binding: WorkroomProjectionBinding,
  assignment: AssignmentProjectionScope,
): WorkroomProjectionAgentIdentity {
  const matches = binding.agents.filter(identity =>
    (identity.principalId === assignment.owner
      || `agent:${identity.agentDefinitionId}` === assignment.owner)
    && identity.role === assignment.role);
  if (matches.length !== 1) {
    throw new Error(`Workroom Projection requires one named Agent identity for ${assignment.assignmentId}`);
  }
  return matches[0]!;
}

function projectionConversationForSpeaker(
  binding: WorkroomProjectionBinding,
  speaker: WorkroomProjectionAgentIdentity,
): WorkroomProjectionConversation {
  if (!speaker.messageEndpoint) return binding.conversation;
  return deepFreeze({
    ...binding.conversation,
    endpoint: speaker.messageEndpoint,
  });
}

export function freezeAndValidateBinding(value: WorkroomProjectionBinding): WorkroomProjectionBinding {
  if (value.version !== 1) throw new Error('Workroom Projection binding version is unsupported');
  projectionAudience(value);
  requireText(value.projectId, 'binding.projectId');
  if (!/^sha256:[a-f0-9]{64}$/u.test(value.catalogBindingDigest)) {
    throw new Error('Workroom Projection binding.catalogBindingDigest is invalid');
  }
  requirePositiveInteger(value.bindingRevision, 'binding.bindingRevision');
  requirePositiveInteger(value.projectionPolicyRevision, 'binding.projectionPolicyRevision');
  requireConversation(value.conversation);
  requireIdentity(value.orchestrator, 'binding.orchestrator');
  if (value.orchestrator.role !== 'orchestrator' || !Array.isArray(value.agents)) {
    throw new Error('Workroom Projection binding requires an Orchestrator and Agent directory');
  }
  for (const identity of value.agents) requireIdentity(identity, 'binding.agents[]');
  return deepFreeze(value);
}

export function workroomProjectionBindingKey(
  projectId: string,
  audience: 'workroom' | 'sponsor_room',
): string {
  requireText(projectId, 'binding key projectId');
  return audience === 'workroom' ? projectId : `${projectId}:sponsor-room`;
}

export function projectionAudience(
  value: Pick<WorkroomProjectionBinding | WorkroomProjectionOutboxItem, 'audience'>,
): 'workroom' | 'sponsor_room' {
  if (value.audience !== 'workroom' && value.audience !== 'sponsor_room') {
    throw new Error('Workroom Projection audience is invalid');
  }
  return value.audience;
}

export function assertProjectionItem(
  item: WorkroomProjectionOutboxItem,
  runId: string,
  after: number,
  through: number,
): void {
  projectionAudience(item);
  if ('content' in item) {
    throw new Error(
      'Legacy plaintext Workroom Projection snapshot is unsupported; use offline export then purge it',
    );
  }
  if (item.version !== 1 || item.cursorId !== runId
    || item.sourceSequence <= after || item.sourceSequence > through
    || item.id !== item.idempotencyKey || !/^projection:[a-f0-9]{64}$/u.test(item.id)
    || !/^sha256:[a-f0-9]{64}$/u.test(item.digest)) {
    throw new Error('Invalid Workroom Projection outbox item');
  }
  const expectedChannel = projectionAudience(item) === 'sponsor_room'
    ? 'sponsor_projection'
    : 'workroom_projection';
  if (!item.disclosure?.request || !item.disclosure.manifest
    || item.disclosure.request.projectId !== item.projectId
    || item.disclosure.manifest.source.payloadHash !== item.disclosure.request.sourceDigest
    || item.disclosure.manifest.channel !== expectedChannel) {
    throw new Error('Invalid Workroom Projection Disclosure Manifest');
  }
  const {
    id: _id,
    idempotencyKey: _key,
    digest: _digest,
    delivery: _delivery,
    ...projection
  } = item;
  if (digest(projection) !== item.digest || item.id !== `projection:${item.digest.slice(7)}`) {
    throw new Error('Workroom Projection outbox item digest mismatch');
  }
}

export function requireConversation(value: WorkroomProjectionConversation): void {
  requireText(value.endpoint?.id, 'conversation.endpoint.id');
  requireText(value.endpoint?.adapter, 'conversation.endpoint.adapter');
  requireText(value.id, 'conversation.id');
  if (!['private', 'group', 'channel'].includes(value.kind)) {
    throw new Error('Workroom Projection conversation kind is invalid');
  }
}

function requireIdentity(value: WorkroomProjectionAgentIdentity, label: string): void {
  requireText(value.principalId, `${label}.principalId`);
  requireText(value.agentDefinitionId, `${label}.agentDefinitionId`);
  requireText(value.displayName, `${label}.displayName`);
  if (!['orchestrator', 'executor', 'reviewer', 'integration'].includes(value.role)) {
    throw new Error(`Workroom Projection ${label}.role is invalid`);
  }
  if (value.messageEndpoint) {
    requireText(value.messageEndpoint.id, `${label}.messageEndpoint.id`);
    requireText(value.messageEndpoint.adapter, `${label}.messageEndpoint.adapter`);
  }
}

export function requireText(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Workroom Projection ${label} requires non-empty text`);
  }
}

export function requirePositiveInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new Error(`Workroom Projection ${label} must be a positive integer`);
  }
}

export function requireSequence(value: unknown, label: string, minimum: number): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) {
    throw new Error(`Workroom Projection ${label} is invalid`);
  }
}

export function requireFiniteNumber(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Workroom Projection ${label} must be finite`);
  }
}

export function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Workroom Projection ${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function assertExactRecordKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const canonical = [...expected].sort();
  if (actual.length !== canonical.length
    || actual.some((key, index) => key !== canonical[index])) {
    throw new Error(`Workroom Projection ${label} fields are invalid`);
  }
}
