/**
 * 受控自我进化：生效、校验、回滚与回报（ADR 0040 §5 / §6，切片 E1）。
 *
 * 批准（`approved`）后按序：
 * 1. 复核 `content_hash`（逐个暂存文件重算摘要）与 `configPatch.expectedRevision`；不符 → `failed`，不动任何文件。
 * 2. 写回滚快照 `snapshot/`；把 `applying` + 回报目标 + 生效进度**先落盘**，再动手。
 * 3. 暂存文件写入目标路径（同目录临时文件 + rename），应用 `configPatch`。
 * 4. 按影响面：`none` 直接校验；`generation` 调热重载端口（返回需重启时按 `process`）；
 *    `process` 落盘 `verifying` 后请求受控重启（exit 75），由下次启动的 {@link SelfChangeApplier.recover} 接续。
 * 5. 健康检查通过 → `applied`，回报「已生效」；失败 → 用快照回滚**一次**，按同样方式恢复：
 *    恢复健康 → `rolled_back`，回报「失败，已回滚」；仍不健康 → `failed` + 控制面 `emergency_stop`，改投主人私聊，不再自动重启。
 *
 * 宿主能力（文件系统之外的一切：热重载、重启、配置、健康检查、急停、发消息）都经 {@link SelfChangeApplyPorts}
 * 注入；agent 层不依赖 runtime / CLI。所有生产文件写入都在项目根内、重新过一遍路径白名单（防符号链接逃逸）。
 */
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rename, rm, unlink, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import type { DecisionReasonCode } from '../decision-events.js';
import type { HostProtectedPaths } from '../security/host-config-paths.js';
import {
  SelfChangePathError,
  normalizeChangeTarget,
  selfChangeContentHash,
  sha256Hex,
  type SelfChangeConfigOperation,
  type SelfChangeFileEntry,
} from './policy.js';
import type { SelfChangeImpactKind } from './preview.js';
import {
  SelfChangeNotFoundError,
  SelfChangeStateError,
  type SelfChangeApplyState,
  type SelfChangeOrigin,
  type SelfChangeRecord,
  type SelfChangeSnapshot,
  type SelfChangeSnapshotFile,
  type SelfChangeStore,
} from './store.js';

/** 健康检查窗口（§6 默认 60 秒）。 */
export const DEFAULT_CHANGE_HEALTH_WINDOW_MS = 60_000;
/** 一次变更最多为它受控重启的次数：正向一次 + 回滚一次。 */
const MAX_CHANGE_RESTARTS = 2;

/** 根配置文档（字段级补丁 + 整份源文回滚）。 */
export interface SelfChangeConfigPort {
  /** 当前根配置源文与 revision。 */
  read(): Promise<Readonly<{ source: string; revision: string }>>;
  /** 按 `expectedRevision` 应用字段级补丁（同 Console `config:patch`）。 */
  patch(expectedRevision: string, patches: readonly SelfChangeConfigOperation[]): Promise<
    | Readonly<{ status: 'saved'; revision: string; restartRequired: boolean }>
    | Readonly<{ status: 'conflict' | 'invalid'; message: string }>
  >;
  /** 回滚：整份换回快照源文。 */
  restore(source: string, expectedRevision: string): Promise<Readonly<{ revision: string; restartRequired: boolean }>>;
}

export interface SelfChangeHealthInput {
  readonly record: SelfChangeRecord;
  /** 刚经过一次受控重启（启动完成时由 `recover()` 调用）。 */
  readonly restarted: boolean;
  readonly signal: AbortSignal;
}

export type SelfChangeHealth = Readonly<{ ok: true }> | Readonly<{ ok: false; error: string }>;

export type SelfChangeReportKind = 'applied' | 'rolled_back' | 'failed';

