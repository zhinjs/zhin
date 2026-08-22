import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { WorkroomEvent, WorkroomExecutionRole } from './kernel-contracts.js';
import type { WorkroomJournal } from './journal.js';
import { DurableFileStore } from './durable-file-store.js';
import {
  compareCanonicalWorkroomText,
  deepFreezeWorkroomValue as deepFreeze,
  digestCanonicalWorkroomValue as digest,
} from './canonical-value.js';
import type {
  GovernedDisclosureManifestRequest,
  GovernedDisclosureRevalidationResult,
  GovernedProjectionDisclosureResult,
} from '../plugin-runtime/workroom-data-governance-runtime.js';
import type { MaterializedDisclosureManifest } from '../data-governance/disclosure-manifest.js';
import { createWorkroomGovernedDispatchReason } from '../plugin-runtime/workroom-governed-dispatch-reasons.js';
import type { PortfolioSponsorProjection } from '../portfolio/sponsor-projection.js';

export interface WorkroomProjectionConversation {
  readonly endpoint: Readonly<{ id: string; adapter: string }>;
  readonly kind: 'private' | 'group' | 'channel';
  readonly id: string;
  readonly parent?: Readonly<{ kind: 'private' | 'group' | 'channel'; id: string }>;
  readonly threadId?: string;
}

export interface WorkroomProjectionAgentIdentity {
  readonly principalId: string;
  readonly agentDefinitionId: string;
  readonly displayName: string;
  readonly role: 'orchestrator' | WorkroomExecutionRole;
}

export interface WorkroomProjectionBinding {
  readonly version: 1;
  /** Missing only on legacy v1 Workroom bindings. */
  readonly audience?: 'workroom' | 'sponsor_room';
  readonly projectId: string;
  readonly catalogBindingDigest: string;
  readonly bindingRevision: number;
  readonly projectionPolicyRevision: number;
  readonly conversation: WorkroomProjectionConversation;
  readonly orchestrator: WorkroomProjectionAgentIdentity & Readonly<{ role: 'orchestrator' }>;
  readonly agents: readonly WorkroomProjectionAgentIdentity[];
}

export interface WorkroomProjectionTarget {
  readonly projectId: string;
  readonly runId: string;
  readonly taskKey?: string;
  readonly taskRevision?: number;
  readonly assignmentId?: string;
  readonly assignmentRevision?: number;
  readonly agentDefinitionId: string;
}

export interface WorkroomProjectionDeliveryState {
  readonly status: 'pending' | 'leased' | 'failed' | 'sent';
  readonly attempts: number;
  readonly fence: number;
  readonly leaseOwner?: string;
  readonly leaseExpiresAt?: number;
  readonly failureCode?: string;
  readonly retryable?: boolean;
  readonly nextAttemptAt?: number;
  readonly message?: WorkroomProjectionMessageRef;
}

export interface WorkroomProjectionOutboxItem {
  readonly version: 1;
  /** Missing only on legacy v1 Workroom items. */
  readonly audience?: 'workroom' | 'sponsor_room';
  readonly id: string;
  readonly idempotencyKey: string;
  readonly digest: string;
  readonly projectId: string;
  readonly runId: string;
  /** Binding-generation cursor; absent only on pre-migration durable items. */
  readonly cursorId?: string;
  readonly sourceEventIds: readonly string[];
  readonly sourceSequence: number;
  readonly bindingRevision: number;
  readonly projectionPolicyRevision: number;
  readonly conversation: WorkroomProjectionConversation;
  readonly speaker: WorkroomProjectionAgentIdentity;
  readonly kind: 'status' | 'progress' | 'milestone' | 'attention' | 'conclusion';
  /** Exact content-free authority snapshot. The body remains only in the Vault. */
  readonly disclosure: Readonly<{
    request: GovernedDisclosureManifestRequest;
    manifest: MaterializedDisclosureManifest;
  }>;
  readonly target: WorkroomProjectionTarget;
  readonly delivery: WorkroomProjectionDeliveryState;
}

export interface WorkroomProjectionMessageRef {
  readonly conversation: WorkroomProjectionConversation;
  readonly id: string;
}

export interface WorkroomProjectionMessageIndexEntry {
  readonly projectionId: string;
  readonly bindingRevision: number;
  readonly sourceEventIds: readonly string[];
  readonly target: WorkroomProjectionTarget;
  readonly speaker: WorkroomProjectionAgentIdentity;
  readonly message: WorkroomProjectionMessageRef;
}

export interface WorkroomProjectionActiveAssignmentTarget {
  readonly projectId: string;
  readonly runId: string;
  readonly taskKey: string;
  readonly taskRevision: number;
  readonly assignmentId: string;
  readonly assignmentRevision: number;
}

export interface WorkroomProjectionReplyTargetInput {
  readonly projectId: string;
  readonly bindingRevision: number;
  readonly replyTo: WorkroomProjectionMessageRef;
  readonly intent: 'discussion' | 'task_input';
  readonly activeAssignments: readonly WorkroomProjectionActiveAssignmentTarget[];
}

export type WorkroomProjectionReplyTargetDecision =
  | Readonly<{
      status: 'task_target';
      via: 'reply';
      disposition: 'discussion_only' | 'context_proposal';
      sourceProjectionId: string;
      sourceEventIds: readonly string[];
      target: WorkroomProjectionActiveAssignmentTarget & Readonly<{
        agentDefinitionId: string;
        status: 'active' | 'historical';
      }>;
    }>
  | Readonly<{
      status: 'clarification_required';
      reason: 'target_not_found' | 'cross_project_target' | 'stale_binding' | 'non_task_projection';
      candidateRefs: readonly string[];
    }>;

export interface WorkroomProjectionState {
  readonly revision: number;
  readonly bindings: Readonly<Record<string, WorkroomProjectionBinding>>;
  readonly cursors: Readonly<Record<string, number>>;
  readonly items: Readonly<Record<string, WorkroomProjectionOutboxItem>>;
  readonly messageIndex: Readonly<Record<string, WorkroomProjectionMessageIndexEntry>>;
}

