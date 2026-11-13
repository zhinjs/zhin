import { randomUUID } from 'node:crypto';
import type { LoginChallengeKind } from '@zhin.js/adapter';

/**
 * LoginAssist — 登录辅助（ADR 0058 Login Assist v2）
 *
 * 适配器在需要人为辅助登录时（扫码、短信、滑块等）开启一个 **登录流程（LoginFlow）**：
 * 每个 Endpoint 同时只有一个流程，流程内同时只有一个待答的 **挑战（LoginChallenge）**。
 * Web 控制台、命令行等消费者拉取挑战并提交；提交后流程自动进入「验证中」，
 * 适配器再通过 `outcome()` / `online()` / `fail()` 报告真实结果。
 *
 * 旧 API `waitForInput()` 继续可用：它在隐式流程中开出一个挑战（旧 payload 映射为描述符）。
 *
 * 事件：
 *   endpoint.login.flow     — 流程快照（按 id 去重，revision 大者为准）
 *   endpoint.login.pending  — 有新待办时触发，payload: PendingLoginTask（兼容）
 *   endpoint.login.expired  — 超时自动取消时触发，payload: PendingLoginTask（兼容）
 *   endpoint.login.resolved — 待办结束（提交或取消）时触发，payload: PendingLoginTask（兼容）
 *
 * 安全：快照、日志与事件从不包含提交的值（验证码、ticket）；二维码图片只挂在当前活动挑战上，
 * 挑战结束或过期即删除；时间线只有文本。
 */

// ============================================================================
// 类型（兼容旧 API）
// ============================================================================

export type LoginAssistType = 'qrcode' | 'sms' | 'slider' | 'device' | 'auth' | 'other';

/** 默认 5 分钟；扫码/滑块长期挂起会泄漏 Promise 与 Map 条目 */
export const DEFAULT_LOGIN_ASSIST_TIMEOUT_MS = 5 * 60 * 1000;
/** 提交后多久仍无结果即标记「结果待确认」（不是失败）。 */
export const DEFAULT_LOGIN_VERIFY_TIMEOUT_MS = 20 * 1000;
/** 每个流程保留的时间线步骤上限。 */
export const LOGIN_FLOW_STEP_LIMIT = 20;

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

export interface LoginAssistEndpointIdentity {
  readonly canonicalId: string;
  readonly instanceId: string;
  readonly epoch: number;
  readonly incarnationId: string;
}

export interface PendingLoginTask {
  id: string;
  adapter: string;
  endpointKey: string;
  endpointIdentity?: LoginAssistEndpointIdentity;
  type: LoginAssistType;
  payload: PendingLoginTaskPayload;
  createdAt: number;
  /** 到期时间戳（ms）；无超时则为 undefined */
  expiresAt?: number;
  /** ADR 0058: owning login flow. */
  flowId?: string;
  /** ADR 0058: challenge this task answers (descriptor is in the flow snapshot). */
  challengeId?: string;
}

export interface WaitForInputOptions {
  /** Endpoint-instance owner. Only this owner may cancel the task during rollback/retirement. */
  owner: object;
  /** Captured Endpoint incarnation; abort retires this exact challenge immediately. */
  signal?: AbortSignal;
  endpointIdentity?: LoginAssistEndpointIdentity;
  /**
   * 超时毫秒。默认 {@link DEFAULT_LOGIN_ASSIST_TIMEOUT_MS}。
   * 传 `0` / `Infinity` / 负数表示不超时（仅测试或显式长驻场景）。
   */
  timeoutMs?: number;
}

export type LoginAssistTaskEventName =
  | 'endpoint.login.pending'
  | 'endpoint.login.resolved'
  | 'endpoint.login.expired';
export type LoginAssistEventName = LoginAssistTaskEventName | 'endpoint.login.flow';

/** Minimal bus shared by the runtime host and lightweight test emitters. */
export interface LoginAssistBus {
  emit(name: LoginAssistEventName, payload: PendingLoginTask | LoginFlowSnapshot): void;
}

// ============================================================================
// 类型（ADR 0058 LoginFlow）
// ============================================================================

export type { LoginChallengeKind } from '@zhin.js/adapter';
export type LoginFlowState = 'active' | 'online' | 'failed' | 'cancelled' | 'expired';
export type LoginStepKind = 'connect' | 'challenge' | 'verifying' | 'info';
export type LoginStepStatus = 'active' | 'done' | 'failed' | 'skipped';
export type LoginErrorCode =
  | 'code_invalid' | 'rate_limited' | 'challenge_expired' | 'risk_blocked'
  | 'credential_invalid' | 'network' | 'unknown';
export type LoginOutcomeResult = 'accepted' | 'rejected' | 'expired' | 'needs_new_challenge' | 'online' | 'failed';
export type LoginNextAction = 'retry_input' | 'refresh_challenge' | 'relogin' | 'wait' | 'none';

export const LOGIN_ERROR_CODES: readonly LoginErrorCode[] = Object.freeze([
  'code_invalid', 'rate_limited', 'challenge_expired', 'risk_blocked', 'credential_invalid', 'network', 'unknown',
]);

export interface LoginOutcome {
  readonly result: LoginOutcomeResult;
  readonly code?: LoginErrorCode;
  /** Sanitized single-line text; never contains submitted values. */
  readonly message?: string;
  readonly next?: LoginNextAction;
  readonly retryAfterMs?: number;
}

export interface LoginChallengeAction {
  readonly id: string;
  readonly label: string;
  readonly variant: 'primary' | 'secondary' | 'danger';
  readonly requiresInput?: boolean;
  readonly cooldownMs?: number;
}

export interface LoginChallengeInput {
  readonly kind: 'none' | 'code' | 'ticket' | 'text';
  readonly label: string;
  /** Regular expression source the trimmed input must match. */
  readonly pattern?: string;
  /** Live validation hint shown while the input does not match `pattern`. */
  readonly patternHint?: string;
  readonly length?: number;
  /** Never echoed (stdin) and never logged. */
  readonly secret?: boolean;
  /** Pull a ticket out of a pasted JSON object or URL before validation ({@link parseLoginTicket}). */
  readonly extract?: 'ticket-json-or-url';
}

export interface LoginChallengeMedia {
  /** Image URL or data URL; only present while the challenge is active. */
  readonly qrImage?: string;
  /** Set on event payloads that omitted `qrImage`; read the flow with `login.flow.get`. */
  readonly qrImageOmitted?: boolean;
  /** Only http / https links are kept. */
  readonly link?: Readonly<{ url: string; label: string }>;
  readonly expiresAt?: number;
  readonly refreshable?: boolean;
}

/**
 * One guided instruction. `blockId` points at the block the step is about; `doneWhen` lets the UI
 * tick the step off when that block was copied / opened (`manual` = the person ticks it).
 */
export type LoginHelpStep = string | Readonly<{
  text: string;
  blockId?: string;
  doneWhen?: 'copied' | 'opened' | 'manual';
}>;

export interface LoginChallengeHelp {
  readonly short: string;
  /** Ordered instructions. */
  readonly steps?: readonly LoginHelpStep[];
  /** Emphasized warning (e.g. never paste the device JSON on other sites). */
  readonly warning?: string;
}

/**
 * Material handed to the person, rendered in order between help and input.
 *
 * - `copy`: monospace text with a copy button. `sensitive` content (device info, tokens) is hidden
 *   until revealed, never logged, and exists only while the challenge is active. `format: 'script'`
 *   is static Adapter text — never interpolate user or device data into it; `bookmarklet` offers a
 *   draggable `javascript:` link built from the same text. `thenOpen` names a link block: the UI
 *   offers one "copy and open" button.
 * - `link`: http/https only; `showQr` also renders the URL as a QR code (client-side) for a phone.
 * - `note`: a short remark.
 */
export type LoginChallengeBlock =
  | Readonly<{
    kind: 'copy';
    id: string;
    label: string;
    content: string;
    format: 'json' | 'script' | 'text';
    sensitive?: boolean;
    collapsed?: boolean;
    collapsedLabel?: string;
    bookmarklet?: boolean;
    thenOpen?: string;
    /** Set on snapshots where sensitive content was removed (inactive challenge or event payload). */
    redacted?: boolean;
  }>
  | Readonly<{ kind: 'link'; id?: string; label: string; url: string; showQr?: boolean }>
  | Readonly<{ kind: 'note'; id?: string; text: string; tone?: 'info' | 'warning' }>;

