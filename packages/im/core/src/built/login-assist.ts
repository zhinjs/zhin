/**
 * LoginAssist — 登录辅助生产者-消费者
 *
 * 适配器在需要人为辅助登录时（扫码、短信、滑块等）作为生产者投递待办；
 * Web 控制台、命令行等作为消费者拉取待办并提交结果。
 * 待办未消费前会一直保留，刷新页面后仍可继续消费。
 *
 * 事件：
 *   endpoint.login.pending — 有新待办时触发，payload: PendingLoginTask
 *   endpoint.login.expired — 超时自动取消时触发，payload: PendingLoginTask
 */

// ============================================================================
// 类型
// ============================================================================

export type LoginAssistType = 'qrcode' | 'sms' | 'slider' | 'device' | 'auth' | 'other';

/** 默认 5 分钟；扫码/滑块长期挂起会泄漏 Promise 与 Map 条目 */
export const DEFAULT_LOGIN_ASSIST_TIMEOUT_MS = 5 * 60 * 1000;

export interface PendingLoginTaskPayload {
  /** 说明文案（如「请扫码登录」） */
  message?: string;
  /** 二维码图片 URL 或 base64（type=qrcode 时） */
  image?: string;
  /** 滑块验证 URL（type=slider 时） */
  url?: string;
  /** 其它扩展字段 */
  [key: string]: unknown;
}

export interface PendingLoginTask {
  id: string;
  adapter: string;
  endpointKey: string;
  type: LoginAssistType;
  payload: PendingLoginTaskPayload;
  createdAt: number;
  /** 到期时间戳（ms）；无超时则为 undefined */
  expiresAt?: number;
}

export interface WaitForInputOptions {
  /** Endpoint-instance owner. Only this owner may cancel the task during rollback/retirement. */
  owner: object;
  /**
   * 超时毫秒。默认 {@link DEFAULT_LOGIN_ASSIST_TIMEOUT_MS}。
   * 传 `0` / `Infinity` / 负数表示不超时（仅测试或显式长驻场景）。
   */
  timeoutMs?: number;
}

export type LoginAssistEventName =
  | 'endpoint.login.pending'
  | 'endpoint.login.resolved'
  | 'endpoint.login.expired';

/** Minimal bus — Plugin Runtime / classic Plugin / test EventEmitter all qualify. */
export interface LoginAssistBus {
  emit(name: LoginAssistEventName, task: PendingLoginTask): void;
}

interface PendingEntry {
  task: PendingLoginTask;
  owner: object;
  resolve: (value: string | Record<string, unknown>) => void;
  reject: (err: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
}

// ============================================================================
// LoginAssist 服务
// ============================================================================

export class LoginAssist {
  private readonly bus: LoginAssistBus | null;
  private readonly pending = new Map<string, PendingEntry>();
  private readonly local = new Map<LoginAssistEventName, Set<(task: PendingLoginTask) => void>>();
  private idSeq = 0;
  /** 构造时默认超时；可被 waitForInput options 覆盖 */
  private readonly defaultTimeoutMs: number;

  constructor(bus?: LoginAssistBus | null, options?: { defaultTimeoutMs?: number }) {
    this.bus = bus ?? null;
    this.defaultTimeoutMs = options?.defaultTimeoutMs ?? DEFAULT_LOGIN_ASSIST_TIMEOUT_MS;
  }

  /**
   * Subscribe without requiring a Plugin EventEmitter.
   * Returns unsubscribe.
   */
  subscribe(
    name: LoginAssistEventName,
    listener: (task: PendingLoginTask) => void,
  ): () => void {
    let set = this.local.get(name);
    if (!set) {
      set = new Set();
      this.local.set(name, set);
    }
    set.add(listener);
    return () => {
      set!.delete(listener);
    };
  }