export interface WorkroomProjectionCapture {
  readonly runId: string;
  readonly expectedCursor: number;
  readonly cursor: number;
  readonly items: readonly WorkroomProjectionOutboxItem[];
}

export interface WorkroomProjectionRepository {
  read(): Promise<WorkroomProjectionState>;
  bind(
    expectedRevision: number,
    binding: WorkroomProjectionBinding,
  ): Promise<WorkroomProjectionState>;
  capture(expectedRevision: number, input: WorkroomProjectionCapture): Promise<WorkroomProjectionState>;
  claimNext(
    expectedRevision: number,
    workerId: string,
    now: number,
    leaseMs: number,
  ): Promise<WorkroomProjectionOutboxItem | undefined>;
  settle(
    expectedRevision: number,
    itemId: string,
    workerId: string,
    fence: number,
    result: WorkroomProjectionDeliveryResult,
    settledAt: number,
  ): Promise<WorkroomProjectionState>;
}

export type WorkroomProjectionDeliveryResult =
  | Readonly<{ status: 'sent'; message?: WorkroomProjectionMessageRef }>
  | Readonly<{ status: 'failed'; code: string; retryable: boolean }>;

export interface WorkroomProjectionDeliveryPort {
  send(
    item: WorkroomProjectionOutboxItem,
    body: Uint8Array,
    signal: AbortSignal,
  ): Promise<WorkroomProjectionDeliveryResult>;
}

export interface WorkroomProjectionGovernancePort {
  prepareProjection(
    input: Readonly<{
      operationId: string;
      projectId: string;
      sinkRuleId: string;
      body: string;
      sourceEventIds: readonly string[];
    }>,
    signal: AbortSignal,
  ): Promise<GovernedProjectionDisclosureResult>;
  revalidate(
    input: Readonly<{
      request: GovernedDisclosureManifestRequest;
      manifest: MaterializedDisclosureManifest;
    }>,
    signal: AbortSignal,
  ): Promise<GovernedDisclosureRevalidationResult>;
}

