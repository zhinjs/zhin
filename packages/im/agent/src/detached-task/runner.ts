import { AgentStepStatus, createStepId } from '@zhin.js/ai/agent-step-checkpoint';
import { getLogger, formatCompact } from '@zhin.js/logger';
import { TurnProgressReporter } from '../core/progress-reporter.js';
import { KeyedMutex } from '../utils/keyed-mutex.js';
import type { DetachedTaskStore } from './store.js';
import {
  DEFAULT_DETACHED_TASK_CONFIG,
  DetachedTaskTransitionError,
  TERMINAL_DETACHED_TASK_STATUSES,
  canTransitionDetachedTask,
  type DetachedTaskChannel,
  type DetachedTaskConfig,
  type DetachedTaskPolicy,
  type DetachedTaskRecord,
  type DetachedTaskStatusName,
  type DetachedTaskStep,
} from './types.js';

const logger = getLogger('DetachedTask');

/** Thrown inside a step when a side effect may or may not have happened before a crash. */
export class DetachedTaskOutcomeUnknownError extends Error {
  constructor(readonly taskId: string, readonly idempotencyKey: string) {
    super(`Detached task ${taskId}: outcome of side effect "${idempotencyKey}" is unknown after restart; not re-running it`);
    this.name = 'DetachedTaskOutcomeUnknownError';
  }
}

class DetachedTaskSuspend extends Error {
  constructor(readonly to: 'waiting_approval' | 'paused', readonly reason?: string) {
    super(`suspend:${to}`);
  }
}

export interface DetachedTaskStepOptions {
  /** Marks the call as side-effecting: it runs at most once across restarts. */
  readonly idempotencyKey?: string;
}

export interface DetachedTaskContext {
  readonly taskId: string;
  readonly goal: string;
  /** Frozen at creation. Executors must build tool policy from this, never from a live turn. */
  readonly policy: DetachedTaskPolicy;
  readonly signal: AbortSignal;
  /** Executor state saved with the last checkpoint (undefined on first run). */
  readonly state: unknown;
  /** Steps already checkpointed before this run (non-empty after a resume). */
  readonly completedSteps: readonly DetachedTaskStep[];
  /**
   * Run one tool call and checkpoint it. On resume, a step that was already
   * checkpointed returns its stored result without running again.
   */
  step<T>(tool: string, run: () => Promise<T>, options?: DetachedTaskStepOptions): Promise<T>;
  /** Persist executor state alongside the checkpoints. */
  saveState(state: unknown): Promise<void>;
  /** Throttled progress push (reuses the #718 reporter). */
  progress(interimText?: string): Promise<boolean>;
  /**
   * Steering the user sent since the last step boundary (#732). Call it at a
   * step boundary and fold the texts into the next model request. On resume
   * the same boundary returns the same texts, so replay stays deterministic.
   */
  takeSteering(): Promise<readonly string[]>;
  /** Suspend the task until {@link DetachedTaskRunner.approve} is called. */
  awaitApproval(reason: string): never;
}

export interface DetachedTaskExecutor {
  run(context: DetachedTaskContext): Promise<{ summary: string }>;
}

export interface DetachedTaskRunnerDeps {
  readonly store: DetachedTaskStore;
  readonly executors: Readonly<Record<string, DetachedTaskExecutor>>;
  /** Sends text to a delivery/approval channel. Failures are logged, never fatal. */
  readonly deliver?: (channel: DetachedTaskChannel | undefined, text: string, task: DetachedTaskRecord) => Promise<void>;
  /** Optional cheap plain-language progress summary (see summarizeProgress). */
  readonly summarize?: (task: DetachedTaskRecord) => Promise<string | undefined>;
  readonly config?: DetachedTaskConfig;
  readonly now?: () => number;
  readonly createTaskId?: () => string;
}

