/**
 * 受控自我进化：变更暂存区 `.zhin/changes/<id>/`（ADR 0040 §1 / §6a / §7，切片 A）。
 *
 * - `change.json`：元数据（不含文件正文）；`files/<目标路径>`：草稿内容；`snapshot/<目标路径>`：回滚快照（切片 E 写入）。
 * - 状态只前进（见 `policy.ts`），每次迁移先原子落盘 `change.json`，再写一行 `kind=self_change` 审计；
 *   审计写失败不影响迁移。
 * - 磁盘有界（§6a）：
 *   - 进入终态立即删 `files/` 与 `snapshot/`，只留 `change.json`；`failed`（已急停）保留现场直到人标记已处理。
 *   - 终态 `change.json` 保留 14 天后删除整个目录；`draft` / `ready` / `pending` 闲置 24 小时 → `expired`。
 *   - 单变更 ≤ 5 MB / 50 文件，总量 ≤ 50 MB；超限在写入**之前**拒绝（`change_quota_exceeded`）。
 *   - 清理在 {@link SelfChangeStore.startPruning} 启动时扫一次、之后每 6 小时一次；只删暂存区内、
 *     状态与时间都满足条件的目录，删除前用 realpath 校验仍在暂存区内，不跟随符号链接。
 */
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, realpath, rename, rm, unlink, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { createToken } from '@zhin.js/plugin-runtime';
import type { DecisionActor, DecisionEventInput, DecisionReasonCode } from '../decision-events.js';
import type { HostProtectedPaths } from '../security/host-config-paths.js';
import {
  DEFAULT_CHANGE_IDLE_TTL_MS,
  DEFAULT_CHANGE_PRUNE_INTERVAL_MS,
  DEFAULT_CHANGE_RETENTION_MS,
  MAX_CHANGE_BYTES,
  MAX_CHANGE_FILES,
  MAX_CHANGES_TOTAL_BYTES,
  SELF_CHANGE_DEFAULT_REASON,
  SelfChangeConfigKeyError,
  SelfChangePathError,
  SelfChangeValidationError,
  canTransitionSelfChange,
  canonicalJson,
  clipChangeError,
  isSelfChangeStatus,
  isSelfChangeTerminal,
  normalizeChangeConfigPatch,
  normalizeChangeTarget,
  selfChangeContentHash,
  selfChangeOutcome,
  sha256Hex,
  type SelfChangeConfigPatch,
  type SelfChangeFileEntry,
  type SelfChangeStatus,
} from './policy.js';

const CHANGE_FILE = 'change.json';
const FILES_DIR = 'files';
const SNAPSHOT_DIR = 'snapshot';
const CHANGE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const RECORD_VERSION = 1;

/** 发起变更的会话（审计口径，与决策审计 `platform + scene_id` 一致）。 */
export interface SelfChangeOrigin {
  readonly platform: string;
  /** `<scope>:<sceneId>`，与会话画像 `sceneKey` 同口径。 */
  readonly sceneId: string;
  /** 发起人。只有发起人能改自己的草稿。 */
  readonly userId: string;
  /** Bot 账号（endpoint）；审计 `instance_id` 取它，缺省回落平台名。 */
  readonly endpoint?: string | null;
}

export interface SelfChangeRecord {
  readonly version: typeof RECORD_VERSION;
  readonly id: string;
  readonly status: SelfChangeStatus;
  readonly contentHash: string;
  readonly files: readonly SelfChangeFileEntry[];
  readonly configPatch: SelfChangeConfigPatch | null;
  /** 暂存内容总字节（文件 + 配置补丁），配额口径。 */
  readonly bytes: number;
  /** 预览与影响面（切片 B 写入，见 `preview.ts` 的 `SelfChangePreview`）。 */
  readonly plan: unknown;
  /** 试跑结果（切片 C 写入）。 */
  readonly trial: unknown;
  /** 回报目标（切片 E 在生效前写入）。 */
  readonly reportTarget: unknown;
  readonly origin: SelfChangeOrigin;
  readonly approvedBy: string | null;
  readonly approvedHash: string | null;
  readonly error: string | null;
  readonly revision: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly submittedAt: number | null;
  /** 进入终态的时间；保留期从这里算。 */
  readonly terminalAt: number | null;
  /** `failed` 被人标记已处理的时间（之后才瘦身、计保留期）。 */
  readonly resolvedAt: number | null;
  /** `files/` 与 `snapshot/` 是否已删除。 */
  readonly slimmed: boolean;
}