export interface WorkroomLifecycleHoldOverdueSnapshot {
  readonly version: 1;
  readonly projectId: string;
  readonly clockRevision: number;
  readonly observedAt: number;
  readonly overdue: readonly Readonly<{
    objectId: string;
    stateSequence: number;
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

export class WorkroomProjectionRevisionConflictError extends Error {
  constructor(
    readonly expectedRevision: number,
    readonly actualRevision: number,
  ) {
    super(`Workroom Projection revision conflict: expected ${expectedRevision}, actual ${actualRevision}`);
    this.name = 'WorkroomProjectionRevisionConflictError';
  }
}

export class MemoryWorkroomProjectionRepository implements WorkroomProjectionRepository {
  #state: WorkroomProjectionState = emptyProjectionState();

  async read(): Promise<WorkroomProjectionState> {
    return this.#state;
  }

  async bind(expectedRevision: number, binding: WorkroomProjectionBinding) {
    this.#assertRevision(expectedRevision);
    this.#state = applyBinding(this.#state, binding);
    return this.#state;
  }

  async capture(
    expectedRevision: number,
    input: WorkroomProjectionCapture,
  ): Promise<WorkroomProjectionState> {
    if (this.#state.revision !== expectedRevision) {
      throw new WorkroomProjectionRevisionConflictError(expectedRevision, this.#state.revision);
    }
    this.#state = applyCapture(this.#state, input);
    return this.#state;
  }

  async claimNext(expectedRevision: number, workerId: string, now: number, leaseMs: number) {
    this.#assertRevision(expectedRevision);
    const claimed = applyClaim(this.#state, workerId, now, leaseMs);
    if (!claimed) return undefined;
    this.#state = claimed.state;
    return claimed.item;
  }

  async settle(
    expectedRevision: number,
    itemId: string,
    workerId: string,
    fence: number,
    result: WorkroomProjectionDeliveryResult,
    settledAt: number,
  ) {
    this.#assertRevision(expectedRevision);
    this.#state = applySettlement(this.#state, itemId, workerId, fence, result, settledAt);
    return this.#state;
  }

  #assertRevision(expectedRevision: number): void {
    if (this.#state.revision !== expectedRevision) {
      throw new WorkroomProjectionRevisionConflictError(expectedRevision, this.#state.revision);
    }
  }
}

/** Crash-durable, cross-process CAS snapshots for one Projection binding. */
export class FileWorkroomProjectionRepository implements WorkroomProjectionRepository {
  readonly #store: DurableFileStore;

  constructor(directory: string) {
    this.#store = new DurableFileStore(directory);
  }

  async read(): Promise<WorkroomProjectionState> {
    let names: string[];
    try {
      names = (await readdir(this.#store.directory))
        .filter(name => /^projection\.[0-9]{16}\.json$/u.test(name))
        .sort();
    } catch (error) {
      if (hasCode(error, 'ENOENT')) return emptyProjectionState();
      throw error;
    }
    if (names.length === 0) return emptyProjectionState();
    for (let index = 0; index < names.length; index += 1) {
      const expected = projectionSnapshotName(index + 1);
      if (names[index] !== expected) {
        throw new Error(`Workroom Projection snapshot gap before revision ${index + 1}`);
      }
    }
    const parsed = JSON.parse(await readFile(
      join(this.#store.directory, names.at(-1)!),
      'utf8',
    )) as unknown;
    return parseProjectionState(parsed, names.length);
  }

  async capture(
    expectedRevision: number,
    input: WorkroomProjectionCapture,
  ): Promise<WorkroomProjectionState> {
    const current = await this.read();
    if (current.revision !== expectedRevision) {
      throw new WorkroomProjectionRevisionConflictError(expectedRevision, current.revision);
    }
    const next = applyCapture(current, input);
    return await this.#publish(expectedRevision, next);
  }

  async bind(
    expectedRevision: number,
    binding: WorkroomProjectionBinding,
  ): Promise<WorkroomProjectionState> {
    const current = await this.read();
    if (current.revision !== expectedRevision) {
      throw new WorkroomProjectionRevisionConflictError(expectedRevision, current.revision);
    }
    const next = applyBinding(current, binding);
    if (next === current) return current;
    return await this.#publish(expectedRevision, next);
  }

  async claimNext(
    expectedRevision: number,
    workerId: string,
    now: number,
    leaseMs: number,
  ): Promise<WorkroomProjectionOutboxItem | undefined> {
    const current = await this.read();
    if (current.revision !== expectedRevision) {
      throw new WorkroomProjectionRevisionConflictError(expectedRevision, current.revision);
    }
    const claimed = applyClaim(current, workerId, now, leaseMs);
    if (!claimed) return undefined;
    const persisted = await this.#publish(expectedRevision, claimed.state);
    return persisted.items[claimed.item.id];
  }

  async settle(
    expectedRevision: number,
    itemId: string,
    workerId: string,
    fence: number,
    result: WorkroomProjectionDeliveryResult,
    settledAt: number,
  ): Promise<WorkroomProjectionState> {
    const current = await this.read();
    if (current.revision !== expectedRevision) {
      throw new WorkroomProjectionRevisionConflictError(expectedRevision, current.revision);
    }
    return await this.#publish(
      expectedRevision,
      applySettlement(current, itemId, workerId, fence, result, settledAt),
    );
  }

  async #publish(
    expectedRevision: number,
    next: WorkroomProjectionState,
  ): Promise<WorkroomProjectionState> {
    await this.#store.ensureDurableLeaf('Workroom Projection repository');
    const target = join(this.#store.directory, projectionSnapshotName(next.revision));
    const published = await this.#store.publishCreateOnly({
      target,
      content: JSON.stringify({ state: next, digest: digest(next) }),
      createdValue: next,
      onConflict: async () => {
        const winner = parseProjectionState(
          JSON.parse(await readFile(target, 'utf8')) as unknown,
          next.revision,
        );
        if (digest(winner) === digest(next)) return await this.read();
        const latest = await this.read();
        throw new WorkroomProjectionRevisionConflictError(expectedRevision, latest.revision);
      },
    });
    return published.value;
  }
}

export interface WorkroomProjectionDeliveryWorkerOptions {
  readonly repository: WorkroomProjectionRepository;
  readonly outbound: WorkroomProjectionDeliveryPort;
  readonly workerId: string;
  readonly leaseMs: number;
  readonly governance?: WorkroomProjectionGovernancePort;
  readonly authority?: Readonly<{
    authorize(item: WorkroomProjectionOutboxItem): Promise<boolean>;
  }>;
  /** Completion clock; production defaults to wall time, tests may inject a deterministic clock. */
  readonly now?: () => number;
}

/** At-least-once delivery worker; Projection receipts never mutate Kernel facts. */
export class WorkroomProjectionDeliveryWorker {
  readonly #repository: WorkroomProjectionRepository;
  readonly #outbound: WorkroomProjectionDeliveryPort;
  readonly #workerId: string;
  readonly #leaseMs: number;
  readonly #governance?: WorkroomProjectionGovernancePort;
  readonly #authority?: WorkroomProjectionDeliveryWorkerOptions['authority'];
  readonly #now: () => number;

  constructor(options: WorkroomProjectionDeliveryWorkerOptions) {
    requireText(options.workerId, 'workerId');
    requirePositiveInteger(options.leaseMs, 'leaseMs');
    this.#repository = options.repository;
    this.#outbound = options.outbound;
    this.#workerId = options.workerId;
    this.#leaseMs = options.leaseMs;
    this.#governance = options.governance;
    this.#authority = options.authority;
    this.#now = options.now ?? Date.now;
  }

  async runOnce(
    now: number,
    signal: AbortSignal,
  ): Promise<WorkroomProjectionDeliveryResult | Readonly<{ status: 'idle' }>> {
    requireFiniteNumber(now, 'delivery now');
    signal.throwIfAborted();
    const claimed = await this.#claim(now);
    if (!claimed) return Object.freeze({ status: 'idle' });
    let result: WorkroomProjectionDeliveryResult;
    try {
      const authorized = this.#authority ? await this.#authority.authorize(claimed) : true;
      if (!authorized) {
        result = Object.freeze({
          status: 'failed', code: 'catalog_binding_stale', retryable: false,
        });
      } else if (!this.#governance) {
        result = Object.freeze({
          status: 'failed', code: 'project_authority_unavailable', retryable: false,
        });
      } else {
        const governed = await this.#governance.revalidate(claimed.disclosure, signal);
        result = governed.status === 'blocked'
          ? (() => {
              const reason = createWorkroomGovernedDispatchReason(governed.reason);
              return Object.freeze({
                status: 'failed' as const, code: reason.code, retryable: reason.retryable,
              });
            })()
          : normalizeDeliveryResult(await this.#outbound.send(claimed, governed.body, signal));
      }
    } catch (error) {
      if (signal.aborted) throw signal.reason ?? error;
      result = Object.freeze({ status: 'failed', code: 'transport_error', retryable: true });
    }
    // Once send returned a receipt the external effect already happened;
    // cancellation must not discard it and cause a blind duplicate retry.
    const settledAt = this.#now();
    requireFiniteNumber(settledAt, 'delivery completion time');
    await this.#settle(claimed, result, settledAt);
    return result;
  }

  async #claim(now: number): Promise<WorkroomProjectionOutboxItem | undefined> {
    for (let conflict = 0; conflict < 8; conflict += 1) {
      const state = await this.#repository.read();
      try {
        return await this.#repository.claimNext(
          state.revision,
          this.#workerId,
          now,
          this.#leaseMs,
        );
      } catch (error) {
        if (!(error instanceof WorkroomProjectionRevisionConflictError)) throw error;
      }
    }
    throw new Error('Workroom Projection delivery claim CAS retries exhausted');
  }

  async #settle(
    item: WorkroomProjectionOutboxItem,
    result: WorkroomProjectionDeliveryResult,
    settledAt: number,
  ): Promise<void> {
    for (let conflict = 0; conflict < 8; conflict += 1) {
      const state = await this.#repository.read();
      try {
        await this.#repository.settle(
          state.revision,
          item.id,
          this.#workerId,
          item.delivery.fence,
          result,
          settledAt,
        );
        return;
      } catch (error) {
        if (!(error instanceof WorkroomProjectionRevisionConflictError)) throw error;
      }
    }
    throw new Error('Workroom Projection delivery settlement CAS retries exhausted');
  }
}

export interface WorkroomProjectionTracerOptions {
  readonly journal: WorkroomJournal;
  readonly repository: WorkroomProjectionRepository;
  readonly governance?: WorkroomProjectionGovernancePort;
}

/** Durable cursor tracer from authoritative Kernel events to an IM outbox. */
export class WorkroomProjectionTracer {
  readonly #journal: WorkroomJournal;
  readonly #repository: WorkroomProjectionRepository;
  readonly #governance?: WorkroomProjectionGovernancePort;

