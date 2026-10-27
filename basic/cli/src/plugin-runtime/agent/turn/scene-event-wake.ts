/**
 * 状态感知唤醒（#996）：高优先社交事件（禁言、入群申请、成员进出、公告、戳 Bot）自己唤醒入站，
 * 不必等下一条人话。
 *
 * - 按 `platform:sceneId` 开 coalesce 窗（默认 4s，限定 3–5s）：窗内的高优先事件合并成一次唤醒；
 * - 限频：同一场景两次唤醒至少间隔 `minIntervalMs`（默认 15s）；未到时间的批次顺延，不丢；
 * - 低优先事件不进这里（只落 conversation_events，由下一轮 `[Scene events]` 带上）。
 */
import type { ConversationEvent, ConversationRef } from '@zhin.js/im-contract';

export const SCENE_WAKE_DEFAULT_COALESCE_MS = 4_000;
export const SCENE_WAKE_MIN_COALESCE_MS = 3_000;
export const SCENE_WAKE_MAX_COALESCE_MS = 5_000;
export const SCENE_WAKE_DEFAULT_MIN_INTERVAL_MS = 15_000;

export interface SceneWakeItem {
  readonly sequence: number;
  readonly event: ConversationEvent;
  readonly selfIds: readonly string[];
  readonly endpointId?: string;
}

export interface SceneWakeBatch {
  readonly key: string;
  readonly conversation: ConversationRef;
  readonly items: readonly SceneWakeItem[];
  readonly throughSequence: number;
}

export interface SceneEventWakeOptions {
  readonly coalesceMs?: number;
  readonly minIntervalMs?: number;
  readonly now?: () => number;
  readonly setTimer?: (run: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
  readonly onWake: (batch: SceneWakeBatch) => Promise<void> | void;
  /** 批次被限频顺延时调用（只用于日志）。 */
  readonly onDeferred?: (key: string, waitMs: number) => void;
  readonly onError?: (key: string, error: unknown) => void;
}

interface PendingScene {
  conversation: ConversationRef;
  items: SceneWakeItem[];
  timer: unknown;
}

function clampCoalesce(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return SCENE_WAKE_DEFAULT_COALESCE_MS;
  return Math.min(SCENE_WAKE_MAX_COALESCE_MS, Math.max(SCENE_WAKE_MIN_COALESCE_MS, value));
}

export class SceneEventWake {
  readonly #coalesceMs: number;
  readonly #minIntervalMs: number;
  readonly #now: () => number;
  readonly #setTimer: (run: () => void, ms: number) => unknown;
  readonly #clearTimer: (handle: unknown) => void;
  readonly #pending = new Map<string, PendingScene>();
  readonly #lastWake = new Map<string, number>();
  readonly #running = new Set<string>();
  #disposed = false;

  constructor(private readonly options: SceneEventWakeOptions) {
    this.#coalesceMs = clampCoalesce(options.coalesceMs);
    this.#minIntervalMs = typeof options.minIntervalMs === 'number' && options.minIntervalMs >= 0
      ? options.minIntervalMs
      : SCENE_WAKE_DEFAULT_MIN_INTERVAL_MS;
    this.#now = options.now ?? Date.now;
    this.#setTimer = options.setTimer ?? ((run, ms) => {
      const handle = setTimeout(run, ms);
      (handle as { unref?: () => void }).unref?.();
      return handle;
    });
    this.#clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  }

  get coalesceMs(): number { return this.#coalesceMs; }
  get minIntervalMs(): number { return this.#minIntervalMs; }

  /** 收一条高优先事件；返回 `scheduled`（开了新窗）或 `coalesced`（并入已开的窗）。 */
  offer(key: string, conversation: ConversationRef, item: SceneWakeItem): 'scheduled' | 'coalesced' | 'disposed' {
    if (this.#disposed) return 'disposed';
    const pending = this.#pending.get(key);
    if (pending) {
      if (!pending.items.some((existing) => existing.sequence === item.sequence)) pending.items.push(item);
      return 'coalesced';
    }
    const scene: PendingScene = { conversation, items: [item], timer: undefined };
    this.#pending.set(key, scene);
    scene.timer = this.#setTimer(() => { void this.#flush(key); }, this.#coalesceMs);
    return 'scheduled';
  }

  async #flush(key: string): Promise<void> {
    const scene = this.#pending.get(key);
    if (!scene || this.#disposed) return;
    const now = this.#now();
    const last = this.#lastWake.get(key);
    const wait = this.#running.has(key)
      ? this.#coalesceMs
      : last === undefined ? 0 : last + this.#minIntervalMs - now;
    if (wait > 0) {
      // 限频（或上一次唤醒还没结束）：顺延到可以唤醒的时刻，事件继续在窗里累积。
      this.options.onDeferred?.(key, wait);
      scene.timer = this.#setTimer(() => { void this.#flush(key); }, wait);
      return;
    }
    this.#pending.delete(key);
    this.#lastWake.set(key, now);
    this.#running.add(key);
    const items = [...scene.items].sort((left, right) => left.sequence - right.sequence);
    try {
      await this.options.onWake(Object.freeze({
        key,
        conversation: scene.conversation,
        items: Object.freeze(items),
        throughSequence: items[items.length - 1]!.sequence,
      }));
    } catch (error) {
      this.options.onError?.(key, error);
    } finally {
      this.#running.delete(key);
    }
  }

  /** 测试/诊断：当前有待唤醒批次的场景。 */
  pendingKeys(): string[] {
    return [...this.#pending.keys()];
  }

  dispose(): void {
    this.#disposed = true;
    for (const scene of this.#pending.values()) this.#clearTimer(scene.timer);
    this.#pending.clear();
    this.#lastWake.clear();
  }
}
