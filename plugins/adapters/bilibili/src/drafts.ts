/**
 * 草稿队列（review 模式）：AI 生成的回复先停在这里，等人确认后再发。
 *
 * 传入 `file` 时持久化到本地 JSON（默认 `data/bilibili/<endpoint>/drafts.json`），进程重启后自动恢复。
 * 重启时仍处于 `sending` 的草稿结果未知（可能已经发出），恢复为 `pending` 并标记 `interrupted`，
 * 提醒审批人先去 B 站确认，避免重复发送。
 */
import { readJson, removeFile, writeJsonAtomic } from './storage.js';

export type BilibiliDraftStatus = 'pending' | 'sending';

export interface BilibiliReplyDraft {
  readonly id: string;
  /** 本地 endpoint id（配置里的 endpoints[i].id）。 */
  readonly endpointId?: string;
  /** 评论楼会话 id：`video:<aid>:<根评论rpid>`。 */
  readonly target?: string;
  readonly oid: string;
  readonly root: string;
  readonly parent: string;
  readonly message: string;
  /** 被回复评论的摘要（作者 + 原文），供审批时对照。 */
  readonly context?: { readonly author: string; readonly text: string };
  readonly status?: BilibiliDraftStatus;
  /** 上次发送时进程退出，结果未知；再次发送前应先到 B 站确认。 */
  readonly interrupted?: boolean;
  readonly createdAt: number;
  readonly updatedAt?: number;
}

export type BilibiliDraftInput = Omit<BilibiliReplyDraft, 'id' | 'createdAt' | 'status' | 'updatedAt' | 'interrupted'>;

export interface BilibiliDraftQueueOptions {
  readonly capacity?: number;
  /** 持久化文件；省略则只存内存。 */
  readonly file?: string;
  /** 持久化失败时回调（不抛出，草稿仍保留在内存）。 */
  readonly onPersistError?: (error: unknown) => void;
}

interface DraftFile {
  readonly version: 1;
  readonly seq: number;
  readonly drafts: readonly BilibiliReplyDraft[];
}

const DIGITS = /^\d+$/u;

function isDraft(value: unknown): value is BilibiliReplyDraft {
  if (!value || typeof value !== 'object') return false;
  const draft = value as Record<string, unknown>;
  return typeof draft.id === 'string' && /^[a-z0-9]+$/u.test(draft.id)
    && typeof draft.oid === 'string' && DIGITS.test(draft.oid)
    && typeof draft.root === 'string' && DIGITS.test(draft.root)
    && typeof draft.parent === 'string' && DIGITS.test(draft.parent)
    && typeof draft.message === 'string'
    && typeof draft.createdAt === 'number';
}

export class BilibiliDraftQueue {
  readonly #drafts = new Map<string, BilibiliReplyDraft>();
  readonly #file?: string;
  readonly #onPersistError?: (error: unknown) => void;
  readonly capacity: number;
  #seq = 0;

  constructor(options: number | BilibiliDraftQueueOptions = {}) {
    const resolved = typeof options === 'number' ? { capacity: options } : options;
    this.capacity = Math.max(1, resolved.capacity ?? 200);
    this.#file = resolved.file;
    this.#onPersistError = resolved.onPersistError;
    this.#load();
  }

  /** 是否落盘。 */
  get persistent(): boolean {
    return this.#file !== undefined;
  }

  #load(): void {
    if (!this.#file) return;
    const raw = readJson(this.#file) as Partial<DraftFile> | undefined;
    if (!raw || !Array.isArray(raw.drafts)) return;
    if (typeof raw.seq === 'number' && Number.isFinite(raw.seq)) this.#seq = Math.max(0, Math.floor(raw.seq));
    for (const entry of raw.drafts) {
      if (!isDraft(entry)) continue;
      const { context, status, interrupted, ...rest } = entry;
      const restored: BilibiliReplyDraft = Object.freeze({
        ...rest,
        ...(context && typeof context.author === 'string' && typeof context.text === 'string'
          ? { context: Object.freeze({ author: context.author, text: context.text }) } : {}),
        status: 'pending' as const,
        ...(status === 'sending' || interrupted ? { interrupted: true } : {}),
      });
      this.#drafts.set(restored.id, restored);
    }
    this.#evict();
  }

  #persist(): void {
    if (!this.#file) return;
    try {
      if (this.#drafts.size === 0 && this.#seq === 0) {
        removeFile(this.#file);
        return;
      }
      const data: DraftFile = { version: 1, seq: this.#seq, drafts: [...this.#drafts.values()] };
      writeJsonAtomic(this.#file, data, 0o600);
    } catch (error) {
      this.#onPersistError?.(error);
    }
  }

  #evict(): void {
    while (this.#drafts.size > this.capacity) {
      let removed = false;
      // 优先挤掉最老的 pending 草稿，不动正在发送的。
      for (const [id, draft] of this.#drafts) {
        if (draft.status !== 'sending') {
          this.#drafts.delete(id);
          removed = true;
          break;
        }
      }
      if (!removed) break;
    }
  }

  add(input: BilibiliDraftInput, now = Date.now()): BilibiliReplyDraft {
    const draft: BilibiliReplyDraft = Object.freeze({
      ...input,
      id: `d${(++this.#seq).toString(36)}${(now % 1296).toString(36).padStart(2, '0')}`,
      status: 'pending',
      createdAt: now,
    });
    this.#drafts.set(draft.id, draft);
    this.#evict();
    this.#persist();
    return draft;
  }

  list(): readonly BilibiliReplyDraft[] {
    return Object.freeze([...this.#drafts.values()]);
  }

  get(id: string): BilibiliReplyDraft | undefined {
    return this.#drafts.get(id);
  }

  /** 原地替换字段（id / createdAt 不变）。草稿不存在时返回 undefined。 */
  update(id: string, patch: Partial<Pick<BilibiliReplyDraft, 'message' | 'status'>>, now = Date.now()): BilibiliReplyDraft | undefined {
    const current = this.#drafts.get(id);
    if (!current) return undefined;
    const { interrupted, ...rest } = current;
    // 人工改写过正文后不再提示「可能已发出」——审批人已经看过了。
    const keepInterrupted = interrupted && patch.message === undefined;
    const next: BilibiliReplyDraft = Object.freeze({ ...rest, ...patch, ...(keepInterrupted ? { interrupted: true } : {}), updatedAt: now });
    this.#drafts.set(id, next);
    this.#persist();
    return next;
  }

  discard(id: string): boolean {
    const removed = this.#drafts.delete(id);
    if (removed) this.#persist();
    return removed;
  }

  clear(): void {
    this.#drafts.clear();
    this.#persist();
  }

  get size(): number {
    return this.#drafts.size;
  }
}