export interface SelfChangeReportInput {
  readonly record: SelfChangeRecord;
  readonly kind: SelfChangeReportKind;
  readonly text: string;
  /** 发起会话（或 `reportTarget` 记下的会话）。 */
  readonly target: SelfChangeOrigin;
  /** true：直接投主人私聊（急停时），不进发起会话。 */
  readonly ownerOnly: boolean;
}

/** 回报结果：`redirected` = 发起会话不可达，已改投主人私聊；`blocked` = 被控制面 / session-gate 拦下。 */
export type SelfChangeReportOutcome = 'sent' | 'redirected' | 'blocked' | 'failed';

export interface SelfChangeApplyPorts {
  /** 缺省时带 `configPatch` 的变更一律 `failed`（不动文件）。 */
  readonly config?: SelfChangeConfigPort;
  /**
   * 热重载（`RootRuntime.reload()`，生产 `--no-watch` 也可用）。返回 `restart` 表示这次改动需要重启。
   * 抛错视为生效失败。
   */
  reload(input: { readonly record: SelfChangeRecord; readonly changed: readonly string[] }): Promise<'reloaded' | 'restart'>;
  /** 受控重启（exit 75）；调用前 `verifying` 已落盘。 */
  requestRestart(record: SelfChangeRecord): void | Promise<void>;
  health(input: SelfChangeHealthInput): Promise<SelfChangeHealth>;
  /** 打开控制面实例级 `emergency_stop`（§6）。 */
  emergencyStop(record: SelfChangeRecord, reason: string): Promise<void>;
  report(input: SelfChangeReportInput): Promise<SelfChangeReportOutcome>;
}

export interface SelfChangeApplierOptions {
  readonly store: SelfChangeStore;
  readonly projectRoot: string;
  readonly protectedPaths?: HostProtectedPaths;
  readonly pluginRoots?: readonly string[];
  readonly ports: SelfChangeApplyPorts;
  readonly healthWindowMs?: number;
  readonly onError?: (error: unknown) => void;
}

/** 生效路径结束时的结论。`restarting` = 已请求重启，结论由下次启动的 `recover()` 给出。 */
export type SelfChangeApplyOutcome = 'applied' | 'rolled_back' | 'failed' | 'restarting';

export class SelfChangeApplier {
  readonly #store: SelfChangeStore;
  readonly #projectRoot: string;
  readonly #protectedPaths?: HostProtectedPaths;
  readonly #pluginRoots: readonly string[];
  readonly #ports: SelfChangeApplyPorts;
  readonly #healthWindowMs: number;
  readonly #onError: (error: unknown) => void;
  #tail: Promise<unknown> = Promise.resolve();

  constructor(options: SelfChangeApplierOptions) {
    this.#store = options.store;
    this.#projectRoot = path.resolve(options.projectRoot);
    this.#protectedPaths = options.protectedPaths;
    this.#pluginRoots = Object.freeze([...(options.pluginRoots ?? [])]);
    this.#ports = options.ports;
    this.#healthWindowMs = options.healthWindowMs ?? DEFAULT_CHANGE_HEALTH_WINDOW_MS;
    this.#onError = options.onError ?? (() => undefined);
  }

  /** 生效一个 `approved` 的变更。同一进程内串行（一次只动一个变更）。 */
  apply(id: string): Promise<SelfChangeApplyOutcome> {
    return this.#serialize(() => this.#apply(id));
  }

