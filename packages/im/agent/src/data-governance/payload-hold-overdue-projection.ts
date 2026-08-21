import {
  createPayloadLifecycleClockSnapshot,
  type PayloadLifecycleKernelClockPort,
} from './payload-lifecycle.js';
import {
  canonicalWorkroomJson,
  deepFreezeWorkroomValue as deepFreeze,
  digestCanonicalWorkroomValue as digest,
} from '../workroom/canonical-value.js';

export interface PayloadRetentionHoldProjectionState {
  readonly projectId: string;
  readonly objectId: string;
  readonly stateDigest: string;
  readonly holds: Readonly<Record<string, Readonly<{
    id: string;
    ownerPrincipalId: string;
    reasonCode: 'legal_hold' | 'investigation' | 'regulatory_preservation';
    placedAt: number;
    reviewAt: number;
    review?: Readonly<{ reviewedAt: number }>;
    release?: Readonly<{ releasedBy: string; releasedAt: number }>;
  }>>>;
}

/** Trusted lifecycle reader; it must verify Journal governance proofs before returning state. */
export interface PayloadRetentionHoldOverdueProjectionSourcePort {
  listObjectIds(projectId: string): Promise<readonly string[]>;
  read(projectId: string, objectId: string): Promise<PayloadRetentionHoldProjectionState>;
}

export interface PayloadRetentionHoldOverdueSnapshot {
  readonly version: 1;
  readonly projectId: string;
  readonly clockRevision: number;
  readonly observedAt: number;
  readonly overdue: readonly Readonly<{
    objectId: string;
    stateDigest: string;
    holdId: string;
    ownerPrincipalId: string;
    reasonCode: 'legal_hold' | 'investigation' | 'regulatory_preservation';
    placedAt: number;
    reviewAt: number;
    overdueBy: number;
  }>[];
  readonly digest: string;
}

/** Content-free operational projection. It cannot mutate accepted Project State. */
export class PayloadRetentionHoldOverdueProjection {
  constructor(readonly options: Readonly<{
    source: PayloadRetentionHoldOverdueProjectionSourcePort;
    clock: PayloadLifecycleKernelClockPort;
  }>) {}

  async project(projectId: string, signal: AbortSignal): Promise<PayloadRetentionHoldOverdueSnapshot> {
    signal.throwIfAborted();
    const project = required(projectId, 'Project id');
    const rawClock = await this.options.clock.read({
      operationId: `payload-hold-overdue-projection:${project}`,
      projectId: project,
      objectId: 'payload-hold-overdue-projection',
      purpose: 'retention',
    });
    if (!rawClock) throw new Error('Payload Hold overdue Kernel clock authority is unavailable');
    const clock = createPayloadLifecycleClockSnapshot(rawClock);
    if (canonicalWorkroomJson(clock) !== canonicalWorkroomJson(rawClock)) {
      throw new Error('Payload Hold overdue Kernel clock authority drift');
    }
    const overdue: PayloadRetentionHoldOverdueSnapshot['overdue'][number][] = [];
    const objectIds = [...await this.options.source.listObjectIds(project)].sort();
    if (new Set(objectIds).size !== objectIds.length) {
      throw new Error('Payload Hold overdue object source contains duplicates');
    }
    for (const objectId of objectIds) {
      signal.throwIfAborted();
      const state = await this.options.source.read(project, objectId);
      assertState(state, project, objectId);
      for (const hold of Object.values(state.holds).sort((left, right) => left.id.localeCompare(right.id))) {
        if (hold.release || hold.review || clock.now <= hold.reviewAt) continue;
        overdue.push(deepFreeze({
          objectId,
          stateDigest: state.stateDigest,
          holdId: hold.id,
          ownerPrincipalId: hold.ownerPrincipalId,
          reasonCode: hold.reasonCode,
          placedAt: hold.placedAt,
          reviewAt: hold.reviewAt,
          overdueBy: clock.now - hold.reviewAt,
        }));
      }
    }
    const body = deepFreeze({
      version: 1 as const,
      projectId: project,
      clockRevision: clock.revision,
      observedAt: clock.now,
      overdue: deepFreeze(overdue),
    });
    return deepFreeze({ ...body, digest: digest(body) });
  }
}

function assertState(
  state: PayloadRetentionHoldProjectionState,
  projectId: string,
  objectId: string,
): void {
  if (state.projectId !== projectId || state.objectId !== objectId
    || !/^sha256:[a-f\d]{64}$/u.test(state.stateDigest)) {
    throw new Error('Payload Hold overdue trusted state binding drift');
  }
  for (const [holdId, hold] of Object.entries(state.holds)) {
    if (holdId !== hold.id || !hold.ownerPrincipalId.trim()
      || !['legal_hold', 'investigation', 'regulatory_preservation'].includes(hold.reasonCode)
      || !Number.isSafeInteger(hold.placedAt) || !Number.isSafeInteger(hold.reviewAt)
      || hold.reviewAt <= hold.placedAt) {
      throw new Error('Payload Hold overdue trusted Hold state is invalid');
    }
  }
}

function required(value: string, label: string): string {
  if (typeof value !== 'string' || value.trim() !== value || value.length === 0) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}