  constructor(options: WorkroomProjectionTracerOptions) {
    this.#journal = options.journal;
    this.#repository = options.repository;
    this.#governance = options.governance;
  }

  async capture(
    bindingValue: WorkroomProjectionBinding,
    runId: string,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<WorkroomProjectionState> {
    const binding = freezeAndValidateBinding(bindingValue);
    const events = await this.#journal.read(runId);
    if (events.length === 0) throw new Error(`Workroom Projection Run ${runId} not found`);
    if (events[0]?.payload.projectId !== binding.projectId) {
      throw new Error('Workroom Projection binding targets another Project');
    }
    for (let conflict = 0; conflict < 8; conflict += 1) {
      const current = await this.#repository.read();
      const cursorId = projectionBindingCursorKey(runId, binding);
      const storedCursor = current.cursors[cursorId];
      const legacyCursor = storedCursor === undefined
        ? exactLegacyBindingCursor(current, runId, binding)
        : undefined;
      const cursor = storedCursor ?? legacyCursor ?? -1;
      const expectedCursor = storedCursor ?? -1;
      const sourceSequence = events.at(-1)?.sequence ?? -1;
      if (cursor > sourceSequence) {
        throw new Error('Workroom Projection legacy cursor exceeds the authoritative Journal');
      }
      if (cursor >= sourceSequence) {
        return legacyCursor === undefined
          ? current
          : await this.#repository.capture(current.revision, {
              runId: cursorId,
              expectedCursor,
              cursor,
              items: [],
            });
      }
      const rawProjection = projectEvents(events, cursor, binding);
      const projected = deepFreeze({
        cursor: rawProjection.cursor,
        items: rawProjection.items.map(item => deepFreeze({ ...item, cursorId })),
      });
      if (projected.cursor <= cursor) return current;
      if (!this.#governance && projected.items.length > 0) {
        throw new Error('Workroom Projection governance authority is unavailable');
      }
      const governedItems = await Promise.all(projected.items.map(async (draft) => {
        const governed = await this.#governance!.prepareProjection({
          operationId: `projection:${binding.projectId}:${runId}:${draft.sourceSequence}`,
          projectId: binding.projectId,
          sinkRuleId: 'projection:workroom',
          body: draft.content,
          sourceEventIds: draft.sourceEventIds,
        }, signal);
        if (governed.status === 'blocked') {
          throw new Error(`Workroom Projection disclosure blocked: ${governed.reason}`);
        }
        return materializeProjectionItem(draft, governed);
      }));
      try {
        return await this.#repository.capture(current.revision, {
          runId: cursorId,
          expectedCursor,
          cursor: projected.cursor,
          items: governedItems,
        });
      } catch (error) {
        if (!(error instanceof WorkroomProjectionRevisionConflictError)) throw error;
      }
    }
    throw new Error('Workroom Projection capture CAS retries exhausted');
  }

  /** Capture content-free P12 Hold review facts into the same governed IM outbox. */
  async captureLifecycleOverdue(
    bindingValue: WorkroomProjectionBinding,
    snapshotValue: WorkroomLifecycleHoldOverdueSnapshot,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<WorkroomProjectionState> {
    const binding = freezeAndValidateBinding(bindingValue);
    const snapshot = validateLifecycleOverdueSnapshot(snapshotValue);
    if (snapshot.projectId !== binding.projectId) {
      throw new Error('Workroom Lifecycle Projection binding targets another Project');
    }
    const byObject = new Map<string, typeof snapshot.overdue>();
    for (const item of snapshot.overdue) {
      byObject.set(item.objectId, [...(byObject.get(item.objectId) ?? []), item]);
    }
    let state = await this.#repository.read();
    for (const objectId of [...byObject.keys()].sort(compareCanonicalWorkroomText)) {
      signal.throwIfAborted();
      state = await this.#captureLifecycleObject(
        binding, objectId, byObject.get(objectId)!, signal,
      );
    }
    return state;
  }

  /** Publishes one Project-scoped card from a content-free Portfolio projection. */
  async capturePortfolioSponsor(
    bindingValue: WorkroomProjectionBinding,
    projectionValue: PortfolioSponsorProjection,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<WorkroomProjectionState> {
    signal.throwIfAborted();
    const binding = freezeAndValidateBinding(bindingValue);
    if (projectionAudience(binding) !== 'sponsor_room') {
      throw new Error('Portfolio Sponsor projection requires a Sponsor Room binding');
    }
    const { digest: suppliedDigest, ...projectionBody } = projectionValue;
    if (suppliedDigest !== digest(projectionBody)) {
      throw new Error('Portfolio Sponsor projection digest mismatch');
    }
    const project = projectionValue.projects[binding.projectId];
    if (!project || project.projectId !== binding.projectId) {
      throw new Error('Portfolio Sponsor projection does not contain the binding Project');
    }
    const runId = workroomPortfolioProjectionCursorKey(
      projectionValue.portfolioId, binding.projectId,
    );
    const cursorId = projectionBindingCursorKey(runId, binding);
    for (let conflict = 0; conflict < 8; conflict += 1) {
      const current = await this.#repository.read();
      const storedCursor = current.cursors[cursorId];
      const legacyCursor = storedCursor === undefined
        ? exactLegacyBindingCursor(current, runId, binding)
        : undefined;
      const cursor = storedCursor ?? legacyCursor ?? -1;
      const expectedCursor = storedCursor ?? -1;
      if (cursor > projectionValue.sourceSequence) {
        throw new Error('Portfolio Sponsor legacy cursor exceeds the authoritative projection');
      }
      if (cursor >= projectionValue.sourceSequence) {
        return legacyCursor === undefined
          ? current
          : await this.#repository.capture(current.revision, {
              runId: cursorId,
              expectedCursor,
              cursor,
              items: [],
            });
      }
      const draft = deepFreeze({
        ...portfolioSponsorDraft(binding, projectionValue, runId),
        cursorId,
      });
      if (!this.#governance) {
        throw new Error('Workroom Projection governance authority is unavailable');
      }
      const governed = await this.#governance.prepareProjection({
        operationId: `projection:${draft.sourceEventIds[0]}`,
        projectId: binding.projectId,
        sinkRuleId: 'projection:sponsor-room',
        body: draft.content,
        sourceEventIds: draft.sourceEventIds,
      }, signal);
      if (governed.status === 'blocked') {
        throw new Error(`Workroom Projection disclosure blocked: ${governed.reason}`);
      }
      try {
        return await this.#repository.capture(current.revision, {
          runId: cursorId,
          expectedCursor,
          cursor: projectionValue.sourceSequence,
          items: [materializeProjectionItem(draft, governed)],
        });
      } catch (error) {
        if (!(error instanceof WorkroomProjectionRevisionConflictError) || conflict === 7) throw error;
      }
    }
    throw new Error('Portfolio Sponsor projection capture retries exhausted');
  }

  async #captureLifecycleObject(
    binding: WorkroomProjectionBinding,
    objectId: string,
    values: WorkroomLifecycleHoldOverdueSnapshot['overdue'],
    signal: AbortSignal,
  ): Promise<WorkroomProjectionState> {
    const stateSequences = new Set(values.map(value => value.stateSequence));
    const stateDigests = new Set(values.map(value => value.stateDigest));
    if (stateSequences.size !== 1 || stateDigests.size !== 1) {
      throw new Error('Workroom Lifecycle Projection object state binding is inconsistent');
    }
    const runId = workroomLifecycleProjectionCursorKey(binding.projectId, objectId);
    const cursorId = projectionBindingCursorKey(runId, binding);
    for (let conflict = 0; conflict < 8; conflict += 1) {
      const current = await this.#repository.read();
      const cursor = current.cursors[cursorId] ?? -1;
      const existingSources = new Set(Object.values(current.items)
        .filter(item => item.projectId === binding.projectId
          && item.bindingRevision === binding.bindingRevision)
        .flatMap(item => item.sourceEventIds));
      const pending = values
        .filter(value => !existingSources.has(lifecycleOverdueSourceEventId(binding.projectId, value)))
        .sort((left, right) => compareCanonicalWorkroomText(
          lifecycleOverdueSourceEventId(binding.projectId, left),
          lifecycleOverdueSourceEventId(binding.projectId, right),
        ));
      if (pending.length === 0) return current;
      const drafts = pending.map((value, index) => deepFreeze({
        ...lifecycleOverdueDraft(binding, runId, value, cursor + index + 1),
        cursorId,
      }));
      if (!this.#governance && drafts.length > 0) {
        throw new Error('Workroom Projection governance authority is unavailable');
      }
      const governedItems = await Promise.all(drafts.map(async draft => {
        const governed = await this.#governance!.prepareProjection({
          operationId: `projection:${draft.sourceEventIds[0]}`,
          projectId: binding.projectId,
          sinkRuleId: 'projection:sponsor-room',
          body: draft.content,
          sourceEventIds: draft.sourceEventIds,
        }, signal);
        if (governed.status === 'blocked') {
          throw new Error(`Workroom Projection disclosure blocked: ${governed.reason}`);
        }
        return materializeProjectionItem(draft, governed);
      }));
      try {
        return await this.#repository.capture(current.revision, {
          runId: cursorId,
          expectedCursor: cursor,
          cursor: cursor + drafts.length,
          items: governedItems,
        });
      } catch (error) {
        if (!(error instanceof WorkroomProjectionRevisionConflictError)) throw error;
      }
    }
    throw new Error('Workroom Lifecycle Projection capture CAS retries exhausted');
  }
}

