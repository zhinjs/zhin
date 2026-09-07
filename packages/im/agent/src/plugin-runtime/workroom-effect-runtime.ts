import { randomUUID } from 'node:crypto';
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
  readonly #abort = new AbortController();
  readonly #active = new Set<Promise<readonly WorkroomEffectState[]>>();

  constructor(readonly options: WorkroomEffectRuntimeOptions) {
    if (!options.workerId.trim()) throw new Error('Effect Runtime workerId is required');
    if (!Number.isSafeInteger(options.fence) || options.fence < 1) {
      throw new Error('Effect Runtime fence is invalid');
    }
    this.#ledger = new WorkroomEffectLedger(options.journal, {
      authorize: input => interruptible(options.authorization.authorize(input), this.#abort.signal),
    });
    this.#now = options.now ?? Date.now;
    this.#intervalMs = positive(options.intervalMs ?? 1_000, 'intervalMs');
    if (Boolean(options.blockers) !== Boolean(options.blockerPolicy)) {
      throw new Error('Effect Runtime durable blocker control requires trusted blocker policy');
    }
    if (options.signal?.aborted) {
      this.#stopped = true;
      this.#abort.abort(options.signal.reason);
    } else {
      options.signal?.addEventListener('abort', () => { void this.dispose(); }, { once: true });
    }
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
    const combined = AbortSignal.any([signal, this.#abort.signal]);
    const running = interruptible(this.#drain(combined), combined);
    this.#running = running;
    try {
      return await running;
    } finally {
      if (this.#running === running) this.#running = undefined;
    }
  }

  async dispose(): Promise<void> {
    this.#stopped = true;
    this.#abort.abort(new Error('Effect Runtime is stopped'));
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = undefined;
    await Promise.allSettled([...this.#active, ...(this.#running ? [this.#running] : [])]);
  }

  async runOnce(projectId: string, signal: AbortSignal): Promise<readonly WorkroomEffectState[]> {
    if (this.#stopped) throw new Error('Effect Runtime is stopped');
    const combined = AbortSignal.any([signal, this.#abort.signal, ...(this.options.signal ? [this.options.signal] : [])]);
    combined.throwIfAborted();
    const running = interruptible(this.#runOnce(projectId, combined), combined);
    this.#active.add(running);
    try { return await running; } finally { this.#active.delete(running); }
  }

  async #runOnce(projectId: string, signal: AbortSignal): Promise<readonly WorkroomEffectState[]> {
    signal.throwIfAborted();
    const initial = replayWorkroomEffectLedger(projectId, await this.options.journal.read(projectId));
    const results: WorkroomEffectState[] = [];
    for (const effectId of Object.keys(initial).sort()) {
      signal.throwIfAborted();
      const state = await this.#ledger.read(projectId, effectId);
      if (state.status === 'pending_authorization') {
        let dispatchState = state;
        try {
          if (this.options.gateway.prepare) {
            await interruptible(this.options.gateway.prepare(state, signal), signal);
          }
          signal.throwIfAborted();
          const startedAt = this.options.clock
            ? await interruptible(this.options.clock.read(state), signal)
            : this.#now();
          const started = await this.#ledger.startAuthorizedAttempt(projectId, effectId, {
            operationId: `effect-operation:${effectId}:${this.options.fence}:${randomUUID()}`,
            workerId: this.options.workerId,
            fence: this.options.fence,
            startedAt,
          });
          dispatchState = started;
          signal.throwIfAborted();
          const settled = await this.#dispatch(started, signal);
          await this.#settleBlocker(settled);
          results.push(settled);
        } catch (error) {
          signal.throwIfAborted();
          if (error instanceof WorkroomEffectSequenceConflictError) continue;
          if (!dispatchState.attempt
            && (await this.#ledger.read(projectId, effectId)).status !== 'pending_authorization') continue;
          await this.#block(dispatchState, dispatchState.attempt ? 'reconcile' : 'prepare_or_authorize', error);
        }
      } else if (state.status === 'executing' || state.status === 'outcome_unknown') {
        try {
          const settled = await this.#reconcile(state, signal);
          await this.#settleBlocker(settled);
          results.push(settled);
        } catch (error) {
          signal.throwIfAborted();
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
        await interruptible(this.options.gateway.execute(state, signal), signal),
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
        await interruptible(this.options.gateway.reconcile(state, signal), signal),
      );
    } catch (error) {
      if (!(error instanceof WorkroomEffectOutcomeUnknownError)) throw error;
      return await this.#ledger.recordReceipt(state.projectId, state.intent.id, error.receipt);
    }
  }

  async #settleBlocker(state: WorkroomEffectState): Promise<void> {
    if (!this.options.blockers) return;
    if (state.status === 'outcome_unknown') {
      await this.#block(state, 'reconcile', new Error('Workroom Effect outcome is unknown and requires reconciliation'));
    } else {
      await this.options.blockers.recover(state.projectId, state.intent.id);
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
      // An existing durable attempt may already have changed the provider.
      // Neither redispatch nor cancel-as-unexecuted is a safe successor.
      allowedSuccessors: phase === 'reconcile'
        ? Object.freeze(['reconcile'] as const)
        : policy.allowedSuccessors,
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

/** Stop waiting on uncooperative transports; the durable attempt must be reconciled. */
function interruptible<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
    pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
