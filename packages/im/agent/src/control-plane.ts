/**
 * 控制面四开关（ADR 0036 §2，切片 D）：`emergency_stop` / `muted` / `read_only` / `mention_only`。
 *
 * - 两级：**实例默认** + **会话覆盖**（`platform + scene_id`，`scene_id` 与会话画像 `sceneKey` 同口径）。
 *   会话覆盖只能比实例更严：开关只能「再打开」，会话里写 `false` 等于移除覆盖，永远放宽不了实例级开关。
 * - 生效顺序（先命中先返回）：
 *   `emergency_stop → 实例 muted → 会话 muted → read_only → mention_only → 常规 speak / ambient / scene`。
 * - 判定是纯内存读，不依赖审计写成功；持久化读不出来时 **fail closed**（按 `emergency_stop` 处理），
 *   直到重新读成功或运营者成功写入一次。
 * - 写入只经 Console（`control-set`），必须带 `expectedRevision`；**模型没有任何工具能读写这些开关**。
 */
import { getLogger, formatCompact } from '@zhin.js/logger';
import type { DecisionReasonCode } from './decision-events.js';

const logger = getLogger('agent');

export const AI_CONTROL_STATE_TABLE = 'ai_control_state';
/** 单行文档的主键。 */
export const AI_CONTROL_STATE_ROW_ID = 'control';
/** 读库失败后重试的最小间隔。 */
export const CONTROL_STATE_RETRY_MS = 30_000;
/** 会话覆盖条数上限（防止误用把整张表塞满）。 */
export const MAX_CONTROL_SESSION_OVERRIDES = 1_000;

export const CONTROL_SWITCHES = ['emergency_stop', 'muted', 'read_only', 'mention_only'] as const;
export type ControlSwitch = typeof CONTROL_SWITCHES[number];
export type ControlFlags = Readonly<Record<ControlSwitch, boolean>>;
export type ControlFlagsPatch = Readonly<Partial<Record<ControlSwitch, boolean>>>;

/** 表结构：一行 JSON 文档 + revision（乐观并发）。 */
export const AI_CONTROL_STATE_MODEL = {
  id: { type: 'text' as const, primary: true, nullable: false },
  revision: { type: 'bigint' as const, nullable: false, default: 0 },
  state: { type: 'text' as const, default: '{}' },
  updated_at: { type: 'bigint' as const, nullable: true },
  updated_by: { type: 'text' as const, nullable: true },
};

export interface ControlSessionOverride {
  readonly platform: string;
  /** `<scope>:<sceneId>`，与会话画像 `sceneKeyOf` 同口径。 */
  readonly sceneId: string;
  /** 只含被打开的开关。 */
  readonly flags: ControlFlagsPatch;
}

export interface ControlSnapshot {
  readonly revision: number;
  readonly instance: ControlFlags;
  readonly sessions: readonly ControlSessionOverride[];
  readonly updatedAt: number | null;
  readonly updatedBy: string | null;
  /** 是否落库（未接数据库时只在进程内，重启丢失）。 */
  readonly persistent: boolean;
  /** 持久化状态读不出来：全部判定按 `emergency_stop` 处理（fail closed）。 */
  readonly available: boolean;
}

export type ControlLevel = 'instance' | 'session' | 'unavailable';

export type ControlVerdict =
  | Readonly<{ blocked: false }>
  | Readonly<{
      blocked: true;
      switch: ControlSwitch;
      level: ControlLevel;
      reasonCode: Extract<DecisionReasonCode, `control_${string}`>;
      /** 拦截性质：`deny` 为止损类（停 / 禁言 / 只读），`skip` 为 `mention_only` 跳过未点名入口。 */
      outcome: 'deny' | 'skip';
    }>;

export interface ControlGateInput {
  readonly platform: string;
  /** `<scope>:<sceneId>`。 */
  readonly sceneId: string;
  /**
   * 是否被点名：@Bot、命中触发前缀或私聊为 true；旁听、scene event 唤醒、主动出站为 false。
   * 只影响 `mention_only`。
   */
  readonly addressed: boolean;
}