export interface SelfChangeDraftFile {
  readonly path: string;
  /** 新内容（UTF-8）；`delete: true` 时省略。 */
  readonly content?: string;
  readonly delete?: boolean;
}

export interface SelfChangeDraftInput {
  /** 省略 = 新建；给出 = 更新自己发起的 `draft`。 */
  readonly id?: string;
  readonly origin: SelfChangeOrigin;
  readonly files?: readonly SelfChangeDraftFile[];
  readonly configPatch?: unknown;
  readonly actor?: DecisionActor;
  readonly turnId?: string;
}

export interface SelfChangeTransitionInput {
  readonly actor: DecisionActor;
  readonly actorId?: string | null;
  /** 缺省按目标状态取默认码；`trialing` / `applying` 必须给。 */
  readonly reasonCode?: DecisionReasonCode;
  readonly error?: string | null;
  readonly approvedBy?: string | null;
  readonly plan?: unknown;
  readonly trial?: unknown;
  readonly reportTarget?: unknown;
  readonly turnId?: string;
  /** 额外审计字段（不得含文件正文或配置值）。 */
  readonly auditPayload?: Readonly<Record<string, unknown>>;
}

export interface SelfChangeAuditSink {
  record(input: DecisionEventInput): unknown;
}

export interface SelfChangeStoreOptions {
  /** 暂存区目录，通常是 `<projectRoot>/.zhin/changes`。 */
  readonly root: string;
  readonly projectRoot: string;
  readonly protectedPaths?: HostProtectedPaths;
  /** 额外的本地插件根（相对项目根）。 */
  readonly pluginRoots?: readonly string[];
  readonly audit?: () => SelfChangeAuditSink | undefined;
  readonly now?: () => number;
  readonly retentionMs?: number;
  readonly idleTtlMs?: number;
  readonly maxChangeBytes?: number;
  readonly maxChangeFiles?: number;
  readonly maxTotalBytes?: number;
  readonly onError?: (error: unknown) => void;
}

export interface SelfChangePruneResult {
  readonly expired: readonly string[];
  readonly slimmed: readonly string[];
  readonly removed: readonly string[];
  readonly totalBytes: number;
}

export class SelfChangeNotFoundError extends Error {
  readonly id: string;
  constructor(id: string) {
    super(`change ${id} not found`);
    this.id = id;
    this.name = 'SelfChangeNotFoundError';
  }
}

export class SelfChangeStateError extends Error {
  readonly status: SelfChangeStatus;
  readonly action: string;
  constructor(status: SelfChangeStatus, action: string) {
    super(`change in status ${status} cannot ${action}`);
    this.status = status;
    this.action = action;
    this.name = 'SelfChangeStateError';
  }
}

export class SelfChangeQuotaError extends Error {
  readonly limit: 'files' | 'change_bytes' | 'total_bytes';
  constructor(limit: 'files' | 'change_bytes' | 'total_bytes', message: string) {
    super(message);
    this.limit = limit;
    this.name = 'SelfChangeQuotaError';
  }
}

/** 宿主在 generation 资源作用域上提供的暂存区（切片 B 起由 `change_draft` 等使用）。 */
export const selfChangeStoreToken = createToken<SelfChangeStore>('zhin.agent.self-change-store');

export class SelfChangeStore {
  readonly root: string;
  readonly #projectRoot: string;
  readonly #protectedPaths?: HostProtectedPaths;
  readonly #pluginRoots: readonly string[];
  readonly #audit: () => SelfChangeAuditSink | undefined;
  readonly #now: () => number;
  readonly #retentionMs: number;
  readonly #idleTtlMs: number;
  readonly #maxChangeBytes: number;
  readonly #maxChangeFiles: number;
  readonly #maxTotalBytes: number;
  readonly #onError: (error: unknown) => void;
  #tail: Promise<unknown> = Promise.resolve();

