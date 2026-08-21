import {
  WorkroomEffectLedger,
  WorkroomEffectSequenceConflictError,
  replayWorkroomEffectLedger,
  type WorkroomEffectAuthorizationPort,
  type WorkroomEffectGatewayReceipt,
  type WorkroomEffectJournal,
  type WorkroomEffectState,
} from '../workroom/effect-ledger.js';

export interface WorkroomEffectGatewayPort {
  /** Side-effect-free authority/readiness probe performed before an attempt exists. */
  prepare?(state: WorkroomEffectState, signal: AbortSignal): Promise<void>;
  /** Dispatch exactly once with the already-durable attempt/idempotency key. */
  execute(state: WorkroomEffectState, signal: AbortSignal): Promise<WorkroomEffectGatewayReceipt>;
  /** Observe the same attempt without issuing a second side effect. */
  reconcile(state: WorkroomEffectState, signal: AbortSignal): Promise<WorkroomEffectGatewayReceipt>;
}

export class WorkroomEffectOutcomeUnknownError extends Error {
  constructor(readonly receipt: WorkroomEffectGatewayReceipt) {
    super('Workroom Effect outcome is unknown and requires reconciliation');
    this.name = 'WorkroomEffectOutcomeUnknownError';
    if (receipt.outcome !== 'outcome_unknown') {
      throw new Error('OutcomeUnknown error requires an outcome_unknown receipt');
    }
  }
}

export interface WorkroomEffectRuntimeOptions {
  readonly journal: WorkroomEffectJournal;
  readonly authorization: WorkroomEffectAuthorizationPort;
  readonly gateway: WorkroomEffectGatewayPort;
  readonly workerId: string;
  readonly fence: number;
  readonly now?: () => number;
  readonly clock?: WorkroomEffectClockPort;
  readonly projects?: Readonly<{ listProjectIds(): Promise<readonly string[]> }>;
  readonly blockers?: WorkroomEffectBlockerControlPort;
  readonly blockerPolicy?: WorkroomEffectBlockerPolicyPort;
  readonly intervalMs?: number;
  readonly signal?: AbortSignal;
  readonly onError?: (error: unknown) => void;
}

export interface WorkroomEffectBlockerInput {
  readonly projectId: string;
  readonly effectId: string;
  readonly owner: string;
  readonly policy: Readonly<{
    kind: 'pinned_profile' | 'root_emergency_fallback';
    ref: string;
    digest: string;
  }>;
  readonly reason: string;
  readonly deadline: number;
  readonly allowedSuccessors: readonly ('retry' | 'reconcile' | 'cancel')[];
}

export interface WorkroomEffectBlockerControlPort {
  block(input: WorkroomEffectBlockerInput): Promise<void>;
  recover(projectId: string, effectId: string): Promise<void>;
}

export interface WorkroomEffectBlockerPolicyPort {
  resolve(input: Readonly<{
    state: WorkroomEffectState;
    phase: 'prepare_or_authorize' | 'reconcile';
    reason: string;
  }>): Promise<Pick<WorkroomEffectBlockerInput, 'owner' | 'policy' | 'deadline' | 'allowedSuccessors'>>;
}

export interface WorkroomEffectClockPort {
  read(state: WorkroomEffectState): Promise<number>;
}

/**
 * Restart-safe outbox worker. The Effect Journal is the outbox: an attempt is
 * durable before dispatch. A recovered attempt is reconciled, never executed
 * again blindly.
 */
export class WorkroomEffectRuntime {
  readonly #ledger: WorkroomEffectLedger;
  readonly #now: () => number;
  readonly #intervalMs: number;
  #timer?: ReturnType<typeof setTimeout>;
  #running?: Promise<readonly WorkroomEffectState[]>;
  #stopped = false;

  constructor(readonly options: WorkroomEffectRuntimeOptions) {
    if (!options.workerId.trim()) throw new Error('Effect Runtime workerId is required');
    if (!Number.isSafeInteger(options.fence) || options.fence < 1) {
      throw new Error('Effect Runtime fence is invalid');
    }
    this.#ledger = new WorkroomEffectLedger(options.journal, options.authorization);
    this.#now = options.now ?? Date.now;
    this.#intervalMs = positive(options.intervalMs ?? 1_000, 'intervalMs');
    if (Boolean(options.blockers) !== Boolean(options.blockerPolicy)) {
      throw new Error('Effect Runtime durable blocker control requires trusted blocker policy');
    }
    options.signal?.addEventListener('abort', () => { void this.dispose(); }, { once: true });
  }