export interface CreateDetachedTaskInput {
  readonly kind: string;
  readonly goal: string;
  readonly sessionId?: string;
  readonly createdBy?: string;
  /** Snapshot of the creating turn's policy. Omitted means no shell / no filesystem. */
  readonly policy?: DetachedTaskPolicy;
  readonly delivery?: DetachedTaskChannel;
  readonly approval?: DetachedTaskChannel;
  readonly taskId?: string;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

function defaultTaskId(): string {
  return `tsk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export class DetachedTaskRunner {
  readonly #deps: DetachedTaskRunnerDeps;
  readonly #config: Readonly<Required<DetachedTaskConfig>>;
  readonly #now: () => number;
  /** Serializes every read-modify-write of one task record (steer vs checkpoint vs transition). */
  readonly #writes = new KeyedMutex();
  readonly #active = new Map<string, { controller: AbortController; done: Promise<DetachedTaskRecord> }>();

  constructor(deps: DetachedTaskRunnerDeps) {
    this.#deps = deps;
    this.#config = { ...DEFAULT_DETACHED_TASK_CONFIG, ...deps.config };
    this.#now = deps.now ?? Date.now;
  }

  async create(input: CreateDetachedTaskInput): Promise<DetachedTaskRecord> {
    if (!this.#deps.executors[input.kind]) throw new Error(`Unknown detached task kind: ${input.kind}`);
    const now = this.#now();
    const record: DetachedTaskRecord = {
      version: 1,
      taskId: input.taskId ?? (this.#deps.createTaskId ?? defaultTaskId)(),
      kind: input.kind,
      goal: input.goal,
      sessionId: input.sessionId,
      createdBy: input.createdBy,
      status: 'queued',
      // Copy so later mutation of the creating turn's policy cannot leak in.
      policy: deepFreeze(structuredClone(input.policy ?? {})),
      delivery: input.delivery,
      approval: input.approval,
      steps: [],
      effects: {},
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    };
    await this.#deps.store.save(record);
    return record;
  }

  get(taskId: string): Promise<DetachedTaskRecord | undefined> {
    return this.#deps.store.load(taskId);
  }

  list(): Promise<readonly DetachedTaskRecord[]> {
    return this.#deps.store.list();
  }

  /** Start a queued task in the background; resolves with the final/suspended record. */
  start(taskId: string): Promise<DetachedTaskRecord> {
    const active = this.#active.get(taskId);
    if (active) return active.done;
    const controller = new AbortController();
    const done = this.#run(taskId, controller.signal).finally(() => this.#active.delete(taskId));
    this.#active.set(taskId, { controller, done });
    return done;
  }

  /**
   * After a process restart: re-queue tasks left `running`/`queued` and resume
   * them from their last checkpoint. Tasks over `maxResumeAttempts` fail.
   */
  async recover(): Promise<readonly Promise<DetachedTaskRecord>[]> {
    const runs: Promise<DetachedTaskRecord>[] = [];
    for (const task of await this.#deps.store.list()) {
      if (task.status !== 'running' && task.status !== 'queued') continue;
      if (this.#active.has(task.taskId)) continue;
      let record = task;
      if (record.status === 'running') record = await this.#transition(record, 'queued');
      if (record.attempts >= this.#config.maxResumeAttempts) {
        record = await this.#transition(await this.#transition(record, 'running'), 'failed', {
          error: `已重启恢复 ${record.attempts} 次仍未完成，任务已停止。`,
        });
        await this.#notify(record.delivery, `后台任务失败：${record.error}`, record);
        continue;
      }
      runs.push(this.start(record.taskId));
    }
    return runs;
  }

  /** Resume a task waiting for approval. */
  async approve(taskId: string): Promise<DetachedTaskRecord> {
    const record = await this.#require(taskId);
    if (record.status !== 'waiting_approval') throw new DetachedTaskTransitionError(taskId, record.status, 'running');
    await this.#transition(record, 'queued');
    return this.start(taskId);
  }

  /** Re-queue a paused task and start it. */
  async resume(taskId: string): Promise<DetachedTaskRecord> {
    const record = await this.#require(taskId);
    await this.#transition(record, 'queued');
    return this.start(taskId);
  }

  /** Queue a steering message; it is applied at the task's next step boundary. */
  async steer(taskId: string, text: string): Promise<DetachedTaskRecord> {
    return this.#writes.run(taskId, async () => {
      const record = await this.#require(taskId);
      if (TERMINAL_DETACHED_TASK_STATUSES.has(record.status)) {
        throw new DetachedTaskTransitionError(taskId, record.status, record.status);
      }
      const next: DetachedTaskRecord = {
        ...record,
        pendingSteering: [...(record.pendingSteering ?? []), text],
        updatedAt: this.#now(),
      };
      await this.#deps.store.save(next);
      return next;
    });
  }

  async cancel(taskId: string): Promise<DetachedTaskRecord> {
    const active = this.#active.get(taskId);
    if (active) {
      active.controller.abort(new Error('cancelled'));
      // Don't hang on an executor that ignores the signal; step() refuses new steps after abort.
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        active.done.catch(() => undefined),
        new Promise<void>((resolve) => { timer = setTimeout(resolve, this.#config.cancelGraceMs); }),
      ]);
      clearTimeout(timer);
    }
    const record = await this.#require(taskId);
    if (record.status === 'cancelled') return record;
    return this.#transition(record, 'cancelled');
  }

  async #run(taskId: string, signal: AbortSignal): Promise<DetachedTaskRecord> {
    let record = await this.#require(taskId);
    const executor = this.#deps.executors[record.kind];
    if (!executor) throw new Error(`Unknown detached task kind: ${record.kind}`);
    record = await this.#transition(record, 'running', { attempts: record.attempts + 1 });
    const resumedSteps = record.steps;
    let cursor = 0;
    const reporter = new TurnProgressReporter({
      sink: (text) => this.#notify(record.delivery, text, record, true),
      minIntervalMs: this.#config.progressIntervalMs,
      maxUpdates: this.#config.maxProgressUpdates,
      summarize: async () => this.#deps.summarize?.(record),
      now: this.#now,
    });
    const save = (patch: Partial<DetachedTaskRecord>) => this.#writes.run(taskId, async () => {
      // steer() writes pendingSteering concurrently; under the lock, re-read it so it is never clobbered.
      const pendingSteering = 'pendingSteering' in patch
        ? patch.pendingSteering
        : (await this.#deps.store.load(taskId))?.pendingSteering ?? record.pendingSteering;
      record = { ...record, ...patch, pendingSteering, updatedAt: this.#now() };
      await this.#deps.store.save(record);
    });
    const steeringReturnedAt = new Set<number>();
    const context: DetachedTaskContext = {
      taskId,
      goal: record.goal,
      policy: deepFreeze(structuredClone(record.policy)),
      signal,
      state: record.state,
      completedSteps: resumedSteps,
      step: async <T>(tool: string, run: () => Promise<T>, options: DetachedTaskStepOptions = {}): Promise<T> => {
        signal.throwIfAborted();
        const index = cursor++;
        const replay = record.steps[index];
        if (replay) {
          if (replay.tool !== tool) {
            throw new Error(`Detached task ${taskId}: step ${index} replay mismatch (${replay.tool} != ${tool})`);
          }
          return replay.result as T;
        }
        if (index >= this.#config.maxSteps) throw new Error(`已超过最大步数 ${this.#config.maxSteps}`);
        const key = options.idempotencyKey;
        const startedAt = this.#now();
        if (key) {
          const effect = record.effects[key];
          if (effect?.status === 'committed') return this.#checkpoint(record, save, index, tool, effect.result as T, startedAt, key);
          if (effect) {
            await save({ effects: { ...record.effects, [key]: { ...effect, status: 'outcome_unknown' } } });
            throw new DetachedTaskOutcomeUnknownError(taskId, key);
          }
          await save({ effects: { ...record.effects, [key]: { key, tool, status: 'executing', startedAt } } });
        }
        const result = await run();
        if (key) {
          await save({
            effects: { ...record.effects, [key]: { key, tool, status: 'committed', result, startedAt, finishedAt: this.#now() } },
          });
        }
        return this.#checkpoint(record, save, index, tool, result, startedAt, key);
      },
      saveState: (state) => save({ state }),
      takeSteering: async () => {
        const atStep = cursor;
        // Logged steering for a boundary is handed out once per run: replayed after a restart,
        // never duplicated when the executor asks twice at the same live boundary.
        const logged = steeringReturnedAt.has(atStep)
          ? []
          : (record.steeringLog ?? []).filter((s) => s.atStep === atStep);
        steeringReturnedAt.add(atStep);
        // Replay: this boundary was already reached before a restart.
        if (atStep < record.steps.length) return logged.map((s) => s.text);
        // Read-and-clear atomically so a concurrent steer() is either taken now or kept for later.
        const pending = await this.#writes.run(taskId, async () => {
          const taken = (await this.#deps.store.load(taskId))?.pendingSteering ?? [];
          if (taken.length === 0) return taken;
          const at = this.#now();
          record = {
            ...record,
            pendingSteering: [],
            steeringLog: [...(record.steeringLog ?? []), ...taken.map((text) => ({ atStep, text, at }))],
            updatedAt: at,
          };
          await this.#deps.store.save(record);
          return taken;
        });
        return [...logged.map((s) => s.text), ...pending];
      },
      progress: (interimText) => reporter.report('progress', { steps: record.steps.length, interimText }),
      awaitApproval: (reason) => {
        throw new DetachedTaskSuspend('waiting_approval', reason);
      },
    };

    try {
      const { summary } = await executor.run(context);
      record = await this.#transition(record, 'done', { summary });
      await this.#notify(record.delivery, `✅ 后台任务完成：${summary}`, record);
    } catch (error) {
      if (error instanceof DetachedTaskSuspend) {
        record = await this.#transition(record, error.to, {});
        if (error.to === 'waiting_approval') {
          await this.#notify(record.approval ?? record.delivery, `后台任务需要确认：${error.reason ?? ''}`.trim(), record);
        }
      } else if (signal.aborted) {
        // cancel() performs the transition.
      } else {
        const message = error instanceof Error ? error.message : String(error);
        const target: DetachedTaskStatusName = error instanceof DetachedTaskOutcomeUnknownError ? 'waiting_approval' : 'failed';
        record = await this.#transition(record, target, { error: message });
        const text = target === 'waiting_approval'
          ? '后台任务在重启前可能已执行过一个有副作用的操作，结果无法确认；为避免重复执行，任务已暂停，请确认后再继续。'
          : `后台任务失败：${message}`;
        await this.#notify(target === 'waiting_approval' ? record.approval ?? record.delivery : record.delivery, text, record);
      }
    }
    logger.info(formatCompact({ op: 'detached_task', task: taskId, status: record.status, steps: record.steps.length }));
    return record;
  }