  /**
   * 生产者：等待用户输入后 resolve。会发出 endpoint.login.pending 事件，未消费前可被 listPending 拉取（刷新后可继续消费）。
   * 超时后 reject 并 emit `endpoint.login.expired`。
   */
  waitForInput(
    adapter: string,
    endpointKey: string,
    type: LoginAssistType,
    payload: PendingLoginTaskPayload,
    options: WaitForInputOptions,
  ): Promise<string | Record<string, unknown>> {
    const id = `login-${Date.now()}-${++this.idSeq}`;
    const timeoutMs = resolveTimeoutMs(options?.timeoutMs, this.defaultTimeoutMs);
    const createdAt = Date.now();
    const task: PendingLoginTask = {
      id,
      adapter,
      endpointKey,
      type,
      payload: { message: payload.message ?? '', ...payload },
      createdAt,
      ...(timeoutMs != null ? { expiresAt: createdAt + timeoutMs } : {}),
    };
    const promise = new Promise<string | Record<string, unknown>>((resolve, reject) => {
      const entry: PendingEntry = { task, owner: options.owner, resolve, reject };
      if (timeoutMs != null) {
        entry.timer = setTimeout(() => {
          if (!this.pending.has(id)) return;
          this.pending.delete(id);
          try {
            this.#notify('endpoint.login.expired', task);
          } catch {
            /* observer failure must not leave the producer hanging forever */
          }
          reject(new Error(`LoginAssist task timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        // Node: 不阻止进程退出
        entry.timer.unref?.();
      }
      this.pending.set(id, entry);
      this.#notify('endpoint.login.pending', task);
    });
    return promise;
  }

  /**
   * 消费者：提交结果，对应 waitForInput 的 Promise 会 resolve。
   */
  submit(id: string, value: string | Record<string, unknown>): boolean {
    const entry = this.pending.get(id);
    if (!entry) return false;
    this.pending.delete(id);
    if (entry.timer) clearTimeout(entry.timer);
    entry.resolve(value);
    this.#notify('endpoint.login.resolved', entry.task);
    return true;
  }

  /**
   * 消费者：取消某条待办，对应 Promise 会 reject。
   */
  cancel(id: string, reason = 'cancelled'): boolean {
    const entry = this.pending.get(id);
    if (!entry) return false;
    this.pending.delete(id);
    if (entry.timer) clearTimeout(entry.timer);
    entry.reject(new Error(reason));
    this.#notify('endpoint.login.resolved', entry.task);
    return true;
  }

  /**
   * Cancel pending tasks created by one exact Endpoint instance.
   */
  cancelOwned(owner: object, reason = 'superseded'): number {
    let count = 0;
    for (const [id, entry] of [...this.pending]) {
      if (entry.owner !== owner) continue;
      this.pending.delete(id);
      if (entry.timer) clearTimeout(entry.timer);
      entry.reject(new Error(reason));
      this.#notify('endpoint.login.resolved', entry.task);
      count += 1;
    }
    return count;
  }

  /**
   * 列出未消费的待办（供 Web/CLI 展示，刷新后仍可拉取同一列表）。
   */
  listPending(): PendingLoginTask[] {
    return [...this.pending.values()].map((e) => e.task);
  }

  hasPending(adapter?: string, endpointKey?: string): boolean {
    if (adapter == null) return this.pending.size > 0;
    for (const entry of this.pending.values()) {
      if (entry.task.adapter !== adapter) continue;
      if (endpointKey != null && entry.task.endpointKey !== endpointKey) continue;
      return true;
    }
    return false;
  }

  dispose(): void {
    for (const [, entry] of this.pending) {
      if (entry.timer) clearTimeout(entry.timer);
      entry.reject(new Error('LoginAssist disposed'));
    }
    this.pending.clear();
    this.local.clear();
  }

  #notify(name: LoginAssistEventName, task: PendingLoginTask): void {
    try {
      this.bus?.emit(name, task);
    } catch {
      /* bus observers must not break producer */
    }
    for (const listener of this.local.get(name) ?? []) {
      try {
        listener(task);
      } catch {
        /* same */
      }
    }
  }
}

function resolveTimeoutMs(
  explicit: number | undefined,
  fallback: number,
): number | undefined {
  const raw = explicit === undefined ? fallback : explicit;
  if (!Number.isFinite(raw) || raw <= 0) return undefined;
  return raw;
}

// ============================================================================
// 扩展 Plugin 接口
// ============================================================================

declare module '../plugin.js' {
  namespace Plugin {
    interface Contexts {
      loginAssist: LoginAssist;
    }
  }
}