  /**
   * 每次启动调用：接续 `applying` / `verifying` 的变更（§6 `recover()`）。
   * - `verifying`：刚为它重启过，做健康检查后给结论（正向 → `applied` 或回滚；回滚 → `rolled_back` 或急停）。
   * - `applying`：生效中途进程没了，文件可能只写了一半——按快照回滚后再校验。
   * 返回接续的变更数。
   */
  recover(): Promise<number> {
    return this.#serialize(async () => {
      let count = 0;
      for (const record of await this.#store.list()) {
        if (record.status !== 'applying' && record.status !== 'verifying') continue;
        count += 1;
        try {
          await this.#recoverOne(record);
        } catch (error) {
          this.#onError(error);
        }
      }
      return count;
    });
  }

  async #apply(id: string): Promise<SelfChangeApplyOutcome> {
    const current = await this.#store.get(id);
    if (!current) throw new SelfChangeNotFoundError(id);
    if (current.status !== 'approved') throw new SelfChangeStateError(current.status, 'be applied');

    // 1. 复核：批准绑定的摘要、暂存内容、配置 revision。
    const staged = await this.#readStaged(current);
    const mismatch = verifyStaged(current, staged);
    if (mismatch) return this.#failUntouched(current, 'change_hash_mismatch', mismatch);
    let configRevision: string | null = null;
    let configSource: string | null = null;
    if (current.configPatch) {
      if (!this.#ports.config) return this.#failUntouched(current, 'change_hash_mismatch', 'config patching is unavailable on this host');
      const config = await this.#ports.config.read();
      if (config.revision !== current.configPatch.expectedRevision) {
        return this.#failUntouched(current, 'change_hash_mismatch', 'config changed since the change was drafted');
      }
      configRevision = config.revision;
      configSource = config.source;
    }

    // 2. 快照 + 先落盘。
    const snapshotFiles: SelfChangeSnapshotFile[] = [];
    for (const entry of current.files) {
      snapshotFiles.push({ path: entry.path, content: await this.#readProjectFile(entry.path) });
    }
    await this.#store.writeSnapshot(id, {
      files: snapshotFiles,
      config: configSource !== null && configRevision !== null ? { source: configSource, revision: configRevision } : null,
    });
    let mode = plannedMode(current);
    let record = await this.#store.transition(id, 'applying', {
      actor: 'policy',
      reasonCode: mode === 'none' ? 'change_applied_none' : mode === 'generation' ? 'change_applied_reload' : 'change_restart_requested',
      reportTarget: current.reportTarget ?? reportTargetOf(current.origin),
      apply: { phase: 'forward', mode, restarts: 0, failure: null },
    });

    // 3. 写入。
    try {
      for (const entry of current.files) {
        await this.#writeProjectFile(entry, staged.get(entry.path) ?? null);
      }
      if (current.configPatch && this.#ports.config && configRevision !== null) {
        const result = await this.#ports.config.patch(configRevision, current.configPatch.patches);
        if (result.status !== 'saved') throw new Error(`config patch ${result.status}: ${result.message}`);
        if (result.restartRequired) mode = 'process';
      }
    } catch (error) {
      return this.#rollback(record, `apply failed: ${errorText(error)}`);
    }

    // 4. 按影响面生效。
    if (mode === 'generation') {
      try {
        const reloaded = await this.#ports.reload({ record, changed: current.files.map(file => file.path) });
        if (reloaded === 'restart') mode = 'process';
      } catch (error) {
        return this.#rollback(record, `reload failed: ${errorText(error)}`);
      }
    }
    if (mode === 'process') {
      return this.#restart(record, 'verifying', { phase: 'forward', mode, restarts: 1, failure: null });
    }
    if (record.apply?.mode !== mode) record = await this.#store.setApplyState(id, { phase: 'forward', mode, restarts: 0, failure: null });
    return this.#verifyForward(record, false);
  }

  async #recoverOne(record: SelfChangeRecord): Promise<void> {
    const apply = record.apply ?? { phase: 'forward', mode: 'process', restarts: 1, failure: null };
    if (record.status === 'applying') {
      await this.#rollback(record, apply.phase === 'rollback' ? (apply.failure ?? 'interrupted while rolling back') : 'interrupted while applying');
      return;
    }
    if (apply.phase === 'forward') await this.#verifyForward(record, true);
    else await this.#verifyRollback(record, apply.failure ?? 'apply failed', true);
  }

  async #verifyForward(record: SelfChangeRecord, restarted: boolean): Promise<SelfChangeApplyOutcome> {
    const health = await this.#health(record, restarted);
    if (!health.ok) return this.#rollback(record, `health check failed: ${health.error}`);
    const done = await this.#store.transition(record.id, 'applied', { actor: 'policy', auditPayload: { restarted } });
    await this.#report(done, 'applied', `已生效：${describeChange(done)}${restarted ? '（已重启）' : ''}`);
    return 'applied';
  }

  /** 用快照回滚一次（§6）；回滚后按同样方式恢复，再校验。 */
  async #rollback(record: SelfChangeRecord, failure: string): Promise<SelfChangeApplyOutcome> {
    const snapshot = await this.#store.readSnapshot(record.id).catch(() => null);
    if (!snapshot) return this.#emergency(record, `${failure}; rollback snapshot is missing`);
    const prior = record.apply;
    // 回滚本身也先落盘：进程在回滚中途没了，recover() 会再按快照回滚一次（幂等）。
    let current = record.status === 'applying' || record.status === 'verifying'
      ? await this.#store.setApplyState(record.id, { phase: 'rollback', mode: prior?.mode ?? 'process', restarts: prior?.restarts ?? 0, failure })
      : record;
    let mode = prior?.mode ?? 'process';
    try {
      mode = maxMode(mode, await this.#restoreSnapshot(current, snapshot));
    } catch (error) {
      return this.#emergency(current, `${failure}; rollback failed: ${errorText(error)}`);
    }
    if (mode === 'generation') {
      try {
        const reloaded = await this.#ports.reload({ record: current, changed: current.files.map(file => file.path) });
        if (reloaded === 'restart') mode = 'process';
      } catch (error) {
        return this.#emergency(current, `${failure}; reload after rollback failed: ${errorText(error)}`);
      }
    }
    if (mode === 'process') {
      const restarts = (current.apply?.restarts ?? 0) + 1;
      if (restarts > MAX_CHANGE_RESTARTS) return this.#emergency(current, `${failure}; restart limit reached`);
      return this.#restart(current, current.status === 'verifying' ? null : 'verifying', { phase: 'rollback', mode, restarts, failure });
    }
    if (current.apply?.mode !== mode) current = await this.#store.setApplyState(current.id, { phase: 'rollback', mode, restarts: current.apply?.restarts ?? 0, failure });
    return this.#verifyRollback(current, failure, false);
  }

  async #verifyRollback(record: SelfChangeRecord, failure: string, restarted: boolean): Promise<SelfChangeApplyOutcome> {
    const health = await this.#health(record, restarted);
    if (!health.ok) return this.#emergency(record, `${failure}; still unhealthy after rollback: ${health.error}`);
    const done = await this.#store.transition(record.id, 'rolled_back', { actor: 'policy', error: failure, auditPayload: { restarted } });
    await this.#report(done, 'rolled_back', `失败，已回滚：${describeChange(done)}。原因：${failure}`);
    return 'rolled_back';
  }

  /** 回滚后仍不健康 / 回滚做不了：急停，保留现场，改投主人私聊，不再自动重启。 */
  async #emergency(record: SelfChangeRecord, error: string): Promise<SelfChangeApplyOutcome> {
    const done = await this.#store.transition(record.id, 'failed', { actor: 'policy', error });
    try {
      await this.#ports.emergencyStop(done, error);
    } catch (stopError) {
      this.#onError(stopError);
    }
    await this.#report(done, 'failed', `变更失败，回滚后仍不健康，已急停等待处理：${describeChange(done)}。原因：${error}`, true);
    return 'failed';
  }

  /** 复核不通过：不动任何文件，`failed`（§5.1），回报发起会话；不急停（生产没被改过）。 */
  async #failUntouched(record: SelfChangeRecord, reasonCode: DecisionReasonCode, error: string): Promise<SelfChangeApplyOutcome> {
    const done = await this.#store.transition(record.id, 'failed', { actor: 'policy', reasonCode, error });
    await this.#report(done, 'failed', `变更未生效（未改动任何文件）：${describeChange(done)}。原因：${error}`);
    return 'failed';
  }

  async #restart(record: SelfChangeRecord, to: 'verifying' | null, apply: SelfChangeApplyState): Promise<SelfChangeApplyOutcome> {
    const next = to
      ? await this.#store.transition(record.id, to, { actor: 'policy', apply })
      : await this.#store.setApplyState(record.id, apply);
    await this.#ports.requestRestart(next);
    return 'restarting';
  }

  async #health(record: SelfChangeRecord, restarted: boolean): Promise<SelfChangeHealth> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<SelfChangeHealth>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve({ ok: false, error: `no healthy generation within ${Math.round(this.#healthWindowMs / 1000)}s` });
      }, this.#healthWindowMs);
      timer.unref?.();
    });
    try {
      return await Promise.race([
        this.#ports.health({ record, restarted, signal: controller.signal }).catch((error: unknown) => ({ ok: false as const, error: errorText(error) })),
        timeout,
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async #report(record: SelfChangeRecord, kind: SelfChangeReportKind, text: string, ownerOnly = false): Promise<void> {
    const target = isOrigin(record.reportTarget) ? record.reportTarget : record.origin;
    let outcome: SelfChangeReportOutcome;
    try {
      outcome = await this.#ports.report({ record, kind, text, target, ownerOnly });
    } catch (error) {
      this.#onError(error);
      outcome = 'failed';
    }
    // 回报被拦 / 失败只写审计，不影响变更状态。
    this.#store.audit(record, outcome === 'redirected' ? 'change_report_redirected' : 'change_report_sent', 'policy', { kind, outcome, ownerOnly });
  }

  /** 读全部暂存内容（`write` 条目）；缺失记 `null`。 */
  async #readStaged(record: SelfChangeRecord): Promise<Map<string, string | null>> {
    const out = new Map<string, string | null>();
    for (const entry of record.files) {
      if (entry.op === 'write') out.set(entry.path, await this.#store.readStagedFile(record.id, entry.path));
    }
    return out;
  }

  /** 恢复快照里的文件与配置；返回恢复配置所需的生效方式。 */
  async #restoreSnapshot(record: SelfChangeRecord, snapshot: SelfChangeSnapshot): Promise<SelfChangeImpactKind> {
    for (const file of snapshot.files) {
      await this.#writeProjectFile(
        { path: file.path, op: file.content === null ? 'delete' : 'write', sha256: null, bytes: 0 },
        file.content,
      );
    }
    if (!snapshot.config || !record.configPatch || !this.#ports.config) return 'none';
    const current = await this.#ports.config.read();
    if (current.source === snapshot.config.source) return 'none';
    const restored = await this.#ports.config.restore(snapshot.config.source, current.revision);
    return restored.restartRequired ? 'process' : 'generation';
  }

  /** 读项目里一个目标文件的当前内容；不存在返回 `null`。 */
  async #readProjectFile(target: string): Promise<string | null> {
    const absolute = await this.#resolveTarget(target);
    try {
      const stat = await lstat(absolute);
      if (!stat.isFile()) throw new SelfChangePathError(target, 'not a regular file');
      return await readFile(absolute, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  /** 写 / 删一个目标文件（同目录临时文件 + rename）；每次都重新过一遍路径白名单。 */
  async #writeProjectFile(entry: SelfChangeFileEntry, content: string | null): Promise<void> {
    const absolute = await this.#resolveTarget(entry.path);
    if (entry.op === 'delete' || content === null) {
      await unlink(absolute).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
      return;
    }
    await mkdir(path.dirname(absolute), { recursive: true });
    await this.#assertInsideProject(path.dirname(absolute), entry.path);
    const tmp = path.join(path.dirname(absolute), `.${path.basename(absolute)}.${randomUUID()}.tmp`);
    try {
      await writeFile(tmp, content, 'utf8');
      await rename(tmp, absolute);
    } catch (error) {
      await rm(tmp, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async #resolveTarget(target: string): Promise<string> {
    const rel = normalizeChangeTarget(target, { projectRoot: this.#projectRoot, protectedPaths: this.#protectedPaths, pluginRoots: this.#pluginRoots });
    const absolute = path.join(this.#projectRoot, ...rel.split('/'));
    // 已存在的目标若是符号链接，拒绝跟随。
    try {
      if ((await lstat(absolute)).isSymbolicLink()) throw new SelfChangePathError(target, 'symbolic link');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return absolute;
  }

  /** 目标所在目录解析后仍在项目根内（父目录是指向外面的符号链接时拒绝）。 */
  async #assertInsideProject(dir: string, target: string): Promise<void> {
    const root = await realpath(this.#projectRoot);
    const resolved = await realpath(dir);
    if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) throw new SelfChangePathError(target, 'escapes the project root');
  }

  #serialize<T>(task: () => Promise<T>): Promise<T> {
    const run = this.#tail.then(task, task);
    this.#tail = run.catch(() => undefined);
    return run;
  }
}

/** 暂存内容与批准时绑定的摘要是否一致；不一致返回原因。 */
function verifyStaged(record: SelfChangeRecord, staged: ReadonlyMap<string, string | null>): string | null {
  if (record.approvedHash !== record.contentHash) return 'approval is not bound to the current content';
  if (selfChangeContentHash(record.files, record.configPatch) !== record.contentHash) return 'change metadata does not match its content hash';
  for (const entry of record.files) {
    if (entry.op !== 'write') continue;
    const content = staged.get(entry.path);
    if (content === null || content === undefined) return `staged file ${entry.path} is missing`;
    if (sha256Hex(content) !== entry.sha256) return `staged file ${entry.path} changed after approval`;
  }
  return null;
}

/** 预览里的影响面；没有预览或估计不准时保守按重启。 */
function plannedMode(record: SelfChangeRecord): SelfChangeImpactKind {
  const impact = (record.plan as { impact?: { kind?: unknown } } | null)?.impact;
  const kind = impact?.kind;
  return kind === 'none' || kind === 'generation' || kind === 'process' ? kind : 'process';
}

const MODE_RANK: Readonly<Record<SelfChangeImpactKind, number>> = { none: 0, generation: 1, process: 2 };

function maxMode(left: SelfChangeImpactKind, right: SelfChangeImpactKind): SelfChangeImpactKind {
  return MODE_RANK[left] >= MODE_RANK[right] ? left : right;
}

function reportTargetOf(origin: SelfChangeOrigin): SelfChangeOrigin {
  return Object.freeze({ platform: origin.platform, sceneId: origin.sceneId, userId: origin.userId, endpoint: origin.endpoint ?? null });
}

function isOrigin(value: unknown): value is SelfChangeOrigin {
  const candidate = value as Partial<SelfChangeOrigin> | null;
  return Boolean(candidate) && typeof candidate?.platform === 'string' && typeof candidate.sceneId === 'string' && typeof candidate.userId === 'string';
}

/** 回报里的变更摘要：预览 summary，否则文件 / 配置路径。不含正文与配置值。 */
function describeChange(record: SelfChangeRecord): string {
  const summary = (record.plan as { summary?: unknown } | null)?.summary;
  if (typeof summary === 'string' && summary.trim()) return summary.trim();
  const parts = [
    ...record.files.map(file => `${file.op === 'delete' ? '删除' : '写入'} ${file.path}`),
    ...(record.configPatch?.patches.map(patch => `配置 ${patch.path.join('.')}`) ?? []),
  ];
  return parts.slice(0, 5).join('、') + (parts.length > 5 ? ` 等 ${parts.length} 项` : '');
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
