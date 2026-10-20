import {
  canonicalWorkroomJson,
  deepFreezeWorkroomValue as deepFreeze,
  digestCanonicalWorkroomValue,
} from './canonical-value.js';
import {
  assertWorkflowPlanProposal,
  type WorkflowPlanProposal,
  type WorkflowPlanTaskProposal,
} from './workflow-plan-builder.js';

export interface WorkflowPlanRevisionProvenance {
  readonly sourceRef: string;
  readonly sourceDigest: string;
}

export interface WorkflowPlanRevisionDiff {
  readonly added: readonly WorkflowPlanTaskProposal[];
  readonly replaced: readonly Readonly<{
    taskKey: string;
    expectedTaskRevision: number;
    task: WorkflowPlanTaskProposal;
  }>[];
  readonly removed: readonly Readonly<{
    taskKey: string;
    expectedTaskRevision: number;
  }>[];
}

export interface WorkflowPlanRevisionCandidateInput {
  readonly proposalId: string;
  readonly projectId: string;
  readonly runId: string;
  readonly expectedSequence: number;
  readonly basePlanRevision: number;
  readonly basePlanDigest: string;
  readonly baseTaskRevisions: Readonly<Record<string, number>>;
  readonly provenance: WorkflowPlanRevisionProvenance;
  readonly reason: string;
  readonly basePlan: WorkflowPlanProposal;
  readonly nextPlan: WorkflowPlanProposal;
}

export interface WorkflowPlanRevisionCandidate
extends Omit<WorkflowPlanRevisionCandidateInput, 'basePlan'> {
  readonly version: 1;
  readonly type: 'plan_revision';
  readonly diff: WorkflowPlanRevisionDiff;
  readonly digest: string;
}

/**
 * Canonical proposal constructor. This object deliberately carries no
 * principal or authority claim; only WorkroomKernel may admit it.
 */
export function createWorkflowPlanRevisionCandidate(
  input: WorkflowPlanRevisionCandidateInput,
): WorkflowPlanRevisionCandidate {
  for (const [value, label] of [
    [input.proposalId, 'proposalId'], [input.projectId, 'projectId'], [input.runId, 'runId'],
    [input.basePlanDigest, 'basePlanDigest'], [input.provenance.sourceRef, 'provenance.sourceRef'],
    [input.provenance.sourceDigest, 'provenance.sourceDigest'], [input.reason, 'reason'],
  ] as const) requireText(value, `Plan Revision ${label}`);
  nonNegativeInteger(input.expectedSequence, 'Plan Revision expectedSequence');
  positiveInteger(input.basePlanRevision, 'Plan Revision basePlanRevision');
  requireDigest(input.basePlanDigest, 'Plan Revision basePlanDigest');
  requireDigest(input.provenance.sourceDigest, 'Plan Revision provenance sourceDigest');
  assertWorkflowPlanProposal(input.basePlan);
  assertWorkflowPlanProposal(input.nextPlan);
  if (input.basePlan.projectId !== input.projectId || input.nextPlan.projectId !== input.projectId) {
    throw new Error('Plan Revision Plans belong to another Project');
  }
  if (input.basePlan.digest !== input.basePlanDigest) {
    throw new Error('Plan Revision base Plan digest does not match');
  }
  assertPinnedPlanMetadata(input.basePlan, input.nextPlan);
  const revisions = normalizeTaskRevisions(input.basePlan, input.baseTaskRevisions);
  const diff = computeWorkflowPlanRevisionDiff(input.basePlan, input.nextPlan, revisions);
  if (diff.added.length + diff.replaced.length + diff.removed.length === 0) {
    throw new Error('Plan Revision must contain a change');
  }
  const body = deepFreeze({
    version: 1 as const,
    type: 'plan_revision' as const,
    proposalId: input.proposalId,
    projectId: input.projectId,
    runId: input.runId,
    expectedSequence: input.expectedSequence,
    basePlanRevision: input.basePlanRevision,
    basePlanDigest: input.basePlanDigest,
    baseTaskRevisions: revisions,
    provenance: structuredClone(input.provenance),
    reason: input.reason,
    nextPlan: structuredClone(input.nextPlan),
    diff,
  });
  return deepFreeze({ ...body, digest: digestCanonicalWorkroomValue(body) });
}