export interface LoginChallenge {
  readonly id: string;
  readonly kind: LoginChallengeKind;
  readonly title: string;
  readonly help?: LoginChallengeHelp;
  readonly blocks?: readonly LoginChallengeBlock[];
  readonly media?: LoginChallengeMedia;
  readonly input?: LoginChallengeInput;
  readonly actions: readonly LoginChallengeAction[];
  readonly expiresAt?: number;
}

/** What an Adapter passes to `flow.challenge()`; `id` and `actions` get defaults. */
export type LoginChallengeDescriptor = Omit<LoginChallenge, 'id' | 'actions'> & {
  readonly id?: string;
  readonly actions?: readonly LoginChallengeAction[];
};

export interface LoginStep {
  readonly id: string;
  readonly kind: LoginStepKind;
  readonly status: LoginStepStatus;
  readonly title: string;
  readonly titleKey?: string;
  readonly detail?: string;
  readonly at: number;
  readonly endedAt?: number;
  readonly challenge?: LoginChallenge;
  /** LoginAssist task answering this challenge (while it is active). */
  readonly taskId?: string;
  readonly outcome?: LoginOutcome;
}

export interface LoginFlowSnapshot {
  readonly id: string;
  readonly adapter: string;
  readonly endpointKey: string;
  readonly endpointIdentity?: LoginAssistEndpointIdentity;
  readonly startedAt: number;
  readonly updatedAt: number;
  /** Increases with every change; consumers keep the highest revision per flow id. */
  readonly revision: number;
  readonly attempt: number;
  readonly state: LoginFlowState;
  /** Id of the step the flow is on (the last active step). */
  readonly currentStep?: string;
  readonly steps: readonly LoginStep[];
  readonly lastOutcome?: LoginOutcome;
  /** Submitted, but no result within the verify timeout: "result pending confirmation", not a failure. */
  readonly pendingConfirmation?: boolean;
  /** Task id of the active challenge (answer it with `submit`). */
  readonly activeTaskId?: string;
}

/** What the person answered: the chosen action and the input values (never stored or emitted). */
export interface LoginChallengeAnswer {
  readonly actionId: string;
  readonly values: Readonly<Record<string, string>>;
}

export interface BeginLoginFlowOptions {
  readonly adapter: string;
  readonly endpointKey: string;
  readonly owner: object;
  readonly signal?: AbortSignal;
  readonly endpointIdentity?: LoginAssistEndpointIdentity;
}

export interface LoginChallengeOptions {
  /** Overrides the default challenge timeout; `0` disables it. */
  readonly timeoutMs?: number;
}

/** Producer handle of one login flow. Calls after the flow ended are ignored. */
export interface LoginFlow {
  readonly id: string;
  snapshot(): LoginFlowSnapshot;
  /** Append a timeline step; returns its id. `info` steps are marks (done at once). */
  step(kind: Exclude<LoginStepKind, 'challenge'>, title: string, detail?: string, titleKey?: string): string;
  /** Open the flow's active challenge (replacing the previous one) and wait for the answer. */
  challenge(descriptor: LoginChallengeDescriptor, options?: LoginChallengeOptions): Promise<LoginChallengeAnswer>;
  /** Label the verifying step (inserted automatically on submit). */
  verifying(label: string): void;
  outcome(outcome: LoginOutcome): void;
  online(): void;
  fail(code: LoginErrorCode, message?: string, next?: LoginNextAction): void;
  /** End without a login result (`cancelled`, `expired`, `superseded`, …). */
  end(reason?: string): void;
}

/** Thrown by `submit` when an answer does not fit the challenge. The message never contains the value. */
export class LoginSubmissionError extends Error {
  constructor(readonly code: 'invalid_action' | 'input_required' | 'input_invalid', message: string) {
    super(message);
    this.name = 'LoginSubmissionError';
  }
}

/** Raised from a challenge promise when a newer challenge replaced it. */
export class LoginChallengeReplacedError extends Error {
  constructor() {
    super('replaced');
    this.name = 'LoginChallengeReplacedError';
  }
}

export interface SubmitAndWaitResult {
  readonly accepted: boolean;
  readonly outcome?: LoginOutcome;
  readonly pending?: boolean;
  readonly flow?: LoginFlowSnapshot;
}

export interface LoginAssistOptions {
  defaultTimeoutMs?: number;
  /** "Result pending confirmation" delay after a submit. Default 20 s. */
  verifyTimeoutMs?: number;
  /** Title of the automatically inserted verifying step. */
  verifyingTitle?: string;
}

// ============================================================================
// 内部记录
// ============================================================================

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type StepRecord = Mutable<LoginStep>;
type SettleWaiter = (settled: { outcome?: LoginOutcome }) => void;

interface FlowRecord {
  readonly id: string;
  readonly adapter: string;
  readonly endpointKey: string;
  readonly endpointIdentity?: LoginAssistEndpointIdentity;
  readonly owner: object;
  readonly startedAt: number;
  readonly seq: number;
  readonly attempt: number;
  readonly implicit: boolean;
  updatedAt: number;
  revision: number;
  state: LoginFlowState;
  steps: StepRecord[];
  lastOutcome?: LoginOutcome;
  pendingConfirmation: boolean;
  /** Task id of the active challenge. */
  activeTaskId?: string;
  verifyTimer?: ReturnType<typeof setTimeout>;
  readonly waiters: Set<SettleWaiter>;
  /** Submitted strings, kept only to redact them from adapter-supplied text; cleared at the end. */
  secrets: string[];
  detachAbort?: () => void;
  handle?: LoginFlow;
}

interface PendingEntry {
  task: PendingLoginTask;
  owner: object;
  flow: FlowRecord;
  stepId: string;
  /** Legacy waitForInput task: answers are not validated and resolve with the raw value. */
  legacy: boolean;
  resolve: (value: SubmittedValue) => void;
  reject: (err: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
  detachAbort?: () => void;
}

interface SubmittedValue {
  readonly raw: string | Record<string, unknown>;
  readonly answer: LoginChallengeAnswer;
}

const TERMINAL: ReadonlySet<LoginFlowState> = new Set(['online', 'failed', 'cancelled']);

// ============================================================================
// LoginAssist 服务
// ============================================================================

export class LoginAssist {
  private readonly bus: LoginAssistBus | null;
  private readonly pending = new Map<string, PendingEntry>();
  private readonly local = new Map<LoginAssistEventName, Set<(payload: never) => void>>();
  /** 构造时默认超时；可被 waitForInput options 覆盖 */
  private readonly defaultTimeoutMs: number;
  readonly #verifyTimeoutMs: number;
  readonly #verifyingTitle: string;
  readonly #flows = new Map<string, FlowRecord>();
  #seq = 0;

  constructor(bus?: LoginAssistBus | null, options?: LoginAssistOptions) {
    this.bus = bus ?? null;
    this.defaultTimeoutMs = options?.defaultTimeoutMs ?? DEFAULT_LOGIN_ASSIST_TIMEOUT_MS;
    this.#verifyTimeoutMs = options?.verifyTimeoutMs ?? DEFAULT_LOGIN_VERIFY_TIMEOUT_MS;
    this.#verifyingTitle = options?.verifyingTitle ?? '验证中…';
  }