function emptyProjectionState(): WorkroomProjectionState {
  return deepFreeze({ revision: 0, bindings: {}, cursors: {}, items: {}, messageIndex: {} });
}

function projectionSnapshotName(revision: number): string {
  return `projection.${String(revision).padStart(16, '0')}.json`;
}

function parseProjectionState(value: unknown, expectedRevision: number): WorkroomProjectionState {
  const snapshot = requireRecord(value, 'snapshot');
  assertExactRecordKeys(snapshot, ['state', 'digest'], 'snapshot');
  const state = requireRecord(snapshot.state, 'snapshot.state');
  if (typeof snapshot.digest !== 'string' || digest(state) !== snapshot.digest) {
    throw new Error('Workroom Projection snapshot digest mismatch');
  }
  assertExactRecordKeys(
    state,
    ['revision', 'bindings', 'cursors', 'items', 'messageIndex'],
    'snapshot.state',
  );
  if (state.revision !== expectedRevision) {
    throw new Error('Workroom Projection snapshot revision mismatch');
  }
  const bindings = requireRecord(state.bindings, 'snapshot.bindings');
  const cursors = requireRecord(state.cursors, 'snapshot.cursors');
  const items = requireRecord(state.items, 'snapshot.items');
  const messageIndex = requireRecord(state.messageIndex, 'snapshot.messageIndex');
  for (const [bindingKey, bindingValue] of Object.entries(bindings)) {
    const binding = freezeAndValidateBinding(bindingValue as WorkroomProjectionBinding);
    if (workroomProjectionBindingKey(binding.projectId, projectionAudience(binding)) !== bindingKey) {
      throw new Error('Workroom Projection binding key mismatch');
    }
  }
  for (const [runId, cursor] of Object.entries(cursors)) {
    requireText(runId, 'snapshot cursor runId');
    requireSequence(cursor, 'snapshot cursor', 0);
  }
  for (const [itemId, itemValue] of Object.entries(items)) {
    const item = itemValue as WorkroomProjectionOutboxItem;
    if (item?.id !== itemId) throw new Error('Workroom Projection snapshot item key mismatch');
    const cursorId = item.cursorId ?? item.runId;
    assertProjectionItem(item, cursorId, -1, Number.MAX_SAFE_INTEGER);
    assertDeliveryState(item.delivery, item.conversation);
    const cursor = cursors[cursorId];
    if (typeof cursor !== 'number' || cursor < item.sourceSequence) {
      throw new Error('Workroom Projection snapshot item exceeds durable cursor');
    }
  }
  for (const [key, entryValue] of Object.entries(messageIndex)) {
    const entry = entryValue as WorkroomProjectionMessageIndexEntry;
    const item = items[entry?.projectionId] as WorkroomProjectionOutboxItem | undefined;
    if (!item
      || workroomProjectionMessageKey(entry.message) !== key
      || item.delivery.status !== 'sent'
      || !item.delivery.message
      || workroomProjectionMessageKey(item.delivery.message) !== key
      || entry.bindingRevision !== item.bindingRevision
      || digest(entry.sourceEventIds) !== digest(item.sourceEventIds)
      || digest(entry.target) !== digest(item.target)
      || digest(entry.speaker) !== digest(item.speaker)) {
      throw new Error('Workroom Projection Message Index entry is invalid');
    }
  }
  return deepFreeze({
    revision: expectedRevision,
    bindings: { ...bindings },
    cursors: { ...cursors },
    items: { ...items },
    messageIndex: { ...messageIndex },
  }) as WorkroomProjectionState;
}