  async #checkpoint<T>(
    record: DetachedTaskRecord,
    save: (patch: Partial<DetachedTaskRecord>) => Promise<void>,
    index: number,
    tool: string,
    result: T,
    startedAt: number,
    idempotencyKey?: string,
  ): Promise<T> {
    const step: DetachedTaskStep = {
      index,
      tool,
      result,
      idempotencyKey,
      stepId: createStepId(),
      turnId: record.taskId,
      status: AgentStepStatus.COMPLETED,
      startedAt,
      completedAt: this.#now(),
    };
    await save({ steps: [...record.steps, step] });
    return result;
  }

  async #require(taskId: string): Promise<DetachedTaskRecord> {
    const record = await this.#deps.store.load(taskId);
    if (!record) throw new Error(`Unknown detached task: ${taskId}`);
    return record;
  }

  async #transition(
    record: DetachedTaskRecord,
    to: DetachedTaskStatusName,
    patch: Partial<DetachedTaskRecord> = {},
  ): Promise<DetachedTaskRecord> {
    const allowed = canTransitionDetachedTask(record.status, to);
    if (!allowed || TERMINAL_DETACHED_TASK_STATUSES.has(record.status)) {
      throw new DetachedTaskTransitionError(record.taskId, record.status, to);
    }
    return this.#writes.run(record.taskId, async () => {
      const latest = (await this.#deps.store.load(record.taskId)) ?? record;
      const next: DetachedTaskRecord = { ...latest, ...patch, status: to, updatedAt: this.#now() };
      await this.#deps.store.save(next);
      return next;
    });
  }

  async #notify(channel: DetachedTaskChannel | undefined, text: string, task: DetachedTaskRecord, rethrow = false): Promise<void> {
    if (!this.#deps.deliver) return;
    try {
      await this.#deps.deliver(channel, text, task);
    } catch (error) {
      logger.warn(formatCompact({ op: 'detached_task_deliver_failed', task: task.taskId, error: String(error) }));
      if (rethrow) throw error;
    }
  }
}