  start(): void {
    if (this.#stopped) throw new Error('Effect Runtime is stopped');
    if (this.#timer) return;
    this.#schedule(0);
  }

  async drain(signal = this.options.signal ?? new AbortController().signal): Promise<readonly WorkroomEffectState[]> {
    if (this.#stopped) throw new Error('Effect Runtime is stopped');
    if (!this.options.projects) throw new Error('Effect Runtime Project source is unavailable');
    if (this.#running) return await this.#running;
    const running = this.#drain(signal);
    this.#running = running;
    try {
      return await running;
    } finally {
      if (this.#running === running) this.#running = undefined;
    }
  }

  async dispose(): Promise<void> {
    this.#stopped = true;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = undefined;
    await this.#running;
  }

  async runOnce(projectId: string, signal: AbortSignal): Promise<readonly WorkroomEffectState[]> {
    signal.throwIfAborted();
    const initial = replayWorkroomEffectLedger(projectId, await this.options.journal.read(projectId));
    const results: WorkroomEffectState[] = [];
    for (const effectId of Object.keys(initial).sort()) {
      signal.throwIfAborted();
      const state = await this.#ledger.read(projectId, effectId);
      if (state.status === 'pending_authorization') {
        try {
          await this.options.gateway.prepare?.(state, signal);
          const startedAt = this.options.clock
            ? await this.options.clock.read(state)
            : this.#now();
          const started = await this.#ledger.startAuthorizedAttempt(projectId, effectId, {
            operationId: `effect-operation:${effectId}:${this.options.fence}`,
            workerId: this.options.workerId,
            fence: this.options.fence,
            startedAt,
          });
          const settled = await this.#dispatch(started, signal);
          await this.options.blockers?.recover(projectId, effectId);
          results.push(settled);
        } catch (error) {
          if (error instanceof WorkroomEffectSequenceConflictError) continue;
          await this.#block(state, 'prepare_or_authorize', error);
        }
      } else if (state.status === 'executing' || state.status === 'outcome_unknown') {
        try {
          const settled = await this.#reconcile(state, signal);
          await this.options.blockers?.recover(projectId, effectId);
          results.push(settled);
        } catch (error) {
          if (error instanceof WorkroomEffectSequenceConflictError) continue;
          await this.#block(state, 'reconcile', error);
        }
      }
    }
    return Object.freeze(results);
  }

  async #dispatch(state: WorkroomEffectState, signal: AbortSignal): Promise<WorkroomEffectState> {
    try {
      return await this.#ledger.recordReceipt(
        state.projectId,
        state.intent.id,
        await this.options.gateway.execute(state, signal),
      );
    } catch (error) {
      if (!(error instanceof WorkroomEffectOutcomeUnknownError)) throw error;
      return await this.#ledger.recordReceipt(state.projectId, state.intent.id, error.receipt);
    }
  }

  async #reconcile(state: WorkroomEffectState, signal: AbortSignal): Promise<WorkroomEffectState> {
    try {
      return await this.#ledger.recordReceipt(
        state.projectId,
        state.intent.id,
        await this.options.gateway.reconcile(state, signal),
      );
    } catch (error) {
      if (!(error instanceof WorkroomEffectOutcomeUnknownError)) throw error;
      if (state.status === 'outcome_unknown'
        && state.receipt?.receiptId === error.receipt.receiptId) return state;
      return await this.#ledger.recordReceipt(state.projectId, state.intent.id, error.receipt);
    }
  }

  async #drain(signal: AbortSignal): Promise<readonly WorkroomEffectState[]> {
    const results: WorkroomEffectState[] = [];
    for (const projectId of [...await this.options.projects!.listProjectIds()].sort()) {
      results.push(...await this.runOnce(projectId, signal));
    }
    return Object.freeze(results);
  }

  async #block(
    state: WorkroomEffectState,
    phase: 'prepare_or_authorize' | 'reconcile',
    error: unknown,
  ): Promise<void> {
    if (!this.options.blockers) throw error;
    const reason = error instanceof Error ? error.message : String(error);
    const policy = await this.options.blockerPolicy!.resolve({ state, phase, reason });
    await this.options.blockers.block(Object.freeze({
      projectId: state.projectId,
      effectId: state.intent.id,
      owner: policy.owner,
      policy: policy.policy,
      reason,
      deadline: policy.deadline,
      allowedSuccessors: policy.allowedSuccessors,
    }));
  }

  #schedule(delay: number): void {
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      if (this.#stopped) return;
      void this.drain()
        .catch(error => this.options.onError?.(error))
        .finally(() => { if (!this.#stopped) this.#schedule(this.#intervalMs); });
    }, delay);
    this.#timer.unref?.();
  }
}

function positive(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error(`${label} is invalid`);
  return Number(value);
}