export const CONTROL_OFF: ControlFlags = Object.freeze({
  emergency_stop: false, muted: false, read_only: false, mention_only: false,
});

interface ControlDocument {
  instance: ControlFlags;
  sessions: Map<string, ControlSessionOverride>;
}

export class ControlRevisionConflictError extends Error {
  constructor(readonly currentRevision: number) {
    super(`control revision conflict: current revision is ${currentRevision}`);
    this.name = 'ControlRevisionConflictError';
  }
}

export class ControlUnavailableError extends Error {
  constructor(message = 'control state is unavailable') {
    super(message);
    this.name = 'ControlUnavailableError';
  }
}

export class ControlValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ControlValidationError';
  }
}

function sessionKey(platform: string, sceneId: string): string {
  return `${platform}\u0000${sceneId}`;
}

function onlyOn(flags: ControlFlagsPatch | undefined): ControlFlagsPatch {
  const out: Partial<Record<ControlSwitch, boolean>> = {};
  for (const name of CONTROL_SWITCHES) if (flags?.[name] === true) out[name] = true;
  return Object.freeze(out);
}

function fullFlags(flags: ControlFlagsPatch | undefined): ControlFlags {
  return Object.freeze({
    emergency_stop: flags?.emergency_stop === true,
    muted: flags?.muted === true,
    read_only: flags?.read_only === true,
    mention_only: flags?.mention_only === true,
  });
}

/**
 * 按 ADR 0036 §2 生效顺序判定一次入站（`addressed` 决定 `mention_only`）。
 * 纯函数：只读 `instance` 与该会话的覆盖。
 */
export function evaluateControl(
  instance: ControlFlags,
  session: ControlFlagsPatch | undefined,
  input: Pick<ControlGateInput, 'addressed'>,
): ControlVerdict {
  const s = session ?? {};
  if (instance.emergency_stop) return blocked('emergency_stop', 'instance', 'control_emergency_stop', 'deny');
  if (s.emergency_stop) return blocked('emergency_stop', 'session', 'control_emergency_stop', 'deny');
  if (instance.muted) return blocked('muted', 'instance', 'control_muted_instance', 'deny');
  if (s.muted) return blocked('muted', 'session', 'control_muted_session', 'deny');
  if (instance.read_only) return blocked('read_only', 'instance', 'control_read_only', 'deny');
  if (s.read_only) return blocked('read_only', 'session', 'control_read_only', 'deny');
  if (!input.addressed) {
    if (instance.mention_only) return blocked('mention_only', 'instance', 'control_mention_only', 'skip');
    if (s.mention_only) return blocked('mention_only', 'session', 'control_mention_only', 'skip');
  }
  return ALLOW;
}

const ALLOW: ControlVerdict = Object.freeze({ blocked: false });

function blocked(
  name: ControlSwitch,
  level: ControlLevel,
  reasonCode: Extract<DecisionReasonCode, `control_${string}`>,
  outcome: 'deny' | 'skip',
): ControlVerdict {
  return Object.freeze({ blocked: true, switch: name, level, reasonCode, outcome });
}

const UNAVAILABLE: ControlVerdict = blocked('emergency_stop', 'unavailable', 'control_emergency_stop', 'deny');

/** `ai_control_state` 模型（`@zhin.js/database`）只用到这几个方法。 */
interface ControlStateSelect extends PromiseLike<Record<string, unknown>[]> {
  where(condition: Record<string, unknown>): PromiseLike<Record<string, unknown>[]>;
}
export interface ControlStateModel {
  select(): ControlStateSelect;
  create(row: Record<string, unknown>): Promise<unknown>;
  update(row: Record<string, unknown>): { where(condition: Record<string, unknown>): PromiseLike<unknown> };
}

export interface ControlSetInput {
  readonly expectedRevision: number;
  /** 实例默认：只改给出的开关。 */
  readonly instance?: ControlFlagsPatch;
  /** 会话覆盖：给出的开关覆盖该会话原值；`false` 关闭覆盖（不会放宽实例级）。全部关闭时移除该会话。 */
  readonly sessions?: readonly Readonly<{ platform: string; sceneId: string; flags: ControlFlagsPatch }>[];
  /** 操作者 id（审计 `actor_id`）。 */
  readonly actorId: string;
}