function applyBinding(
  state: WorkroomProjectionState,
  value: WorkroomProjectionBinding,
): WorkroomProjectionState {
  const binding = freezeAndValidateBinding(value);
  const key = workroomProjectionBindingKey(binding.projectId, projectionAudience(binding));
  const current = state.bindings[key];
  if (current && digest(normalizeLegacyBindingAudience(current))
    === digest(normalizeLegacyBindingAudience(binding))) return state;
  if (current && binding.bindingRevision <= current.bindingRevision) {
    throw new Error('Workroom Projection binding revision must advance');
  }
  return deepFreeze({
    ...state,
    revision: state.revision + 1,
    bindings: { ...state.bindings, [key]: binding },
  });
}

function normalizeLegacyBindingAudience(
  binding: WorkroomProjectionBinding,
): WorkroomProjectionBinding {
  return binding.audience === undefined
    ? deepFreeze({ ...binding, audience: 'workroom' as const })
    : binding;
}

function applyClaim(
  state: WorkroomProjectionState,
  workerId: string,
  now: number,
  leaseMs: number,
): Readonly<{ state: WorkroomProjectionState; item: WorkroomProjectionOutboxItem }> | undefined {
  requireText(workerId, 'claim.workerId');
  requireFiniteNumber(now, 'claim.now');
  requirePositiveInteger(leaseMs, 'claim.leaseMs');
  const current = Object.values(state.items)
    .filter(item => item.delivery.status === 'pending'
      || (item.delivery.status === 'failed' && item.delivery.retryable === true
        && (item.delivery.nextAttemptAt === undefined || item.delivery.nextAttemptAt <= now))
      || (item.delivery.status === 'leased'
        && Number(item.delivery.leaseExpiresAt) <= now))
    .sort((left, right) => left.sourceSequence - right.sourceSequence || compareCanonicalWorkroomText(left.id, right.id))[0];
  if (!current) return undefined;
  const item = deepFreeze({
    ...current,
    delivery: {
      status: 'leased' as const,
      attempts: current.delivery.attempts + 1,
      fence: current.delivery.fence + 1,
      leaseOwner: workerId,
      leaseExpiresAt: now + leaseMs,
    },
  });
  return deepFreeze({
    item,
    state: {
      ...state,
      revision: state.revision + 1,
      items: { ...state.items, [item.id]: item },
    },
  });
}

