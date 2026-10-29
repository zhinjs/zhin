/**
 * ADR 0041 §6: stale-while-revalidate for the L2 scene-fact cache. A stale (over 24 h) L2 row is served
 * immediately and refreshed from the platform once, in the background — de-duplicated per key, with
 * bounded concurrency and queue, and cancelled when the generation that owns it is disposed.
 */
import { formatCompact, getLogger } from '@zhin.js/logger';

const logger = getLogger('agent');

export const SCENE_FACT_REFRESH_CONCURRENCY = 2;
export const SCENE_FACT_REFRESH_MAX_QUEUED = 32;
export const SCENE_FACT_REFRESH_TIMEOUT_MS = 10_000;

export interface SceneFactRefresherOptions {
  readonly concurrency?: number;
  readonly maxQueued?: number;
  readonly timeoutMs?: number;
}

export class SceneFactRefresher {
  readonly #keys = new Set<string>();
  readonly #queue: Array<{ key: string; run: (signal: AbortSignal) => Promise<void> }> = [];
  readonly #running = new Set<Promise<void>>();
  readonly #controller = new AbortController();
  readonly #concurrency: number;
  readonly #maxQueued: number;
  readonly #timeoutMs: number;

  constructor(options: SceneFactRefresherOptions = {}) {
    this.#concurrency = options.concurrency ?? SCENE_FACT_REFRESH_CONCURRENCY;
    this.#maxQueued = options.maxQueued ?? SCENE_FACT_REFRESH_MAX_QUEUED;
    this.#timeoutMs = options.timeoutMs ?? SCENE_FACT_REFRESH_TIMEOUT_MS;
  }

  /** @returns false when the key is already refreshing, the queue is full or the generation is disposed. */
  schedule(key: string, run: (signal: AbortSignal) => Promise<void>): boolean {
    if (this.#controller.signal.aborted || this.#keys.has(key) || this.#queue.length >= this.#maxQueued) return false;
    this.#keys.add(key);
    this.#queue.push({ key, run });
    this.#pump();
    return true;
  }

  #pump(): void {
    while (this.#running.size < this.#concurrency && this.#queue.length > 0 && !this.#controller.signal.aborted) {
      const job = this.#queue.shift()!;
      const signal = AbortSignal.any([this.#controller.signal, AbortSignal.timeout(this.#timeoutMs)]);
      const task: Promise<void> = Promise.resolve().then(() => job.run(signal)).then(() => undefined, (error: unknown) => {
        if (signal.aborted) return;
        logger.debug(formatCompact({
          op: 'agent_scene_fact_refresh_failed', kind: job.key.split('\u0000')[0],
          error: error instanceof Error ? error.message : String(error),
        }));
      }).finally(() => {
        this.#running.delete(task);
        this.#keys.delete(job.key);
        this.#pump();
      });
      this.#running.add(task);
    }
  }

  /** Resolves once every scheduled refresh settled (tests / shutdown). */
  async idle(): Promise<void> {
    while (this.#running.size > 0) await Promise.all([...this.#running]);
  }

  get pending(): number { return this.#keys.size; }

  dispose(): void {
    this.#controller.abort(new Error('scene fact refresher disposed'));
    this.#queue.length = 0;
    this.#keys.clear();
  }
}