export function assertWorkflowPlanRevisionCandidate(value: WorkflowPlanRevisionCandidate): void {
  if (!value || value.version !== 1 || value.type !== 'plan_revision') {
    throw new Error('Plan Revision candidate shape is invalid');
  }
  const actual = Object.keys(value).sort();
  const expected = [
    'basePlanDigest', 'basePlanRevision', 'baseTaskRevisions', 'diff', 'digest',
    'expectedSequence', 'nextPlan', 'projectId', 'proposalId', 'provenance',
    'reason', 'runId', 'type', 'version',
  ].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error('Plan Revision candidate keys are invalid');
  }
  assertWorkflowPlanProposal(value.nextPlan);
  const body = { ...structuredClone(value) } as Record<string, unknown>;
  delete body.digest;
  if (digestCanonicalWorkroomValue(body) !== value.digest) {
    throw new Error('Plan Revision candidate digest does not match its canonical body');
  }
}

export function computeWorkflowPlanRevisionDiff(
  basePlan: WorkflowPlanProposal,
  nextPlan: WorkflowPlanProposal,
  baseTaskRevisions: Readonly<Record<string, number>>,
): WorkflowPlanRevisionDiff {
  assertWorkflowPlanProposal(basePlan);
  assertWorkflowPlanProposal(nextPlan);
  assertPinnedPlanMetadata(basePlan, nextPlan);
  const base = new Map(basePlan.tasks.map(task => [task.key, task]));
  const next = new Map(nextPlan.tasks.map(task => [task.key, task]));
  const added = nextPlan.tasks.filter(task => !base.has(task.key));
  const replaced = nextPlan.tasks.flatMap(task => {
    const previous = base.get(task.key);
    if (!previous || canonicalWorkroomJson(previous) === canonicalWorkroomJson(task)) return [];
    return [{
      taskKey: task.key,
      expectedTaskRevision: positiveInteger(
        baseTaskRevisions[task.key],
        `Plan Revision base Task ${task.key} revision`,
      ),
      task,
    }];
  });
  const removed = basePlan.tasks.filter(task => !next.has(task.key)).map(task => ({
    taskKey: task.key,
    expectedTaskRevision: positiveInteger(
      baseTaskRevisions[task.key],
      `Plan Revision base Task ${task.key} revision`,
    ),
  }));
  return deepFreeze({ added, replaced, removed });
}

function normalizeTaskRevisions(
  basePlan: WorkflowPlanProposal,
  value: Readonly<Record<string, number>>,
): Readonly<Record<string, number>> {
  const keys = Object.keys(value).sort();
  const expected = basePlan.tasks.map(task => task.key).sort();
  if (canonicalWorkroomJson(keys) !== canonicalWorkroomJson(expected)) {
    throw new Error('Plan Revision base Task revisions are incomplete');
  }
  return deepFreeze(Object.fromEntries(keys.map(key => [
    key,
    positiveInteger(value[key], `Plan Revision base Task ${key} revision`),
  ])));
}

function assertPinnedPlanMetadata(base: WorkflowPlanProposal, next: WorkflowPlanProposal): void {
  const mutable = new Set(['proposalId', 'tasks', 'digest']);
  const basePinned = Object.fromEntries(Object.entries(base).filter(([key]) => !mutable.has(key)));
  const nextPinned = Object.fromEntries(Object.entries(next).filter(([key]) => !mutable.has(key)));
  if (canonicalWorkroomJson(basePinned) !== canonicalWorkroomJson(nextPinned)) {
    throw new Error('Plan Revision cannot replace pinned Project/Profile/Planning/Scheduler policy');
  }
}

function requireText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
    throw new Error(`${label} must be canonical non-empty text`);
  }
  return value;
}

function requireDigest(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`${label} must be a canonical sha256 digest`);
  }
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error(`${label} must be a positive safe integer`);
  return Number(value);
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`${label} must be a non-negative safe integer`);
  return Number(value);
}