  /**
   * Subscribe without requiring a Plugin EventEmitter.
   * Returns unsubscribe.
   */
  subscribe(name: 'endpoint.login.flow', listener: (flow: LoginFlowSnapshot) => void): () => void;
  subscribe(name: LoginAssistTaskEventName, listener: (task: PendingLoginTask) => void): () => void;
  subscribe(name: LoginAssistEventName, listener: ((payload: never) => void)): () => void {
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

  // --------------------------------------------------------------------------
  // Producer: flows
  // --------------------------------------------------------------------------

  /**
   * Start the login flow of one Endpoint. A previous unfinished flow of the same Endpoint instance
   * (owner) is ended as `superseded`; the attempt counter continues unless the last flow went online.
   */
  beginFlow(options: BeginLoginFlowOptions): LoginFlow {
    options.signal?.throwIfAborted();
    return this.#handle(this.#createFlow(options, false));
  }

  /** Latest flow per Endpoint (all states). Snapshots include the active challenge's material. */
  listFlows(): LoginFlowSnapshot[] {
    return [...this.#latestFlows().values()].map((flow) => this.#snapshot(flow));
  }

  getFlow(adapter: string, endpointKey: string): LoginFlowSnapshot | undefined {
    const flow = this.#latestFlows().get(endpointKeyOf(adapter, endpointKey));
    return flow ? this.#snapshot(flow) : undefined;
  }

  getFlowById(id: string): LoginFlowSnapshot | undefined {
    const flow = this.#flows.get(id);
    return flow ? this.#snapshot(flow) : undefined;
  }

  /** Flow a pending task belongs to. */
  flowOfTask(taskId: string): LoginFlowSnapshot | undefined {
    const entry = this.pending.get(taskId);
    return entry ? this.#snapshot(entry.flow) : undefined;
  }

  /**
   * True while an unfinished flow of this Endpoint waits for an answer. Adapters use it to
   * suppress automatic relogin while a person is answering a challenge.
   */
  hasActiveChallenge(endpointKey: string, adapter?: string): boolean {
    for (const flow of this.#flows.values()) {
      if (flow.endpointKey !== endpointKey || (adapter !== undefined && flow.adapter !== adapter)) continue;
      if (!TERMINAL.has(flow.state) && flow.activeTaskId && this.pending.has(flow.activeTaskId)) return true;
    }
    return false;
  }

  // --------------------------------------------------------------------------
  // Producer: legacy one-shot API
  // --------------------------------------------------------------------------

  /**
   * 生产者：等待用户输入后 resolve。会发出 endpoint.login.pending 事件，未消费前可被 listPending 拉取（刷新后可继续消费）。
   * 超时后 reject 并 emit `endpoint.login.expired`。
   *
   * ADR 0058: the task is a challenge of the Endpoint's current flow (an implicit flow when the
   * Adapter never called `beginFlow`); the payload is mapped to a challenge descriptor.
   */
  waitForInput(
    adapter: string,
    endpointKey: string,
    type: LoginAssistType,
    payload: PendingLoginTaskPayload,
    options: WaitForInputOptions,
  ): Promise<string | Record<string, unknown>> {
    options.signal?.throwIfAborted();
    const flow = this.#currentFlowFor(adapter, endpointKey, options.owner)
      ?? this.#createFlow({ adapter, endpointKey, owner: options.owner, endpointIdentity: options.endpointIdentity }, true);
    return this.#openChallenge(flow, legacyDescriptor(type, payload), {
      timeoutMs: options.timeoutMs,
      signal: options.signal,
      endpointIdentity: options.endpointIdentity,
      legacy: { type, payload },
    }).then(legacyValue);
  }

  // --------------------------------------------------------------------------
  // Consumer
  // --------------------------------------------------------------------------

  /**
   * 消费者：提交结果，对应 waitForInput / challenge 的 Promise 会 resolve。
   * `value` is a string (legacy) or `{ action, values }`. An answer that does not fit a
   * `beginFlow` challenge throws {@link LoginSubmissionError} and leaves the challenge open.
   */
  submit(id: string, value: string | Record<string, unknown>, endpointIdentity?: LoginAssistEndpointIdentity): boolean {
    const entry = this.pending.get(id);
    if (!entry || !matchesIdentity(entry.task.endpointIdentity, endpointIdentity)) return false;
    const step = entry.flow.steps.find((item) => item.id === entry.stepId);
    const answer = resolveAnswer(step?.challenge, value, !entry.legacy);
    this.pending.delete(id);
    this.#detach(entry);
    const flow = entry.flow;
    for (const text of Object.values(answer.values)) rememberSecret(flow, text);
    if (typeof value === 'string') rememberSecret(flow, value);
    if (step) {
      step.status = 'done';
      step.endedAt = Date.now();
      delete step.taskId;
      dropMedia(step);
    }
    if (flow.activeTaskId === id) delete flow.activeTaskId;
    this.#addVerifying(flow, this.#verifyingTitle, 'login.verifying');
    this.#armVerifyTimer(flow);
    entry.resolve({ raw: value, answer });
    this.#notify('endpoint.login.resolved', entry.task);
    this.#emitFlow(flow);
    return true;
  }