function applySettlement(
  state: WorkroomProjectionState,
  itemId: string,
  workerId: string,
  fence: number,
  resultValue: WorkroomProjectionDeliveryResult,
  settledAt: number,
): WorkroomProjectionState {
  requireFiniteNumber(settledAt, 'delivery settledAt');
  const current = state.items[itemId];
  if (!current
    || current.delivery.status !== 'leased'
    || current.delivery.leaseOwner !== workerId
    || current.delivery.fence !== fence) {
    throw new Error('Workroom Projection delivery settlement is stale or not owned');
  }
  const result = normalizeDeliveryResult(resultValue);
  const delivery: WorkroomProjectionDeliveryState = result.status === 'sent'
    ? {
        status: 'sent',
        attempts: current.delivery.attempts,
        fence: current.delivery.fence,
        ...(result.message ? { message: result.message } : {}),
      }
    : {
        status: 'failed',
        attempts: current.delivery.attempts,
        fence: current.delivery.fence,
        failureCode: result.code,
        retryable: result.retryable,
        ...(result.retryable ? { nextAttemptAt: settledAt + retryDelay(current.delivery.attempts) } : {}),
      };
  const item = deepFreeze({ ...current, delivery });
  let messageIndex = state.messageIndex;
  if (result.status === 'sent' && result.message) {
    if (digest(result.message.conversation) !== digest(current.conversation)) {
      throw new Error('Workroom Projection receipt targets another conversation');
    }
    const key = workroomProjectionMessageKey(result.message);
    const entry = deepFreeze({
      projectionId: current.id,
      bindingRevision: current.bindingRevision,
      sourceEventIds: current.sourceEventIds,
      target: current.target,
      speaker: current.speaker,
      message: result.message,
    });
    const existing = messageIndex[key];
    if (existing && digest(existing) !== digest(entry)) {
      throw new Error('Workroom Projection Message Index conflict');
    }
    messageIndex = { ...messageIndex, [key]: entry };
  }
  return deepFreeze({
    ...state,
    revision: state.revision + 1,
    items: { ...state.items, [itemId]: item },
    messageIndex,
  });
}

function normalizeDeliveryResult(value: WorkroomProjectionDeliveryResult): WorkroomProjectionDeliveryResult {
  if (value?.status === 'failed') {
    requireText(value.code, 'delivery failure code');
    if (typeof value.retryable !== 'boolean') {
      throw new Error('Workroom Projection delivery retryable must be boolean');
    }
    return deepFreeze({ status: 'failed', code: value.code, retryable: value.retryable });
  }
  if (value?.status !== 'sent') throw new Error('Workroom Projection delivery result is invalid');
  if (!value.message) return Object.freeze({ status: 'sent' });
  requireConversation(value.message.conversation);
  requireText(value.message.id, 'delivery message.id');
  return deepFreeze({ status: 'sent', message: value.message });
}

function assertDeliveryState(
  value: WorkroomProjectionDeliveryState,
  conversation: WorkroomProjectionConversation,
): void {
  const delivery = requireRecord(value, 'delivery state');
  if (!Number.isSafeInteger(delivery.attempts) || Number(delivery.attempts) < 0
    || !Number.isSafeInteger(delivery.fence) || Number(delivery.fence) < 0
    || delivery.attempts !== delivery.fence) {
    throw new Error('Workroom Projection delivery attempt/fence is invalid');
  }
  if (delivery.status === 'pending') {
    assertExactRecordKeys(delivery, ['status', 'attempts', 'fence'], 'pending delivery');
    if (delivery.attempts !== 0) throw new Error('Workroom Projection pending delivery was attempted');
    return;
  }
  if (delivery.status === 'leased') {
    assertExactRecordKeys(
      delivery,
      ['status', 'attempts', 'fence', 'leaseOwner', 'leaseExpiresAt'],
      'leased delivery',
    );
    requireText(delivery.leaseOwner, 'delivery.leaseOwner');
    requireFiniteNumber(delivery.leaseExpiresAt, 'delivery.leaseExpiresAt');
    return;
  }
  if (delivery.status === 'failed') {
    assertExactRecordKeys(
      delivery,
      ['status', 'attempts', 'fence', 'failureCode', 'retryable',
        ...(delivery.nextAttemptAt !== undefined ? ['nextAttemptAt'] : [])],
      'failed delivery',
    );
    requireText(delivery.failureCode, 'delivery.failureCode');
    if (typeof delivery.retryable !== 'boolean') {
      throw new Error('Workroom Projection failed delivery retryable is invalid');
    }
    if (delivery.nextAttemptAt !== undefined) {
      if (delivery.retryable !== true) {
        throw new Error('Workroom Projection non-retryable delivery cannot have nextAttemptAt');
      }
      requireFiniteNumber(delivery.nextAttemptAt, 'delivery.nextAttemptAt');
    }
    return;
  }
  if (delivery.status !== 'sent') {
    throw new Error('Workroom Projection delivery status is invalid');
  }
  assertExactRecordKeys(
    delivery,
    ['status', 'attempts', 'fence', ...(delivery.message ? ['message'] : [])],
    'sent delivery',
  );
  if (delivery.message) {
    const message = delivery.message as WorkroomProjectionMessageRef;
    workroomProjectionMessageKey(message);
    if (digest(message.conversation) !== digest(conversation)) {
      throw new Error('Workroom Projection persisted receipt targets another conversation');
    }
  }
}

function retryDelay(attempts: number): number {
  return Math.min(60_000, 1_000 * 2 ** Math.min(6, Math.max(0, attempts - 1)));
}

export function workroomProjectionMessageKey(value: WorkroomProjectionMessageRef): string {
  if (!value) throw new Error('Workroom Projection MessageRef is required');
  requireConversation(value.conversation);
  requireText(value.id, 'message.id');
  return [
    value.conversation.endpoint.adapter,
    value.conversation.endpoint.id,
    value.conversation.kind,
    value.conversation.id,
    value.conversation.parent?.kind ?? '',
    value.conversation.parent?.id ?? '',
    value.conversation.threadId ?? '',
    value.id,
  ].join('\0');
}