  constructor(options: SelfChangeStoreOptions) {
    this.root = path.resolve(options.root);
    this.#projectRoot = path.resolve(options.projectRoot);
    this.#protectedPaths = options.protectedPaths;
    this.#pluginRoots = Object.freeze([...(options.pluginRoots ?? [])]);
    this.#audit = options.audit ?? (() => undefined);
    this.#now = options.now ?? Date.now;
    this.#retentionMs = options.retentionMs ?? DEFAULT_CHANGE_RETENTION_MS;
    this.#idleTtlMs = options.idleTtlMs ?? DEFAULT_CHANGE_IDLE_TTL_MS;
    this.#maxChangeBytes = options.maxChangeBytes ?? MAX_CHANGE_BYTES;
    this.#maxChangeFiles = options.maxChangeFiles ?? MAX_CHANGE_FILES;
    this.#maxTotalBytes = options.maxTotalBytes ?? MAX_CHANGES_TOTAL_BYTES;
    this.#onError = options.onError ?? (() => undefined);
  }

  /**
   * 新建或更新草稿。路径、配置键、配额都在写盘**之前**校验；不通过时写一行拒绝审计并抛错，
   * 不留下任何文件。
   */
  draft(input: SelfChangeDraftInput): Promise<SelfChangeRecord> {
    return this.#serialize(async () => {
      const actor = input.actor ?? 'model';
      const origin = normalizeOrigin(input.origin);
      const existing = input.id === undefined ? null : await this.#loadOrThrow(input.id);
      if (existing) {
        if (existing.status !== 'draft') throw new SelfChangeStateError(existing.status, 'be edited');
        if (existing.origin.userId !== origin.userId) throw new SelfChangeStateError(existing.status, 'be edited by another user');
      }
      const reject = (code: DecisionReasonCode, error: Error, payload: Record<string, unknown>): never => {
        this.#emit({ origin, changeId: existing?.id ?? null, code, actor, actorId: origin.userId, turnId: input.turnId, detail: error.message, payload });
        throw error;
      };
      const rawFiles = input.files ?? [];
      if (!Array.isArray(rawFiles)) throw new SelfChangeValidationError('files must be an array');
      if (rawFiles.length > this.#maxChangeFiles) {
        reject('change_quota_exceeded', new SelfChangeQuotaError('files', `a change may hold at most ${this.#maxChangeFiles} files`), { files: rawFiles.length, limit: this.#maxChangeFiles });
      }
      const staged: { entry: SelfChangeFileEntry; content: string | null }[] = [];
      const seen = new Set<string>();
      for (const file of rawFiles) {
        let target: string;
        try {
          target = normalizeChangeTarget(file?.path, { projectRoot: this.#projectRoot, protectedPaths: this.#protectedPaths, pluginRoots: this.#pluginRoots });
        } catch (error) {
          if (error instanceof SelfChangePathError) reject('change_path_forbidden', error, { path: String(file?.path ?? '').slice(0, 200) });
          throw error;
        }
        const key = target.toLowerCase();
        if (seen.has(key)) throw new SelfChangeValidationError(`duplicate change target ${target}`);
        seen.add(key);
        if (file.delete === true) {
          if (file.content !== undefined) throw new SelfChangeValidationError(`${target}: delete must not carry content`);
          staged.push({ entry: Object.freeze({ path: target, op: 'delete', sha256: null, bytes: 0 }), content: null });
          continue;
        }
        if (typeof file.content !== 'string') throw new SelfChangeValidationError(`${target}: content must be a string`);
        const bytes = Buffer.byteLength(file.content, 'utf8');
        staged.push({ entry: Object.freeze({ path: target, op: 'write', sha256: sha256Hex(file.content), bytes }), content: file.content });
      }
      let configPatch: SelfChangeConfigPatch | null = null;
      if (input.configPatch !== undefined && input.configPatch !== null) {
        try {
          configPatch = normalizeChangeConfigPatch(input.configPatch);
        } catch (error) {
          if (error instanceof SelfChangeConfigKeyError) reject('change_config_key_forbidden', error, { key: error.key });
          throw error;
        }
      }
      if (staged.length === 0 && !configPatch) throw new SelfChangeValidationError('a change needs at least one file or a configPatch');
      const bytes = staged.reduce((sum, item) => sum + item.entry.bytes, 0)
        + (configPatch ? Buffer.byteLength(canonicalJson(configPatch), 'utf8') : 0);
      if (bytes > this.#maxChangeBytes) {
        reject('change_quota_exceeded', new SelfChangeQuotaError('change_bytes', `a change may stage at most ${this.#maxChangeBytes} bytes`), { bytes, limit: this.#maxChangeBytes });
      }
      let total = await this.#totalBytes();
      const ownBytes = existing ? await dirBytes(this.#dirFor(existing.id)) : 0;
      if (total - ownBytes + bytes > this.#maxTotalBytes) {
        // 先按规则清一次再判，避免过期垃圾挤掉正常草稿。
        await this.#pruneUnlocked();
        total = await this.#totalBytes();
      }
      if (total - ownBytes + bytes > this.#maxTotalBytes) {
        reject('change_quota_exceeded', new SelfChangeQuotaError('total_bytes', `the change staging area may hold at most ${this.#maxTotalBytes} bytes`), { bytes, totalBytes: total - ownBytes, limit: this.#maxTotalBytes });
      }

      const now = this.#now();
      const id = existing?.id ?? randomUUID();
      const dir = this.#dirFor(id);
      await mkdir(dir, { recursive: true });
      // 新内容先写进旁边的临时目录，再整体换上，避免半份草稿。
      const next = path.join(dir, `${FILES_DIR}.next-${randomUUID()}`);
      try {
        for (const item of staged) {
          if (item.content === null) continue;
          const target = path.join(next, ...item.entry.path.split('/'));
          await mkdir(path.dirname(target), { recursive: true });
          await writeFile(target, item.content, 'utf8');
        }
        await rm(path.join(dir, FILES_DIR), { recursive: true, force: true });
        await mkdir(next, { recursive: true });
        await rename(next, path.join(dir, FILES_DIR));
      } catch (error) {
        await rm(next, { recursive: true, force: true }).catch(() => undefined);
        if (!existing) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
        throw error;
      }
      const files = Object.freeze(staged.map(item => item.entry));
      const record: SelfChangeRecord = Object.freeze({
        version: RECORD_VERSION,
        id,
        status: 'draft',
        contentHash: selfChangeContentHash(files, configPatch),
        files,
        configPatch,
        bytes,
        plan: null,
        trial: null,
        reportTarget: null,
        origin,
        approvedBy: null,
        approvedHash: null,
        error: null,
        revision: (existing?.revision ?? -1) + 1,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        submittedAt: null,
        terminalAt: null,
        resolvedAt: null,
        slimmed: false,
      });
      await this.#save(record);
      this.#emit({ origin, changeId: id, code: 'change_drafted', actor, actorId: origin.userId, turnId: input.turnId, payload: transitionPayload(record, existing?.status ?? null) });
      return record;
    });
  }

  /** 项目根（绝对路径），预览据此读现有文件。 */
  get projectRoot(): string {
    return this.#projectRoot;
  }

  /**
   * 把宿主生成的预览（§2，切片 B）挂到自己的 `draft` 上。`contentHash` 必须与当前草稿一致——
   * 草稿在生成预览期间被改过时拒绝，避免旧预览配新内容。改草稿（`draft()`）会清掉旧预览。
   */
  attachPlan(id: string, contentHash: string, plan: unknown): Promise<SelfChangeRecord> {
    return this.#serialize(async () => {
      const current = await this.#loadOrThrow(id);
      if (current.status !== 'draft') throw new SelfChangeStateError(current.status, 'take a preview');
      if (current.contentHash !== contentHash) throw new SelfChangeValidationError(`change ${id} changed while its preview was built`);
      const record: SelfChangeRecord = Object.freeze({ ...current, plan, revision: current.revision + 1, updatedAt: this.#now() });
      await this.#save(record);
      return record;
    });
  }

  get(id: string): Promise<SelfChangeRecord | null> {
    return this.#load(id);
  }

  /** 全部变更（不读正文），按创建时间倒序。 */
  async list(): Promise<readonly SelfChangeRecord[]> {
    const out: SelfChangeRecord[] = [];
    for (const id of await this.#ids()) {
      const record = await this.#load(id);
      if (record) out.push(record);
    }
    return out.sort((a, b) => b.createdAt - a.createdAt);
  }

  /** 读一个暂存文件的内容（瘦身后或 `delete` 条目返回 `null`）。 */
  async readStagedFile(id: string, target: string): Promise<string | null> {
    const record = await this.#loadOrThrow(id);
    const entry = record.files.find(file => file.path === target);
    if (!entry || entry.op !== 'write' || record.slimmed) return null;
    try {
      return await readFile(path.join(this.#dirFor(id), FILES_DIR, ...entry.path.split('/')), 'utf8');
    } catch {
      return null;
    }
  }

  /** 状态迁移；进入终态（`failed` 除外）立即瘦身。 */
  transition(id: string, to: SelfChangeStatus, input: SelfChangeTransitionInput): Promise<SelfChangeRecord> {
    return this.#serialize(() => this.#transitionUnlocked(id, to, input));
  }

  /** 人处理完 `failed` 现场后调用：之后瘦身并开始计保留期。 */
  markFailedHandled(id: string, actorId: string): Promise<SelfChangeRecord> {
    return this.#serialize(async () => {
      const current = await this.#loadOrThrow(id);
      if (current.status !== 'failed') throw new SelfChangeStateError(current.status, 'be marked handled');
      if (current.resolvedAt !== null) return current;
      const now = this.#now();
      const record = Object.freeze({ ...current, resolvedAt: now, terminalAt: now, updatedAt: now, revision: current.revision + 1 });
      await this.#save(record);
      return this.#slim(record, actorId);
    });
  }

  /** 暂存区当前占用（字节，不跟随符号链接）。 */
  usage(): Promise<number> {
    return this.#totalBytes();
  }

  /** 按 §6a 清理一次。 */
  prune(): Promise<SelfChangePruneResult> {
    return this.#serialize(() => this.#pruneUnlocked());
  }

  /** 立即清理一次，之后每 `intervalMs` 一次；返回停止函数。清理出错只上报，不抛。 */
  startPruning(intervalMs: number = DEFAULT_CHANGE_PRUNE_INTERVAL_MS): () => void {
    const run = () => { this.prune().catch(error => this.#onError(error)); };
    run();
    const timer = setInterval(run, intervalMs);
    timer.unref?.();
    return () => clearInterval(timer);
  }

  async #transitionUnlocked(id: string, to: SelfChangeStatus, input: SelfChangeTransitionInput): Promise<SelfChangeRecord> {
    const current = await this.#loadOrThrow(id);
    if (!canTransitionSelfChange(current.status, to) || to === 'draft') throw new SelfChangeStateError(current.status, `move to ${to}`);
    const reasonCode = input.reasonCode ?? SELF_CHANGE_DEFAULT_REASON[to];
    if (!reasonCode) throw new SelfChangeValidationError(`transition to ${to} needs an explicit reasonCode`);
    const now = this.#now();
    const terminal = isSelfChangeTerminal(to);
    const record: SelfChangeRecord = Object.freeze({
      ...current,
      status: to,
      revision: current.revision + 1,
      updatedAt: now,
      ...(to === 'pending' ? { submittedAt: now } : {}),
      ...(to === 'approved' ? { approvedBy: input.approvedBy ?? input.actorId ?? null, approvedHash: current.contentHash } : {}),
      ...(input.plan !== undefined ? { plan: input.plan } : {}),
      ...(input.trial !== undefined ? { trial: input.trial } : {}),
      ...(input.reportTarget !== undefined ? { reportTarget: input.reportTarget } : {}),
      ...(input.error !== undefined ? { error: input.error === null ? null : clipChangeError(input.error) } : {}),
      // `failed` 的保留期从人标记已处理时开始算。
      ...(terminal && to !== 'failed' ? { terminalAt: now } : {}),
    });
    await this.#save(record);
    this.#emit({
      origin: record.origin,
      changeId: id,
      code: reasonCode,
      actor: input.actor,
      actorId: input.actorId ?? null,
      turnId: input.turnId,
      detail: record.error && (terminal || to === 'failed') ? record.error : undefined,
      payload: { ...transitionPayload(record, current.status), ...(input.auditPayload ?? {}) },
    });
    return terminal && to !== 'failed' ? this.#slim(record) : record;
  }

  async #pruneUnlocked(): Promise<SelfChangePruneResult> {
    const expired: string[] = [];
    const slimmed: string[] = [];
    const removed: string[] = [];
    const now = this.#now();
    let entries: string[];
    try {
      entries = await readdir(this.root);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return Object.freeze({ expired, slimmed, removed, totalBytes: 0 });
      throw error;
    }
    for (const name of entries) {
      const entry = path.join(this.root, name);
      let stat;
      try { stat = await lstat(entry); } catch { continue; }
      if (!stat.isDirectory() || !CHANGE_ID.test(name)) {
        // 暂存区只该有变更目录；其他东西（含符号链接本身）在闲置时限后删掉，不跟随链接。
        if (now - stat.mtimeMs > this.#idleTtlMs && await this.#insideRoot(entry, stat.isSymbolicLink())) {
          if (stat.isDirectory()) await rm(entry, { recursive: true, force: true });
          else await unlink(entry);
          removed.push(name);
        }
        continue;
      }
      let record = await this.#load(name);
      if (!record) {
        if (now - stat.mtimeMs > this.#idleTtlMs && await this.#insideRoot(entry, false)) {
          await rm(entry, { recursive: true, force: true });
          removed.push(name);
        }
        continue;
      }
      try {
        const idleSince = record.status === 'pending' ? (record.submittedAt ?? record.updatedAt) : record.updatedAt;
        if ((record.status === 'draft' || record.status === 'ready' || record.status === 'pending') && now - idleSince > this.#idleTtlMs) {
          record = await this.#transitionUnlocked(record.id, 'expired', { actor: 'policy', error: 'idle timeout' });
          expired.push(record.id);
        } else if (record.status === 'trialing' && now - record.updatedAt > this.#idleTtlMs) {
          // 试跑中途进程退出：试跑临时目录在系统临时目录，这里只收尾记录。
          record = await this.#transitionUnlocked(record.id, 'trial_failed', { actor: 'policy', error: 'trial interrupted' });
          expired.push(record.id);
        }
        const done = isSelfChangeTerminal(record.status) && (record.status !== 'failed' || record.resolvedAt !== null);
        if (!done) continue;
        if (!record.slimmed) {
          record = await this.#slim(record);
          slimmed.push(record.id);
        }
        if (record.terminalAt !== null && now - record.terminalAt > this.#retentionMs && await this.#insideRoot(entry, false)) {
          await rm(entry, { recursive: true, force: true });
          removed.push(record.id);
          this.#emit({ origin: record.origin, changeId: record.id, code: 'change_pruned', actor: 'policy', payload: { changeId: record.id, status: record.status, terminalAt: record.terminalAt } });
        }
      } catch (error) {
        this.#onError(error);
      }
    }
    return Object.freeze({ expired, slimmed, removed, totalBytes: await this.#totalBytes() });
  }

  async #slim(record: SelfChangeRecord, actorId?: string): Promise<SelfChangeRecord> {
    const dir = this.#dirFor(record.id);
    if (await this.#insideRoot(dir, false)) {
      await rm(path.join(dir, FILES_DIR), { recursive: true, force: true });
      await rm(path.join(dir, SNAPSHOT_DIR), { recursive: true, force: true });
    }
    const next = Object.freeze({ ...record, slimmed: true });
    await this.#save(next);
    if (actorId) {
      this.#emit({ origin: record.origin, changeId: record.id, code: 'change_pruned', actor: 'operator', actorId, payload: { changeId: record.id, status: record.status, slimmed: true } });
    }
    return next;
  }

  /** `entry` 解析后是否仍在暂存区内；`isLink` 时只校验链接本身所在目录。 */
  async #insideRoot(entry: string, isLink: boolean): Promise<boolean> {
    try {
      const root = await realpath(this.root);
      const resolved = isLink ? path.join(await realpath(path.dirname(entry)), path.basename(entry)) : await realpath(entry);
      return resolved.startsWith(`${root}${path.sep}`);
    } catch {
      return false;
    }
  }

  #dirFor(id: string): string {
    if (!CHANGE_ID.test(id)) throw new SelfChangeValidationError(`invalid change id ${JSON.stringify(id)}`);
    return path.join(this.root, id);
  }

  async #ids(): Promise<string[]> {
    try {
      return (await readdir(this.root)).filter(name => CHANGE_ID.test(name));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }

  async #load(id: string): Promise<SelfChangeRecord | null> {
    if (!CHANGE_ID.test(id)) return null;
    let raw: string;
    try {
      const file = path.join(this.root, id, CHANGE_FILE);
      if (!(await lstat(file)).isFile()) return null;
      raw = await readFile(file, 'utf8');
    } catch {
      return null;
    }
    try {
      const parsed = JSON.parse(raw) as SelfChangeRecord;
      if (parsed?.version !== RECORD_VERSION || parsed.id !== id || !isSelfChangeStatus(parsed.status)) return null;
      return Object.freeze(parsed);
    } catch {
      return null;
    }
  }

  async #loadOrThrow(id: string): Promise<SelfChangeRecord> {
    const record = await this.#load(id);
    if (!record) throw new SelfChangeNotFoundError(id);
    return record;
  }

  /** 原子写 `change.json`（同目录临时文件 + rename）。 */
  async #save(record: SelfChangeRecord): Promise<void> {
    const dir = this.#dirFor(record.id);
    await mkdir(dir, { recursive: true });
    const tmp = path.join(dir, `.${CHANGE_FILE}.${randomUUID()}.tmp`);
    try {
      await writeFile(tmp, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
      await rename(tmp, path.join(dir, CHANGE_FILE));
    } catch (error) {
      await rm(tmp, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  #totalBytes(): Promise<number> {
    return dirBytes(this.root);
  }

  #serialize<T>(task: () => Promise<T>): Promise<T> {
    const run = this.#tail.then(task, task);
    this.#tail = run.catch(() => undefined);
    return run;
  }

  #emit(event: {
    origin: SelfChangeOrigin;
    changeId: string | null;
    code: DecisionReasonCode;
    actor: DecisionActor;
    actorId?: string | null;
    turnId?: string;
    detail?: string;
    payload: Record<string, unknown>;
  }): void {
    let sink: SelfChangeAuditSink | undefined;
    try { sink = this.#audit(); } catch { sink = undefined; }
    if (!sink) return;
    try {
      const result = sink.record({
        turnId: event.turnId ?? randomUUID(),
        instanceId: event.origin.endpoint || event.origin.platform,
        platform: event.origin.platform,
        sceneId: event.origin.sceneId,
        userId: event.origin.userId,
        kind: 'self_change',
        outcome: selfChangeOutcome(event.code),
        reasonCode: event.code,
        ...(event.detail ? { reasonDetail: event.detail } : {}),
        payload: { ...(event.changeId ? { changeId: event.changeId } : {}), ...event.payload },
        actor: event.actor,
        ...(event.actorId ? { actorId: event.actorId } : {}),
      });
      if (result && typeof (result as Promise<unknown>).catch === 'function') (result as Promise<unknown>).catch(() => undefined);
    } catch {
      // 审计不是门禁。
    }
  }
}

function normalizeOrigin(origin: SelfChangeOrigin): SelfChangeOrigin {
  const platform = typeof origin?.platform === 'string' ? origin.platform.trim() : '';
  const sceneId = typeof origin?.sceneId === 'string' ? origin.sceneId.trim() : '';
  const userId = typeof origin?.userId === 'string' ? origin.userId.trim() : '';
  if (!platform || !sceneId || !userId) throw new SelfChangeValidationError('origin.platform, origin.sceneId and origin.userId are required');
  const endpoint = typeof origin.endpoint === 'string' && origin.endpoint.trim() ? origin.endpoint.trim() : null;
  return Object.freeze({ platform, sceneId, userId, endpoint });
}

/** 审计 payload：路径与摘要，不含正文与配置值（§7）。 */
function transitionPayload(record: SelfChangeRecord, from: SelfChangeStatus | null): Record<string, unknown> {
  return {
    from,
    to: record.status,
    revision: record.revision,
    contentHash: record.contentHash,
    files: record.files.map(file => ({ path: file.path, op: file.op, sha256: file.sha256, bytes: file.bytes })),
    ...(record.configPatch ? { configPaths: record.configPatch.patches.map(patch => `${patch.op}:${patch.path.join('.')}`) } : {}),
    ...(record.plan !== null && record.plan !== undefined ? { plan: record.plan } : {}),
  };
}

/** 目录递归字节数；不跟随符号链接，不存在记 0。 */
async function dirBytes(target: string): Promise<number> {
  let stat;
  try { stat = await lstat(target); } catch { return 0; }
  if (!stat.isDirectory()) return stat.size;
  let total = 0;
  let names: string[];
  try { names = await readdir(target); } catch { return 0; }
  for (const name of names) total += await dirBytes(path.join(target, name));
  return total;
}