  /**
   * Submit and wait for the flow's next result (outcome, online, failure, end or a following
   * challenge) for at most `timeoutMs` (default 15 s). Without a result: `pending: true`.
   */
  async submitAndWait(
    id: string,
    value: string | Record<string, unknown>,
    options: { endpointIdentity?: LoginAssistEndpointIdentity; timeoutMs?: number } = {},
  ): Promise<SubmitAndWaitResult> {
    const flow = this.pending.get(id)?.flow;
    let settle!: SettleWaiter;
    const settled = new Promise<{ outcome?: LoginOutcome }>((resolve) => { settle = resolve; });
    flow?.waiters.add(settle);
    let accepted: boolean;
    try {
      accepted = this.submit(id, value, options.endpointIdentity);
    } catch (error) {
      flow?.waiters.delete(settle);
      throw error;
    }
    if (!accepted || !flow) {
      flow?.waiters.delete(settle);
      return { accepted };
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), options.timeoutMs ?? 15_000);
      timer.unref?.();
    });
    const result = await Promise.race([settled, timeout]);
    if (timer) clearTimeout(timer);
    flow.waiters.delete(settle);
    const snapshot = this.#snapshot(flow);
    if (!result) return { accepted: true, pending: true, flow: snapshot };
    return { accepted: true, ...(result.outcome ? { outcome: result.outcome } : {}), flow: snapshot };
  }

  /**
   * 消费者：取消某条待办，对应 Promise 会 reject；所属流程以 `cancelled` 结束。
   */
  cancel(id: string, reason = 'cancelled', endpointIdentity?: LoginAssistEndpointIdentity): boolean {
    const entry = this.pending.get(id);
    if (!entry || !matchesIdentity(entry.task.endpointIdentity, endpointIdentity)) return false;
    this.#rejectEntry(entry, new Error(reason), 'skipped');
    this.#endFlow(entry.flow, 'cancelled', reason);
    return true;
  }

  /**
   * Cancel pending tasks created by one exact Endpoint instance.
   *
   * Flow mapping of the reason: `replaced_by_*` only retires the active challenge (a new one
   * follows); `online` reports the flow online; `login_error` fails it; anything else ends it.
   */
  cancelOwned(owner: object, reason = 'superseded'): number {
    let count = 0;
    for (const [, entry] of [...this.pending]) {
      if (entry.owner !== owner) continue;
      this.#rejectEntry(entry, new Error(reason), 'skipped');
      count += 1;
    }
    if (reason.startsWith('replaced_by_')) {
      if (count > 0) for (const flow of this.#flows.values()) if (flow.owner === owner) this.#emitFlow(flow);
      return count;
    }
    for (const flow of [...this.#flows.values()]) {
      if (flow.owner !== owner || TERMINAL.has(flow.state)) continue;
      if (reason === 'online') this.#online(flow);
      else if (reason === 'login_error') this.#outcome(flow, { result: 'failed', code: 'unknown', next: 'relogin' });
      else this.#endFlow(flow, 'cancelled', reason);
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
      this.#detach(entry);
      entry.reject(new Error('LoginAssist disposed'));
    }
    this.pending.clear();
    for (const flow of this.#flows.values()) {
      if (flow.verifyTimer) clearTimeout(flow.verifyTimer);
      flow.detachAbort?.();
      for (const waiter of [...flow.waiters]) waiter({});
      flow.secrets = [];
    }
    this.#flows.clear();
    this.local.clear();
  }

  // --------------------------------------------------------------------------
  // Internals
  // --------------------------------------------------------------------------

  #latestFlows(): Map<string, FlowRecord> {
    const latest = new Map<string, FlowRecord>();
    for (const flow of this.#flows.values()) {
      const key = endpointKeyOf(flow.adapter, flow.endpointKey);
      const current = latest.get(key);
      if (!current || flow.seq > current.seq) latest.set(key, flow);
    }
    return latest;
  }

  #currentFlowFor(adapter: string, endpointKey: string, owner: object): FlowRecord | undefined {
    let found: FlowRecord | undefined;
    for (const flow of this.#flows.values()) {
      if (flow.adapter !== adapter || flow.endpointKey !== endpointKey || flow.owner !== owner) continue;
      if (TERMINAL.has(flow.state)) continue;
      if (!found || flow.seq > found.seq) found = flow;
    }
    return found;
  }

  #createFlow(options: BeginLoginFlowOptions, implicit: boolean): FlowRecord {
    let previous: FlowRecord | undefined;
    for (const flow of [...this.#flows.values()]) {
      if (flow.adapter !== options.adapter || flow.endpointKey !== options.endpointKey) continue;
      if (!previous || flow.seq > previous.seq) previous = flow;
      // The same Endpoint instance has one flow; finished flows of a replaced instance are dropped.
      // An unfinished flow of another instance (rollover) stays until that instance cancels it.
      if (flow.owner === options.owner || TERMINAL.has(flow.state)) {
        if (!TERMINAL.has(flow.state)) this.#endFlow(flow, 'cancelled', 'superseded');
        this.#flows.delete(flow.id);
      }
    }
    const now = Date.now();
    const flow: FlowRecord = {
      id: `flow-${randomUUID()}`,
      adapter: options.adapter,
      endpointKey: options.endpointKey,
      ...(options.endpointIdentity ? { endpointIdentity: Object.freeze({ ...options.endpointIdentity }) } : {}),
      owner: options.owner,
      startedAt: now,
      seq: ++this.#seq,
      attempt: previous && previous.state !== 'online' ? previous.attempt + 1 : 1,
      implicit,
      updatedAt: now,
      revision: 0,
      state: 'active',
      steps: [],
      pendingConfirmation: false,
      waiters: new Set(),
      secrets: [],
    };
    this.#flows.set(flow.id, flow);
    if (options.signal) {
      const signal = options.signal;
      const abort = () => { this.#endFlow(flow, 'cancelled', 'endpoint_retired'); };
      signal.addEventListener('abort', abort, { once: true });
      flow.detachAbort = () => signal.removeEventListener('abort', abort);
    }
    this.#emitFlow(flow);
    return flow;
  }

  #handle(flow: FlowRecord): LoginFlow {
    if (flow.handle) return flow.handle;
    const live = () => this.#flows.get(flow.id) === flow && !TERMINAL.has(flow.state);
    const handle: LoginFlow = {
      id: flow.id,
      snapshot: () => this.#snapshot(flow),
      step: (kind, title, detail, titleKey) => (live() ? this.#addStep(flow, kind, title, detail, titleKey) : ''),
      challenge: async (descriptor, options) => {
        if (!live()) throw new Error('login flow has ended');
        const value = await this.#openChallenge(flow, descriptor, { timeoutMs: options?.timeoutMs });
        return value.answer;
      },
      verifying: (label) => {
        if (!live()) return;
        this.#addVerifying(flow, label);
        this.#emitFlow(flow);
      },
      outcome: (outcome) => { if (live()) this.#outcome(flow, outcome); },
      online: () => { if (live()) this.#online(flow); },
      fail: (code, message, next) => {
        if (live()) this.#outcome(flow, { result: 'failed', code, ...(message ? { message } : {}), next: next ?? defaultNext(code) });
      },
      end: (reason = 'cancelled') => {
        if (live()) this.#endFlow(flow, reason === 'expired' ? 'expired' : 'cancelled', reason);
      },
    };
    flow.handle = Object.freeze(handle);
    return flow.handle;
  }

  #openChallenge(
    flow: FlowRecord,
    descriptor: LoginChallengeDescriptor,
    options: {
      timeoutMs?: number;
      signal?: AbortSignal;
      endpointIdentity?: LoginAssistEndpointIdentity;
      legacy?: { type: LoginAssistType; payload: PendingLoginTaskPayload };
    },
  ): Promise<SubmittedValue> {
    const timeoutMs = resolveTimeoutMs(options.timeoutMs, this.defaultTimeoutMs);
    const createdAt = Date.now();
    const normalized = normalizeChallenge(descriptor, flow.secrets);
    const expiresAt = normalized.expiresAt ?? (timeoutMs != null ? createdAt + timeoutMs : undefined);
    const challenge: LoginChallenge = Object.freeze({ ...normalized, ...(expiresAt !== undefined ? { expiresAt } : {}) });

    // One active challenge per flow: the previous one is replaced, not silently cancelled.
    if (flow.activeTaskId) {
      const previous = this.pending.get(flow.activeTaskId);
      if (previous) this.#rejectEntry(previous, new LoginChallengeReplacedError(), 'skipped');
    }
    // A challenge that follows a submit means the answer was accepted and the flow moved on.
    const verifying = lastActive(flow, 'verifying');
    const accepted: LoginOutcome | undefined = verifying && !verifying.outcome
      ? Object.freeze({ result: 'accepted' as const }) : undefined;
    if (verifying && accepted) verifying.outcome = accepted;
    this.#closeActive(flow, ['verifying', 'connect'], 'done');
    if (accepted) this.#settle(flow, { outcome: accepted });
    if (flow.verifyTimer) { clearTimeout(flow.verifyTimer); delete flow.verifyTimer; }
    flow.pendingConfirmation = false;
    if (flow.state === 'expired') flow.state = 'active';

    const id = `login-${randomUUID()}`;
    const stepId = `step-${randomUUID()}`;
    const identity = options.endpointIdentity ?? flow.endpointIdentity;
    const legacy = options.legacy;
    const task: PendingLoginTask = {
      id,
      adapter: flow.adapter,
      endpointKey: flow.endpointKey,
      ...(identity ? { endpointIdentity: Object.freeze({ ...identity }) } : {}),
      type: legacy?.type ?? legacyTypeOf(challenge),
      payload: legacy
        ? { message: legacy.payload.message ?? '', ...legacy.payload }
        : legacyPayloadOf(challenge),
      createdAt,
      ...(expiresAt !== undefined ? { expiresAt } : {}),
      flowId: flow.id,
      challengeId: challenge.id,
    };
    this.#pushStep(flow, {
      id: stepId, kind: 'challenge', status: 'active', title: challenge.title, at: createdAt,
      challenge, taskId: id,
    });
    flow.activeTaskId = id;
    const effectiveTimeout = expiresAt !== undefined ? Math.max(0, expiresAt - createdAt) : undefined;

    return new Promise<SubmittedValue>((resolve, reject) => {
      const entry: PendingEntry = { task, owner: flow.owner, flow, stepId, legacy: !!legacy, resolve, reject };
      if (effectiveTimeout !== undefined) {
        entry.timer = setTimeout(() => {
          if (!this.pending.has(id)) return;
          this.pending.delete(id);
          this.#detach(entry);
          try {
            this.#notify('endpoint.login.expired', task);
          } catch {
            /* observer failure must not leave the producer hanging forever */
          }
          this.#expireChallenge(flow, stepId, id);
          reject(new Error(`LoginAssist task timed out after ${effectiveTimeout}ms`));
        }, effectiveTimeout);
        // Node: 不阻止进程退出
        entry.timer.unref?.();
      }
      this.pending.set(id, entry);
      if (options.signal) {
        const signal = options.signal;
        const abort = () => { this.cancel(id, 'endpoint_retired'); };
        signal.addEventListener('abort', abort, { once: true });
        entry.detachAbort = () => signal.removeEventListener('abort', abort);
        if (signal.aborted) abort();
      }
      if (this.pending.has(id)) {
        this.#notify('endpoint.login.pending', task);
        this.#emitFlow(flow);
      }
    });
  }

  #expireChallenge(flow: FlowRecord, stepId: string, taskId: string): void {
    const step = flow.steps.find((item) => item.id === stepId);
    const outcome: LoginOutcome = Object.freeze({
      result: 'expired', code: 'challenge_expired',
      next: step?.challenge?.media?.refreshable ? 'refresh_challenge' : 'relogin',
    });
    if (step) {
      step.status = 'failed';
      step.endedAt = Date.now();
      step.outcome = outcome;
      delete step.taskId;
      dropMedia(step);
    }
    if (flow.activeTaskId === taskId) delete flow.activeTaskId;
    flow.lastOutcome = outcome;
    if (!TERMINAL.has(flow.state)) flow.state = 'expired';
    this.#settle(flow, { outcome });
    this.#emitFlow(flow);
  }

  /** Reject one pending entry and retire its challenge step (no flow state change). */
  #rejectEntry(entry: PendingEntry, error: Error, status: LoginStepStatus): void {
    if (this.pending.get(entry.task.id) !== entry) return;
    this.pending.delete(entry.task.id);
    this.#detach(entry);
    const step = entry.flow.steps.find((item) => item.id === entry.stepId);
    if (step && step.status === 'active') {
      step.status = status;
      step.endedAt = Date.now();
      delete step.taskId;
      dropMedia(step);
    }
    if (entry.flow.activeTaskId === entry.task.id) delete entry.flow.activeTaskId;
    entry.reject(error);
    this.#notify('endpoint.login.resolved', entry.task);
  }

  #addStep(flow: FlowRecord, kind: Exclude<LoginStepKind, 'challenge'>, title: string, detail?: string, titleKey?: string): string {
    const id = `step-${randomUUID()}`;
    if (kind !== 'info') this.#closeActive(flow, ['connect', 'verifying'], 'done');
    if (flow.state === 'expired') flow.state = 'active';
    const cleanDetail = detail ? sanitizeText(detail, flow.secrets) : '';
    this.#pushStep(flow, {
      id, kind, status: kind === 'info' ? 'done' : 'active',
      title: sanitizeText(title, flow.secrets, 120) || kind,
      ...(titleKey ? { titleKey } : {}),
      ...(cleanDetail ? { detail: cleanDetail } : {}),
      at: Date.now(),
    });
    this.#emitFlow(flow);
    return id;
  }

  #addVerifying(flow: FlowRecord, title: string, titleKey?: string): void {
    const last = lastActive(flow, 'verifying');
    if (last) {
      last.title = sanitizeText(title, flow.secrets, 120) || last.title;
      if (titleKey) last.titleKey = titleKey; else delete last.titleKey;
      return;
    }
    this.#closeActive(flow, ['connect'], 'done');
    this.#pushStep(flow, {
      id: `step-${randomUUID()}`, kind: 'verifying', status: 'active',
      title: sanitizeText(title, flow.secrets, 120) || this.#verifyingTitle,
      ...(titleKey ? { titleKey } : {}),
      at: Date.now(),
    });
  }

  #armVerifyTimer(flow: FlowRecord): void {
    if (flow.verifyTimer) clearTimeout(flow.verifyTimer);
    delete flow.verifyTimer;
    flow.pendingConfirmation = false;
    if (!(this.#verifyTimeoutMs > 0) || !Number.isFinite(this.#verifyTimeoutMs)) return;
    flow.verifyTimer = setTimeout(() => {
      delete flow.verifyTimer;
      if (TERMINAL.has(flow.state) || this.#flows.get(flow.id) !== flow) return;
      if (!lastActive(flow, 'verifying')) return;
      flow.pendingConfirmation = true;
      this.#emitFlow(flow);
    }, this.#verifyTimeoutMs);
    flow.verifyTimer.unref?.();
  }

  #outcome(flow: FlowRecord, input: LoginOutcome): void {
    const outcome = normalizeOutcome(input, flow.secrets);
    if (outcome.result === 'online') { this.#online(flow, outcome); return; }
    const target = lastActive(flow, 'verifying')
      ?? [...flow.steps].reverse().find((step) => step.kind === 'verifying' || step.kind === 'challenge')
      ?? flow.steps.at(-1);
    if (target) {
      target.outcome = outcome;
      if (target.status === 'active' || target.kind === 'verifying') {
        target.status = outcome.result === 'accepted' ? 'done' : 'failed';
        target.endedAt = Date.now();
      }
    }
    flow.lastOutcome = outcome;
    if (flow.verifyTimer) { clearTimeout(flow.verifyTimer); delete flow.verifyTimer; }
    flow.pendingConfirmation = false;
    if (outcome.result === 'failed') {
      this.#retireActiveChallenge(flow, 'login_failed');
      this.#closeActive(flow, ['connect', 'verifying'], 'failed');
      flow.state = 'failed';
      this.#finish(flow);
    } else if (outcome.result === 'expired' && !flow.activeTaskId) {
      flow.state = 'expired';
    }
    this.#settle(flow, { outcome });
    this.#emitFlow(flow);
  }

  #online(flow: FlowRecord, outcome: LoginOutcome = Object.freeze({ result: 'online' as const })): void {
    this.#retireActiveChallenge(flow, 'online');
    const verifying = lastActive(flow, 'verifying');
    if (verifying) verifying.outcome = outcome;
    this.#closeActive(flow, ['connect', 'verifying'], 'done');
    if (flow.verifyTimer) { clearTimeout(flow.verifyTimer); delete flow.verifyTimer; }
    flow.pendingConfirmation = false;
    flow.lastOutcome = outcome;
    flow.state = 'online';
    this.#finish(flow);
    this.#settle(flow, { outcome });
    this.#emitFlow(flow);
  }

  #endFlow(flow: FlowRecord, state: 'cancelled' | 'expired', reason: string): void {
    if (TERMINAL.has(flow.state)) return;
    this.#retireActiveChallenge(flow, reason);
    this.#closeActive(flow, ['connect', 'verifying'], 'skipped');
    if (flow.verifyTimer) { clearTimeout(flow.verifyTimer); delete flow.verifyTimer; }
    flow.pendingConfirmation = false;
    flow.state = state;
    if (state === 'cancelled') this.#finish(flow);
    this.#settle(flow, {});
    this.#emitFlow(flow);
  }

  #retireActiveChallenge(flow: FlowRecord, reason: string): void {
    if (!flow.activeTaskId) return;
    const entry = this.pending.get(flow.activeTaskId);
    if (entry) this.#rejectEntry(entry, new Error(reason), 'skipped');
    delete flow.activeTaskId;
  }

  #closeActive(flow: FlowRecord, kinds: readonly LoginStepKind[], status: LoginStepStatus): void {
    const now = Date.now();
    for (const step of flow.steps) {
      if (step.status !== 'active' || !kinds.includes(step.kind)) continue;
      step.status = status;
      step.endedAt = now;
    }
  }

  #pushStep(flow: FlowRecord, step: StepRecord): void {
    flow.steps.push(step);
    while (flow.steps.length > LOGIN_FLOW_STEP_LIMIT) {
      const index = flow.steps.findIndex((item) => item.status !== 'active');
      flow.steps.splice(index < 0 ? 0 : index, 1);
    }
  }

  #settle(flow: FlowRecord, settled: { outcome?: LoginOutcome }): void {
    for (const waiter of [...flow.waiters]) {
      flow.waiters.delete(waiter);
      waiter(settled);
    }
  }

  #finish(flow: FlowRecord): void {
    flow.detachAbort?.();
    delete flow.detachAbort;
    flow.secrets = [];
  }

  #snapshot(flow: FlowRecord): LoginFlowSnapshot {
    const current = [...flow.steps].reverse().find((step) => step.status === 'active') ?? flow.steps.at(-1);
    return Object.freeze({
      id: flow.id,
      adapter: flow.adapter,
      endpointKey: flow.endpointKey,
      ...(flow.endpointIdentity ? { endpointIdentity: flow.endpointIdentity } : {}),
      startedAt: flow.startedAt,
      updatedAt: flow.updatedAt,
      revision: flow.revision,
      attempt: flow.attempt,
      state: flow.state,
      ...(current ? { currentStep: current.id } : {}),
      steps: Object.freeze(flow.steps.map((step) => freezeStep(step))),
      ...(flow.lastOutcome ? { lastOutcome: flow.lastOutcome } : {}),
      ...(flow.pendingConfirmation ? { pendingConfirmation: true } : {}),
      ...(flow.activeTaskId ? { activeTaskId: flow.activeTaskId } : {}),
    });
  }

  #emitFlow(flow: FlowRecord): void {
    flow.revision += 1;
    flow.updatedAt = Date.now();
    this.#notify('endpoint.login.flow', this.#snapshot(flow));
  }

  #detach(entry: PendingEntry): void {
    if (entry.timer) clearTimeout(entry.timer);
    entry.detachAbort?.();
  }

  #notify(name: LoginAssistEventName, payload: PendingLoginTask | LoginFlowSnapshot): void {
    try {
      this.bus?.emit(name, payload);
    } catch {
      /* bus observers must not break producer */
    }
    for (const listener of this.local.get(name) ?? []) {
      try {
        (listener as (value: unknown) => void)(payload);
      } catch {
        /* same */
      }
    }
  }
}

