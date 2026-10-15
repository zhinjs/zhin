import type { WorkroomJournal } from '../journal/index.js';
import {
  compareCanonicalWorkroomText,
  deepFreezeWorkroomValue as deepFreeze,
  digestCanonicalWorkroomValue as digest,
} from '../canonical-value.js';
import type { PortfolioSponsorProjection } from '../../portfolio/sponsor-projection.js';
import type {
  WorkroomLifecycleHoldOverdueSnapshot,
  WorkroomProjectionBinding,
  WorkroomProjectionGovernancePort,
  WorkroomProjectionRepository,
  WorkroomProjectionState,
} from './contracts.js';
import { WorkroomProjectionRevisionConflictError } from './contracts.js';
import {
  freezeAndValidateBinding,
  lifecycleOverdueDraft,
  lifecycleOverdueSourceEventId,
  materializeProjectionItem,
  portfolioSponsorDraft,
  projectEvents,
  projectionAudience,
  projectionBindingCursorKey,
  validateLifecycleOverdueSnapshot,
  workroomLifecycleProjectionCursorKey,
  workroomPortfolioProjectionCursorKey,
} from './projector.js';

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
      const cursor = current.cursors[cursorId] ?? -1;
      const sourceSequence = events.at(-1)?.sequence ?? -1;
      if (cursor > sourceSequence) {
        throw new Error('Workroom Projection cursor exceeds the authoritative Journal');
      }
      if (cursor >= sourceSequence) return current;
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
          expectedCursor: cursor,
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
      const cursor = current.cursors[cursorId] ?? -1;
      if (cursor > projectionValue.sourceSequence) {
        throw new Error('Portfolio Sponsor cursor exceeds the authoritative projection');
      }
      if (cursor >= projectionValue.sourceSequence) return current;
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
          expectedCursor: cursor,
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