/** Pure Message Index lookup; it proposes context and owns no Kernel command port. */
export function resolveProjectionReplyTarget(
  state: WorkroomProjectionState,
  input: WorkroomProjectionReplyTargetInput,
): WorkroomProjectionReplyTargetDecision {
  requireText(input.projectId, 'reply projectId');
  requirePositiveInteger(input.bindingRevision, 'reply bindingRevision');
  const entry = state.messageIndex[workroomProjectionMessageKey(input.replyTo)];
  if (!entry) {
    return deepFreeze({
      status: 'clarification_required',
      reason: 'target_not_found',
      candidateRefs: [],
    });
  }
  if (entry.target.projectId !== input.projectId) {
    return deepFreeze({
      status: 'clarification_required',
      reason: 'cross_project_target',
      candidateRefs: [entry.target.projectId],
    });
  }
  if (input.bindingRevision !== entry.bindingRevision) {
    return deepFreeze({
      status: 'clarification_required',
      reason: 'stale_binding',
      candidateRefs: [entry.projectionId],
    });
  }
  const target = entry.target;
  if (!target.taskKey || !target.taskRevision
    || !target.assignmentId || !target.assignmentRevision) {
    return deepFreeze({
      status: 'clarification_required',
      reason: 'non_task_projection',
      candidateRefs: [entry.projectionId],
    });
  }
  const active = input.activeAssignments.some(candidate =>
    candidate.projectId === target.projectId
    && candidate.runId === target.runId
    && candidate.taskKey === target.taskKey
    && candidate.taskRevision === target.taskRevision
    && candidate.assignmentId === target.assignmentId
    && candidate.assignmentRevision === target.assignmentRevision);
  return deepFreeze({
    status: 'task_target',
    via: 'reply',
    disposition: input.intent === 'task_input' && active
      ? 'context_proposal'
      : 'discussion_only',
    sourceProjectionId: entry.projectionId,
    sourceEventIds: entry.sourceEventIds,
    target: {
      projectId: target.projectId,
      runId: target.runId,
      taskKey: target.taskKey,
      taskRevision: target.taskRevision,
      assignmentId: target.assignmentId,
      assignmentRevision: target.assignmentRevision,
      agentDefinitionId: target.agentDefinitionId,
      status: active ? 'active' : 'historical',
    },
  });
}

function applyCapture(
  state: WorkroomProjectionState,
  input: WorkroomProjectionCapture,
): WorkroomProjectionState {
  requireText(input.runId, 'capture.runId');
  requireSequence(input.expectedCursor, 'capture.expectedCursor', -1);
  requireSequence(input.cursor, 'capture.cursor', 0);
  const currentCursor = state.cursors[input.runId] ?? -1;
  if (currentCursor !== input.expectedCursor) {
    throw new Error(`Workroom Projection cursor conflict for ${input.runId}`);
  }
  if (input.cursor <= input.expectedCursor) {
    throw new Error('Workroom Projection capture cursor must advance');
  }
  const items = { ...state.items };
  for (const item of input.items) {
    assertProjectionItem(item, input.runId, input.expectedCursor, input.cursor);
    const existing = items[item.id];
    if (existing && existing.digest !== item.digest) {
      throw new Error(`Workroom Projection item conflict: ${item.id}`);
    }
    items[item.id] = item;
  }
  return deepFreeze({
    revision: state.revision + 1,
    bindings: state.bindings,
    cursors: { ...state.cursors, [input.runId]: input.cursor },
    items,
    messageIndex: state.messageIndex,
  });
}

interface AssignmentProjectionScope {
  readonly assignmentId: string;
  readonly taskKey: string;
  readonly taskRevision: number;
  readonly assignmentRevision: number;
  readonly owner: string;
  readonly role: WorkroomExecutionRole;
}

type WorkroomProjectionDraft = Omit<WorkroomProjectionOutboxItem, 'content' | 'disclosure'>
  & Readonly<{ content: string }>;

function projectEvents(
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
    conversation: binding.conversation,
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

function projectionBindingCursorKey(
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

function exactLegacyBindingCursor(
  state: WorkroomProjectionState,
  sourceKey: string,
  binding: WorkroomProjectionBinding,
): number | undefined {
  const cursor = state.cursors[sourceKey];
  if (cursor === undefined) return undefined;
  const legacyItems = Object.values(state.items).filter(item =>
    item.cursorId === undefined && item.runId === sourceKey,
  );
  if (legacyItems.length === 0) return undefined;
  const audience = projectionAudience(binding);
  return legacyItems.every(item =>
    item.projectId === binding.projectId
      && (item.audience ?? 'workroom') === audience
      && item.bindingRevision === binding.bindingRevision
      && item.projectionPolicyRevision === binding.projectionPolicyRevision
      && digest(item.conversation) === digest(binding.conversation),
  ) ? cursor : undefined;
}

export function workroomPortfolioProjectionCursorKey(portfolioId: string, projectId: string): string {
  requireText(portfolioId, 'Portfolio Projection portfolioId');
  requireText(projectId, 'Portfolio Projection projectId');
  return `portfolio-sponsor:${digest({ version: 1, portfolioId, projectId }).slice('sha256:'.length)}`;
}

function portfolioSponsorDraft(
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

function lifecycleOverdueSourceEventId(
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

function lifecycleOverdueDraft(
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

function validateLifecycleOverdueSnapshot(
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

function materializeProjectionItem(
  draft: WorkroomProjectionDraft,
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
    identity.principalId === assignment.owner && identity.role === assignment.role);
  if (matches.length !== 1) {
    throw new Error(`Workroom Projection requires one named Agent identity for ${assignment.assignmentId}`);
  }
  return matches[0]!;
}

function freezeAndValidateBinding(value: WorkroomProjectionBinding): WorkroomProjectionBinding {
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
  if (value.audience === undefined) return 'workroom';
  if (value.audience !== 'workroom' && value.audience !== 'sponsor_room') {
    throw new Error('Workroom Projection audience is invalid');
  }
  return value.audience;
}

function assertProjectionItem(
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
  if (item.version !== 1 || (item.cursorId ?? item.runId) !== runId
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

function requireConversation(value: WorkroomProjectionConversation): void {
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
}

function requireText(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Workroom Projection ${label} requires non-empty text`);
  }
}

function requirePositiveInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new Error(`Workroom Projection ${label} must be a positive integer`);
  }
}

function requireSequence(value: unknown, label: string, minimum: number): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) {
    throw new Error(`Workroom Projection ${label} is invalid`);
  }
}

function requireFiniteNumber(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Workroom Projection ${label} must be finite`);
  }
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Workroom Projection ${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function assertExactRecordKeys(
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

function hasCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error
    && (error as { code?: unknown }).code === code);
}