// ============================================================================
// Helpers
// ============================================================================

function lastActive(flow: FlowRecord, kind: LoginStepKind): StepRecord | undefined {
  for (let index = flow.steps.length - 1; index >= 0; index -= 1) {
    const step = flow.steps[index]!;
    if (step.kind === kind && step.status === 'active') return step;
  }
  return undefined;
}

/**
 * Event / history-safe copy of a flow snapshot: QR images are replaced by `qrImageOmitted` and
 * sensitive copy blocks are redacted. Consumers read the live material with `login.flow.get`.
 */
export function withoutLoginMedia(flow: LoginFlowSnapshot): LoginFlowSnapshot {
  if (!flow.steps.some((step) => step.challenge?.media?.qrImage || step.challenge?.blocks?.some(isSensitiveBlock))) return flow;
  return Object.freeze({
    ...flow,
    steps: Object.freeze(flow.steps.map((step) => {
      const challenge = step.challenge;
      if (!challenge) return step;
      let next: LoginChallenge = challenge;
      if (challenge.media?.qrImage) {
        const { qrImage: _image, ...rest } = challenge.media;
        next = { ...next, media: Object.freeze({ ...rest, qrImageOmitted: true }) };
      }
      if (challenge.blocks?.some(isSensitiveBlock)) next = { ...next, blocks: redactBlocks(challenge.blocks) };
      return next === challenge ? step : Object.freeze({ ...step, challenge: Object.freeze(next) });
    })),
  });
}