export interface ControlChange {
  /** `instance` 或某个会话。 */
  readonly scope: Readonly<{ level: 'instance' } | { level: 'session'; platform: string; sceneId: string }>;
  readonly before: ControlFlags;
  readonly after: ControlFlags;
}

export interface ControlSetResult {
  readonly snapshot: ControlSnapshot;
  /** 实际变化的范围；没有变化时为空数组（revision 仍然 +1，便于前端确认写入成功）。 */
  readonly changes: readonly ControlChange[];
}

function serializeDocument(doc: ControlDocument): string {
  return JSON.stringify({
    instance: onlyOn(doc.instance),
    sessions: [...doc.sessions.values()].map((entry) => ({ platform: entry.platform, sceneId: entry.sceneId, flags: onlyOn(entry.flags) })),
  });
}

/** 解析持久化文档；结构损坏时抛错（由调用方 fail closed）。 */
export function parseControlDocument(text: unknown): { instance: ControlFlags; sessions: ControlSessionOverride[] } {
  const raw = typeof text === 'string' ? (text ? JSON.parse(text) : {}) : text ?? {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ControlValidationError('control state must be an object');
  const record = raw as { instance?: unknown; sessions?: unknown };
  const instance = fullFlags(isFlagsObject(record.instance) ? record.instance : undefined);
  const sessions: ControlSessionOverride[] = [];
  if (record.sessions !== undefined) {
    if (!Array.isArray(record.sessions)) throw new ControlValidationError('control state sessions must be an array');
    for (const entry of record.sessions) {
      const item = entry as { platform?: unknown; sceneId?: unknown; flags?: unknown };
      if (typeof item?.platform !== 'string' || !item.platform || typeof item.sceneId !== 'string' || !item.sceneId) {
        throw new ControlValidationError('control session override needs platform and sceneId');
      }
      const flags = onlyOn(isFlagsObject(item.flags) ? item.flags : undefined);
      if (Object.keys(flags).length) sessions.push({ platform: item.platform, sceneId: item.sceneId, flags });
    }
  }
  return { instance, sessions };
}

function isFlagsObject(value: unknown): value is ControlFlagsPatch {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function validatePatch(flags: unknown, label: string): ControlFlagsPatch {
  if (!isFlagsObject(flags)) throw new ControlValidationError(`${label} must be an object`);
  const out: Partial<Record<ControlSwitch, boolean>> = {};
  for (const [key, value] of Object.entries(flags)) {
    if (!(CONTROL_SWITCHES as readonly string[]).includes(key)) throw new ControlValidationError(`${label}: unknown switch ${key}`);
    if (typeof value !== 'boolean') throw new ControlValidationError(`${label}.${key} must be a boolean`);
    out[key as ControlSwitch] = value;
  }
  return out;
}

function sameFlags(a: ControlFlags, b: ControlFlags): boolean {
  return CONTROL_SWITCHES.every((name) => a[name] === b[name]);
}

/**
 * 控制面状态（每个 Agent 进程一份）。判定同步、只读内存；写入串行化并先落库再生效。
 */
export class AiControlPlane {
  #doc: ControlDocument = { instance: CONTROL_OFF, sessions: new Map() };
  #revision = 0;
  #updatedAt: number | null = null;
  #updatedBy: string | null = null;
  #model: ControlStateModel | undefined;
  #rowExists = false;
  #available = true;
  #lastLoadAttempt = 0;
  #loading: Promise<boolean> | undefined;
  #writes: Promise<unknown> = Promise.resolve();

  constructor(private readonly now: () => number = Date.now) {}

  get persistent(): boolean {
    return this.#model !== undefined;
  }

  /** 状态可用（未接库，或已从库读出）。不可用时全部判定 fail closed。 */
  get available(): boolean {
    return this.#available;
  }

  /**
   * 接上 `ai_control_state` 并读出持久化状态。读失败**不抛错**：标记不可用（fail closed），
   * 之后的判定 / 读取会按 {@link CONTROL_STATE_RETRY_MS} 间隔重试。
   */
  async upgradeToDatabase(model: ControlStateModel): Promise<boolean> {
    this.#model = model;
    this.#available = false;
    return this.reload();
  }

  /** 从库重新读；未接库时直接成功。同一时间只跑一次。 */
  reload(): Promise<boolean> {
    const model = this.#model;
    if (!model) {
      this.#available = true;
      return Promise.resolve(true);
    }
    if (this.#loading) return this.#loading;
    this.#lastLoadAttempt = this.now();
    this.#loading = (async () => {
      try {
        const rows = await model.select().where({ id: AI_CONTROL_STATE_ROW_ID });
        const row = rows[0];
        if (row) {
          const parsed = parseControlDocument(row.state);
          this.#doc = { instance: parsed.instance, sessions: new Map(parsed.sessions.map((entry) => [sessionKey(entry.platform, entry.sceneId), entry])) };
          this.#revision = Number(row.revision ?? 0) || 0;
          this.#updatedAt = row.updated_at == null ? null : Number(row.updated_at);
          this.#updatedBy = typeof row.updated_by === 'string' ? row.updated_by : null;
          this.#rowExists = true;
        } else {
          this.#rowExists = false;
        }
        this.#available = true;
        return true;
      } catch (error) {
        this.#available = false;
        logger.warn(formatCompact({ op: 'control_state_load_failed', error: error instanceof Error ? error.message : String(error) }));
        return false;
      } finally {
        this.#loading = undefined;
      }
    })();
    return this.#loading;
  }

  #retryIfDue(): void {
    if (this.#available || !this.#model || this.#loading) return;
    if (this.now() - this.#lastLoadAttempt < CONTROL_STATE_RETRY_MS) return;
    void this.reload();
  }

  snapshot(): ControlSnapshot {
    this.#retryIfDue();
    return Object.freeze({
      revision: this.#revision,
      instance: this.#doc.instance,
      sessions: Object.freeze([...this.#doc.sessions.values()]
        .sort((a, b) => a.platform.localeCompare(b.platform) || a.sceneId.localeCompare(b.sceneId))),
      updatedAt: this.#updatedAt,
      updatedBy: this.#updatedBy,
      persistent: this.persistent,
      available: this.#available,
    });
  }

  /** 该会话合并后的有效开关（实例 OR 会话）。 */
  effective(platform: string, sceneId: string): ControlFlags {
    const session = this.#doc.sessions.get(sessionKey(platform, sceneId))?.flags;
    const instance = this.#doc.instance;
    return fullFlags({
      emergency_stop: instance.emergency_stop || session?.emergency_stop === true,
      muted: instance.muted || session?.muted === true,
      read_only: instance.read_only || session?.read_only === true,
      mention_only: instance.mention_only || session?.mention_only === true,
    });
  }

  /** 入站判定（ADR 0036 §2 生效顺序）。状态不可用时按 `emergency_stop` 拒绝。 */
  gate(input: ControlGateInput): ControlVerdict {
    this.#retryIfDue();
    if (!this.#available) return UNAVAILABLE;
    return evaluateControl(this.#doc.instance, this.#doc.sessions.get(sessionKey(input.platform, input.sceneId))?.flags, input);
  }

  /**
   * 出站兜底：回合进行中开关变了也要拦。只看止损类（`emergency_stop` / `muted` / `read_only`），
   * `mention_only` 只管入口，不拦已经进入的回合。
   */
  outboundGate(platform: string, sceneId: string): ControlVerdict {
    return this.gate({ platform, sceneId, addressed: true });
  }

  /** 供危险工具硬闸（切片 E）读：该会话（或缺省时实例）是否处于 `emergency_stop`。不可用时为 true。 */
  isEmergencyStopped(platform?: string, sceneId?: string): boolean {
    this.#retryIfDue();
    if (!this.#available) return true;
    if (this.#doc.instance.emergency_stop) return true;
    if (!platform || !sceneId) return false;
    return this.#doc.sessions.get(sessionKey(platform, sceneId))?.flags.emergency_stop === true;
  }

  /** 供硬闸 / 写类工具读：该会话是否只读（含 `emergency_stop`）。不可用时为 true。 */
  isReadOnly(platform?: string, sceneId?: string): boolean {
    if (this.isEmergencyStopped(platform, sceneId)) return true;
    if (this.#doc.instance.read_only) return true;
    if (!platform || !sceneId) return false;
    return this.#doc.sessions.get(sessionKey(platform, sceneId))?.flags.read_only === true;
  }

  /**
   * 运营者写入（只经 Console）。`expectedRevision` 不符抛 {@link ControlRevisionConflictError}，不覆盖；
   * 先落库、成功后才生效；落库失败抛错，内存保持原值。
   */
  set(input: ControlSetInput): Promise<ControlSetResult> {
    const run = this.#writes.then(() => this.#apply(input));
    this.#writes = run.catch(() => undefined);
    return run;
  }

  async #apply(input: ControlSetInput): Promise<ControlSetResult> {
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
      throw new ControlValidationError('expectedRevision must be a non-negative integer');
    }
    if (typeof input.actorId !== 'string' || !input.actorId.trim()) throw new ControlValidationError('actorId is required');
    const instancePatch = input.instance === undefined ? undefined : validatePatch(input.instance, 'instance');
    const sessionPatches = (input.sessions ?? []).map((entry, index) => {
      if (!entry || typeof entry.platform !== 'string' || !entry.platform.trim() || entry.platform.length > 64) {
        throw new ControlValidationError(`sessions[${index}].platform is required`);
      }
      if (typeof entry.sceneId !== 'string' || !/^(private|group|channel):.+/u.test(entry.sceneId) || entry.sceneId.length > 256) {
        throw new ControlValidationError(`sessions[${index}].sceneId must look like <scope>:<sceneId>`);
      }
      return { platform: entry.platform, sceneId: entry.sceneId, flags: validatePatch(entry.flags, `sessions[${index}].flags`) };
    });
    if (!this.#available) {
      // 读不出旧状态就不能安全地按 revision 合并：先重读一次，仍失败则拒绝写入。
      if (!(await this.reload())) throw new ControlUnavailableError();
    }
    if (input.expectedRevision !== this.#revision) throw new ControlRevisionConflictError(this.#revision);

    const changes: ControlChange[] = [];
    const nextInstance = instancePatch ? fullFlags({ ...this.#doc.instance, ...instancePatch }) : this.#doc.instance;
    if (!sameFlags(nextInstance, this.#doc.instance)) changes.push({ scope: { level: 'instance' }, before: this.#doc.instance, after: nextInstance });
    const nextSessions = new Map(this.#doc.sessions);
    for (const patch of sessionPatches) {
      const key = sessionKey(patch.platform, patch.sceneId);
      const before = fullFlags(nextSessions.get(key)?.flags);
      const after = fullFlags({ ...before, ...patch.flags });
      if (sameFlags(before, after)) continue;
      const on = onlyOn(after);
      if (Object.keys(on).length) nextSessions.set(key, Object.freeze({ platform: patch.platform, sceneId: patch.sceneId, flags: on }));
      else nextSessions.delete(key);
      changes.push({ scope: { level: 'session', platform: patch.platform, sceneId: patch.sceneId }, before, after });
    }
    if (nextSessions.size > MAX_CONTROL_SESSION_OVERRIDES) {
      throw new ControlValidationError(`at most ${MAX_CONTROL_SESSION_OVERRIDES} session overrides`);
    }
    const nextDoc: ControlDocument = { instance: nextInstance, sessions: nextSessions };
    const revision = this.#revision + 1;
    const updatedAt = this.now();
    const model = this.#model;
    if (model) {
      const row = { revision, state: serializeDocument(nextDoc), updated_at: updatedAt, updated_by: input.actorId };
      if (this.#rowExists) {
        await model.update(row).where({ id: AI_CONTROL_STATE_ROW_ID, revision: this.#revision });
      } else {
        await model.create({ id: AI_CONTROL_STATE_ROW_ID, ...row });
        this.#rowExists = true;
      }
    }
    this.#doc = nextDoc;
    this.#revision = revision;
    this.#updatedAt = updatedAt;
    this.#updatedBy = input.actorId;
    this.#available = true;
    return { snapshot: this.snapshot(), changes };
  }
}