/** Alias that names the purpose: what may enter events, history and logs. */
export const eventSafeLoginFlow = withoutLoginMedia;

/** Default next action for an error code. */
export function defaultNext(code: LoginErrorCode): LoginNextAction {
  switch (code) {
    case 'code_invalid': return 'retry_input';
    case 'challenge_expired': return 'refresh_challenge';
    case 'rate_limited':
    case 'network': return 'wait';
    case 'risk_blocked': return 'none';
    default: return 'relogin';
  }
}

export type LoginTicketParseResult =
  | Readonly<{ ok: true; ticket: string; randstr?: string }>
  | Readonly<{ ok: false; error: string }>;

/**
 * Pure parser behind `input.extract: 'ticket-json-or-url'` (shared by Console, SDK and stdin).
 * Accepts a raw ticket, `ticket,randstr`, a JSON response body (`{ ticket, randstr }`, also nested
 * one level under `data` / `result`), or a URL with a `ticket=` query parameter.
 */
export function parseLoginTicket(raw: unknown): LoginTicketParseResult {
  if (typeof raw !== 'string') return Object.freeze({ ok: false, error: '请粘贴 ticket、验证返回的 JSON 或带 ticket 的链接' });
  const text = raw.trim();
  if (!text) return Object.freeze({ ok: false, error: '请粘贴 ticket、验证返回的 JSON 或带 ticket 的链接' });
  const done = (ticket: unknown, randstr?: unknown): LoginTicketParseResult => {
    const value = typeof ticket === 'string' ? ticket.trim() : '';
    if (!value) return Object.freeze({ ok: false, error: '没有找到 ticket' });
    if (/\s/u.test(value)) return Object.freeze({ ok: false, error: 'ticket 不应包含空白字符，请只粘贴 ticket 本身' });
    const extra = typeof randstr === 'string' && randstr.trim() ? { randstr: randstr.trim() } : {};
    return Object.freeze({ ok: true, ticket: value, ...extra });
  };
  if (text.startsWith('{')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return Object.freeze({ ok: false, error: 'JSON 格式不完整，请复制完整的返回内容' });
    }
    const candidates = [parsed, (parsed as Record<string, unknown>)?.data, (parsed as Record<string, unknown>)?.result];
    for (const candidate of candidates) {
      if (candidate && typeof candidate === 'object' && typeof (candidate as Record<string, unknown>).ticket === 'string') {
        const record = candidate as Record<string, unknown>;
        return done(record.ticket, record.randstr);
      }
    }
    return Object.freeze({ ok: false, error: 'JSON 中没有 ticket 字段' });
  }
  if (/^https?:\/\//iu.test(text)) {
    let url: URL;
    try {
      url = new URL(text);
    } catch {
      return Object.freeze({ ok: false, error: '链接格式不正确' });
    }
    const hash = new URLSearchParams(url.hash.replace(/^#/u, ''));
    const ticket = url.searchParams.get('ticket') ?? hash.get('ticket');
    if (!ticket) return Object.freeze({ ok: false, error: '链接中没有 ticket 参数' });
    return done(ticket, url.searchParams.get('randstr') ?? hash.get('randstr') ?? undefined);
  }
  const comma = text.split(',');
  if (comma.length === 2 && comma[0]!.trim() && comma[1]!.trim()) return done(comma[0], comma[1]);
  if (comma.length > 2) return Object.freeze({ ok: false, error: '格式应为 ticket 或 ticket,randstr' });
  return done(text);
}

/** Ticket text for an input with `extract: 'ticket-json-or-url'` (the raw text when unparseable). */
export function extractLoginTicket(raw: string): string {
  const parsed = parseLoginTicket(raw);
  return parsed.ok ? parsed.ticket : raw.trim();
}

function endpointKeyOf(adapter: string, endpointKey: string): string {
  return `${adapter}\u0000${endpointKey}`;
}

function rememberSecret(flow: FlowRecord, value: string): void {
  const text = value.trim();
  if (text.length >= 3 && !flow.secrets.includes(text)) flow.secrets.push(text);
  if (flow.secrets.length > 16) flow.secrets.shift();
}

/** A challenge that is no longer active keeps neither its QR image nor sensitive material. */
function dropMedia(step: StepRecord): void {
  if (step.challenge?.media?.qrImage) {
    const { qrImage: _image, ...rest } = step.challenge.media;
    step.challenge = Object.freeze({ ...step.challenge, media: Object.freeze(rest) });
  }
  if (step.challenge?.blocks?.some(isSensitiveBlock)) {
    step.challenge = Object.freeze({ ...step.challenge, blocks: redactBlocks(step.challenge.blocks) });
  }
}

function isSensitiveBlock(block: LoginChallengeBlock): boolean {
  return block.kind === 'copy' && !!block.sensitive && !block.redacted;
}

function redactBlocks(blocks: readonly LoginChallengeBlock[]): readonly LoginChallengeBlock[] {
  return Object.freeze(blocks.map((block) => (isSensitiveBlock(block)
    ? Object.freeze({ ...block, content: '', redacted: true }) : block)));
}

function freezeStep(step: StepRecord): LoginStep {
  const challenge = step.challenge ? Object.freeze({
    ...step.challenge,
    ...(step.challenge.media ? { media: Object.freeze({ ...step.challenge.media }) } : {}),
    actions: Object.freeze(step.challenge.actions.map((action) => Object.freeze({ ...action }))),
  }) : undefined;
  return Object.freeze({ ...step, ...(challenge ? { challenge } : {}) });
}

/** Single line, no control characters, bounded, submitted values redacted. */
function sanitizeText(value: unknown, secrets: readonly string[] = [], max = 300): string {
  if (typeof value !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  let text = value.replace(/[\u0000-\u001f\u007f]+/gu, ' ').replace(/\s+/gu, ' ').trim();
  for (const secret of secrets) if (secret) text = text.split(secret).join('***');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function safeLink(url: unknown): string | undefined {
  if (typeof url !== 'string' || !url.trim()) return undefined;
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

const CHALLENGE_KINDS: readonly LoginChallengeKind[] = ['qrcode', 'link_verify', 'slider', 'sms', 'device', 'auth', 'confirm', 'other'];
const ACTION_VARIANTS = ['primary', 'secondary', 'danger'] as const;
const INPUT_KINDS = ['none', 'code', 'ticket', 'text'] as const;

function normalizeChallenge(
  descriptor: LoginChallengeDescriptor,
  secrets: readonly string[],
): Mutable<LoginChallenge> & { media?: Mutable<LoginChallengeMedia> } {
  const kind = CHALLENGE_KINDS.includes(descriptor.kind) ? descriptor.kind : 'other';
  const input = descriptor.input && INPUT_KINDS.includes(descriptor.input.kind) && descriptor.input.kind !== 'none'
    ? Object.freeze({
      kind: descriptor.input.kind,
      label: sanitizeText(descriptor.input.label, secrets, 80) || '输入',
      ...(typeof descriptor.input.pattern === 'string' && validPattern(descriptor.input.pattern) ? { pattern: descriptor.input.pattern } : {}),
      ...(typeof descriptor.input.patternHint === 'string' && descriptor.input.patternHint.trim()
        ? { patternHint: sanitizeText(descriptor.input.patternHint, secrets, 120) } : {}),
      ...(Number.isSafeInteger(descriptor.input.length) && descriptor.input.length! > 0 ? { length: descriptor.input.length } : {}),
      ...(descriptor.input.secret ? { secret: true } : {}),
      ...(descriptor.input.extract === 'ticket-json-or-url' ? { extract: 'ticket-json-or-url' as const } : {}),
    })
    : descriptor.input?.kind === 'none' ? Object.freeze({ kind: 'none' as const, label: sanitizeText(descriptor.input.label, secrets, 80) }) : undefined;
  const hasInput = !!input && input.kind !== 'none';
  const declared = (descriptor.actions ?? []).filter((action) => action && typeof action.id === 'string' && action.id
    && typeof action.label === 'string');
  const actions = declared.length > 0
    ? declared.map((action) => Object.freeze({
      id: action.id,
      label: sanitizeText(action.label, secrets, 40) || action.id,
      variant: ACTION_VARIANTS.includes(action.variant) ? action.variant : 'secondary',
      ...(action.requiresInput && hasInput ? { requiresInput: true } : {}),
      ...(Number.isFinite(action.cooldownMs) && action.cooldownMs! > 0 ? { cooldownMs: action.cooldownMs } : {}),
    }))
    : [hasInput
      ? Object.freeze({ id: 'submit', label: '提交', variant: 'primary' as const, requiresInput: true })
      : Object.freeze({ id: 'confirm', label: '已完成', variant: 'primary' as const })];
  const link = descriptor.media?.link ? safeLink(descriptor.media.link.url) : undefined;
  const qrImage = typeof descriptor.media?.qrImage === 'string' && descriptor.media.qrImage.trim()
    ? descriptor.media.qrImage.trim() : undefined;
  const media: Mutable<LoginChallengeMedia> | undefined = descriptor.media ? {
    ...(qrImage ? { qrImage } : {}),
    ...(link ? { link: Object.freeze({ url: link, label: sanitizeText(descriptor.media.link?.label, secrets, 80) || link }) } : {}),
    ...(Number.isFinite(descriptor.media.expiresAt) ? { expiresAt: descriptor.media.expiresAt } : {}),
    ...(descriptor.media.refreshable ? { refreshable: true } : {}),
  } : undefined;
  const blocks = normalizeBlocks(descriptor.blocks, secrets);
  const blockIds = new Set(blocks.map((block) => block.id).filter((id): id is string => !!id));
  const help = descriptor.help && typeof descriptor.help.short === 'string'
    ? Object.freeze({
      short: sanitizeText(descriptor.help.short, secrets),
      ...(Array.isArray(descriptor.help.steps)
        ? { steps: Object.freeze(descriptor.help.steps.slice(0, 12).map((step) => normalizeHelpStep(step, blockIds, secrets))
          .filter((step) => (typeof step === 'string' ? step : step.text))) }
        : {}),
      ...(typeof descriptor.help.warning === 'string' && descriptor.help.warning.trim()
        ? { warning: sanitizeText(descriptor.help.warning, secrets) } : {}),
    })
    : undefined;
  return {
    id: typeof descriptor.id === 'string' && descriptor.id ? descriptor.id.slice(0, 128) : `challenge-${randomUUID()}`,
    kind,
    title: sanitizeText(descriptor.title, secrets, 120) || kind,
    ...(help ? { help } : {}),
    ...(blocks.length > 0 ? { blocks: Object.freeze(blocks) } : {}),
    ...(media && Object.keys(media).length > 0 ? { media } : {}),
    ...(input ? { input } : {}),
    actions: Object.freeze(actions),
    ...(Number.isFinite(descriptor.expiresAt) ? { expiresAt: descriptor.expiresAt } : {}),
  };
}

const COPY_FORMATS = ['json', 'script', 'text'] as const;
/** Upper bound of one copy block (device JSON and helper scripts are a few KiB). */
const COPY_BLOCK_LIMIT = 32 * 1024;

function normalizeHelpStep(step: LoginHelpStep, blockIds: ReadonlySet<string>, secrets: readonly string[]): LoginHelpStep {
  if (typeof step === 'string') return sanitizeText(step, secrets);
  if (!step || typeof step !== 'object') return '';
  const text = sanitizeText(step.text, secrets);
  const blockId = typeof step.blockId === 'string' && blockIds.has(step.blockId) ? step.blockId : undefined;
  const doneWhen = step.doneWhen === 'copied' || step.doneWhen === 'opened' || step.doneWhen === 'manual' ? step.doneWhen : undefined;
  return Object.freeze({ text, ...(blockId ? { blockId } : {}), ...(doneWhen ? { doneWhen } : {}) });
}

/** Keeps well-formed blocks only: http/https links, bounded copy text, `thenOpen` to a known link. */
function normalizeBlocks(input: readonly LoginChallengeBlock[] | undefined, secrets: readonly string[]): LoginChallengeBlock[] {
  if (!Array.isArray(input)) return [];
  const blocks: LoginChallengeBlock[] = [];
  const ids = new Set<string>();
  const id = (value: unknown): string | undefined => {
    if (typeof value !== 'string' || !value || value.length > 64 || ids.has(value)) return undefined;
    ids.add(value);
    return value;
  };
  for (const block of input.slice(0, 12)) {
    if (!block || typeof block !== 'object') continue;
    if (block.kind === 'link') {
      const url = safeLink(block.url);
      if (!url) continue;
      const blockId = id(block.id);
      blocks.push(Object.freeze({
        kind: 'link', ...(blockId ? { id: blockId } : {}),
        label: sanitizeText(block.label, secrets, 80) || url, url,
        ...(block.showQr ? { showQr: true } : {}),
      }));
    } else if (block.kind === 'note') {
      const text = sanitizeText(block.text, secrets);
      if (!text) continue;
      const blockId = id(block.id);
      blocks.push(Object.freeze({
        kind: 'note', ...(blockId ? { id: blockId } : {}), text,
        ...(block.tone === 'warning' || block.tone === 'info' ? { tone: block.tone } : {}),
      }));
    } else if (block.kind === 'copy') {
      const blockId = id(block.id);
      if (!blockId || typeof block.content !== 'string' || !block.content || block.content.length > COPY_BLOCK_LIMIT) continue;
      if (!COPY_FORMATS.includes(block.format)) continue;
      blocks.push(Object.freeze({
        kind: 'copy', id: blockId, label: sanitizeText(block.label, secrets, 80) || blockId,
        // Multi-line material is kept verbatim (it is copied, not rendered as markup).
        content: block.content, format: block.format,
        ...(block.sensitive ? { sensitive: true } : {}),
        ...(block.collapsed ? { collapsed: true } : {}),
        ...(typeof block.collapsedLabel === 'string' && block.collapsedLabel.trim()
          ? { collapsedLabel: sanitizeText(block.collapsedLabel, secrets, 80) } : {}),
        ...(block.bookmarklet && block.format === 'script' ? { bookmarklet: true } : {}),
        ...(typeof block.thenOpen === 'string' && block.thenOpen ? { thenOpen: block.thenOpen } : {}),
      }));
    }
  }
  // `thenOpen` must name a link block of this challenge.
  const links = new Set(blocks.filter((block) => block.kind === 'link' && block.id).map((block) => block.id));
  return blocks.map((block) => {
    if (block.kind !== 'copy' || !block.thenOpen || links.has(block.thenOpen)) return block;
    const { thenOpen: _drop, ...rest } = block;
    return Object.freeze(rest);
  });
}

function validPattern(pattern: string): boolean {
  if (pattern.length > 200) return false;
  try { new RegExp(pattern, 'u'); return true; } catch { return false; }
}

function normalizeOutcome(input: LoginOutcome, secrets: readonly string[]): LoginOutcome {
  const message = sanitizeText(input.message, secrets);
  return Object.freeze({
    result: input.result,
    ...(input.code && LOGIN_ERROR_CODES.includes(input.code) ? { code: input.code } : input.code ? { code: 'unknown' as const } : {}),
    ...(message ? { message } : {}),
    ...(input.next ? { next: input.next } : {}),
    ...(Number.isFinite(input.retryAfterMs) && input.retryAfterMs! > 0 ? { retryAfterMs: input.retryAfterMs } : {}),
  });
}

/** Map a legacy waitForInput payload to a descriptor. */
function legacyDescriptor(type: LoginAssistType, payload: PendingLoginTaskPayload): LoginChallengeDescriptor {
  const message = typeof payload.message === 'string' ? payload.message : '';
  const image = typeof payload.image === 'string' ? payload.image : undefined;
  const url = typeof payload.url === 'string' ? payload.url : undefined;
  const link = url ? { url, label: url } : undefined;
  const media = image || link ? { ...(image ? { qrImage: image } : {}), ...(link ? { link } : {}) } : undefined;
  switch (type) {
    case 'qrcode':
    case 'auth':
      return {
        kind: type, title: message || (type === 'qrcode' ? '请扫码登录' : '请完成验证'),
        ...(media ? { media } : {}),
        actions: [{ id: 'confirm', label: '已完成', variant: 'primary' }],
      };
    case 'slider':
      return {
        kind: 'slider', title: message || '请完成滑块验证', ...(media ? { media } : {}),
        input: { kind: 'ticket', label: 'ticket', extract: 'ticket-json-or-url' },
        actions: [{ id: 'submit', label: '提交', variant: 'primary', requiresInput: true }],
      };
    case 'sms':
    case 'device':
      return {
        kind: type, title: message || '请输入验证码', ...(media ? { media } : {}),
        input: { kind: 'code', label: '验证码' },
        actions: [{ id: 'submit', label: '提交', variant: 'primary', requiresInput: true }],
      };
    default:
      return {
        kind: 'other', title: message || '登录辅助', ...(media ? { media } : {}),
        input: { kind: 'text', label: '输入' },
        actions: [{ id: 'submit', label: '提交', variant: 'primary', requiresInput: true }],
      };
  }
}

function legacyTypeOf(challenge: LoginChallenge): LoginAssistType {
  const hasInput = !!challenge.input && challenge.input.kind !== 'none';
  switch (challenge.kind) {
    case 'qrcode': return 'qrcode';
    case 'slider': return hasInput ? 'slider' : 'auth';
    case 'sms': return hasInput ? 'sms' : 'auth';
    case 'device': return hasInput ? 'device' : 'auth';
    default: return hasInput ? 'other' : 'auth';
  }
}

function legacyPayloadOf(challenge: LoginChallenge): PendingLoginTaskPayload {
  return {
    message: challenge.title,
    ...(challenge.media?.qrImage ? { image: challenge.media.qrImage } : {}),
    ...(challenge.media?.link ? { url: challenge.media.link.url } : {}),
  };
}

/** What a legacy waitForInput caller receives. */
function legacyValue(value: SubmittedValue): string | Record<string, unknown> {
  const raw = value.raw;
  if (typeof raw === 'string' || !isStructured(raw)) return raw;
  return value.answer.values.input ?? 'ok';
}

function isStructured(value: unknown): value is { action: string; values?: Record<string, unknown> } {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && typeof (value as { action?: unknown }).action === 'string';
}

function defaultAction(challenge: LoginChallenge | undefined, hasInput: boolean): string {
  const actions = challenge?.actions ?? [];
  return ((hasInput ? actions.find((action) => action.requiresInput) : undefined)
    ?? actions.find((action) => action.variant === 'primary' && !action.requiresInput)
    ?? actions.find((action) => action.variant === 'primary')
    ?? actions[0]
    ?? { id: hasInput ? 'submit' : 'confirm' }
  ).id;
}

function resolveAnswer(
  challenge: LoginChallenge | undefined,
  value: string | Record<string, unknown>,
  validate: boolean,
): LoginChallengeAnswer {
  const input = challenge?.input && challenge.input.kind !== 'none' ? challenge.input : undefined;
  /** Input values for one raw text; `validate` raises precise errors. */
  const inputValues = (raw: string, required: boolean): Record<string, string> => {
    const text = raw.trim();
    if (!input) return {};
    if (!text) {
      if (required && validate) throw new LoginSubmissionError('input_required', `${input.label} is required`);
      return {};
    }
    if (input.extract === 'ticket-json-or-url') {
      const parsed = parseLoginTicket(text);
      if (!parsed.ok) {
        if (validate) throw new LoginSubmissionError('input_invalid', parsed.error);
        return { input: text };
      }
      return { input: parsed.ticket, ...(parsed.randstr ? { randstr: parsed.randstr } : {}) };
    }
    if (validate) {
      if (input.length && text.length !== input.length) {
        throw new LoginSubmissionError('input_invalid', input.patternHint ?? `${input.label} must have ${input.length} characters`);
      }
      if (input.pattern && !new RegExp(input.pattern, 'u').test(text)) {
        throw new LoginSubmissionError('input_invalid', input.patternHint ?? `${input.label} has an invalid format`);
      }
    }
    return { input: text };
  };
  if (isStructured(value)) {
    const action = challenge?.actions.find((item) => item.id === value.action);
    if (!action && challenge) throw new LoginSubmissionError('invalid_action', `unknown login action: ${value.action.slice(0, 64)}`);
    const values: Record<string, string> = {};
    for (const [key, item] of Object.entries(value.values ?? {})) {
      if (key !== 'input' && (typeof item === 'string' || typeof item === 'number')) values[key] = String(item);
    }
    const rawInput = value.values?.input;
    const text = typeof rawInput === 'string' || typeof rawInput === 'number' ? String(rawInput) : '';
    Object.assign(values, inputValues(text, !!action?.requiresInput));
    return Object.freeze({ actionId: value.action, values: Object.freeze(values) });
  }
  if (typeof value === 'string') {
    if (input) {
      const values = inputValues(value, true);
      return Object.freeze({ actionId: defaultAction(challenge, true), values: Object.freeze(values) });
    }
    return Object.freeze({ actionId: defaultAction(challenge, false), values: Object.freeze({}) });
  }
  // Legacy record (`{ ticket }`, `{ code }`, …).
  const values: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) if (typeof item === 'string') values[key] = item.trim();
  const text = values.ticket ?? values.code ?? values.value ?? values.input;
  if (text) Object.assign(values, inputValues(text, false));
  return Object.freeze({ actionId: defaultAction(challenge, !!input), values: Object.freeze(values) });
}

function resolveTimeoutMs(
  explicit: number | undefined,
  fallback: number,
): number | undefined {
  const raw = explicit === undefined ? fallback : explicit;
  if (!Number.isFinite(raw) || raw <= 0) return undefined;
  return raw;
}

function matchesIdentity(actual: LoginAssistEndpointIdentity | undefined, expected: LoginAssistEndpointIdentity | undefined): boolean {
  return expected === undefined || (actual !== undefined && actual.canonicalId === expected.canonicalId
    && actual.instanceId === expected.instanceId && actual.epoch === expected.epoch && actual.incarnationId === expected.incarnationId);
}
