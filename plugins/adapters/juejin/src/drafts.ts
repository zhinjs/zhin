/**
 * 草稿队列（review 模式）：AI 生成的回复先停在这里，等人确认后再发。
 *
 * 传入 `file` 时持久化到本地 JSON（默认 `data/juejin/<endpoint>/drafts.json`，权限 0600），进程重启后自动恢复。
 * 重启时仍处于 `sending` 的草稿结果未知（可能已经发出），恢复为 `pending` 并标记 `interrupted`，
 * 提醒审批人先去掘金确认，避免重复发送。
 */
import { isJuejinId } from './protocol.js';
import { readJson, removeFile, writeJsonAtomic } from './storage.js';

export type JuejinDraftStatus = 'pending' | 'sending';

export interface JuejinReplyDraft {
  readonly id: string;
  /** 本地 endpoint id（配置里的 endpoints[i].id）。 */
  readonly endpointId?: string;
  /** 评论楼会话 id：`article:<articleId>:<rootCommentId>`。 */
  readonly target?: string;
  readonly articleId: string;
  /** 评论楼根（一级评论 id）。 */
  readonly root: string;
  /** 直接回复的对象（等于 root = 回复一级评论）。 */
  readonly parent: string;
  readonly message: string;
  /** 被回复评论的摘要（作者 + 原文），供审批时对照。 */
  readonly context?: { readonly author: string; readonly text: string };
  readonly status?: JuejinDraftStatus;
  /** 上次发送时进程退出或结果未知；再次发送前应先到掘金确认。 */
  readonly interrupted?: boolean;
  readonly createdAt: number;
  readonly updatedAt?: number;
}

export type JuejinDraftInput = Omit<JuejinReplyDraft, 'id' | 'createdAt' | 'status' | 'updatedAt' | 'interrupted'>;

export interface JuejinDraftQueueOptions {
  readonly capacity?: number;
  /** 持久化文件；省略则只存内存。 */
  readonly file?: string;
  /** 持久化失败时回调（不抛出，草稿仍保留在内存）。 */
  readonly onPersistError?: (error: unknown) => void;
}

interface DraftFile {
  readonly version: 1;
  readonly seq: number;
  readonly drafts: readonly JuejinReplyDraft[];
}

function isDraft(value: unknown): value is JuejinReplyDraft {
  if (!value || typeof value !== 'object') return false;
  const draft = value as Record<string, unknown>;
  return typeof draft.id === 'string' && /^[a-z0-9]+$/u.test(draft.id)
    && isJuejinId(draft.articleId) && isJuejinId(draft.root) && isJuejinId(draft.parent)
    && typeof draft.message === 'string'
    && typeof draft.createdAt === 'number';
}

export class JuejinDraftQueue {
  readonly #drafts = new Map<string, JuejinReplyDraft>();
  readonly #file?: string;
  readonly #onPersistError?: (error: unknown) => void;
  readonly capacity: number;
  #seq = 0;

  constructor(options: number | JuejinDraftQueueOptions = {}) {
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
      const restored: JuejinReplyDraft = Object.freeze({
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

  add(input: JuejinDraftInput, now = Date.now()): JuejinReplyDraft {
    const draft: JuejinReplyDraft = Object.freeze({
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

  list(): readonly JuejinReplyDraft[] {
    return Object.freeze([...this.#drafts.values()]);
  }

  get(id: string): JuejinReplyDraft | undefined {
    return this.#drafts.get(id);
  }

  /**
   * 原地替换字段（id / createdAt 不变）。草稿不存在时返回 undefined。
   * `interrupted: true` 用于「发送结果未知」；人工改写正文会清掉这个标记。
   */
  update(id: string, patch: Partial<Pick<JuejinReplyDraft, 'message' | 'status' | 'interrupted'>>, now = Date.now()): JuejinReplyDraft | undefined {
    const current = this.#drafts.get(id);
    if (!current) return undefined;
    const { interrupted, ...rest } = current;
    const { interrupted: markInterrupted, ...fields } = patch;
    // 人工改写过正文后不再提示「可能已发出」——审批人已经看过了。
    const keepInterrupted = markInterrupted === true || (interrupted && fields.message === undefined);
    const next: JuejinReplyDraft = Object.freeze({ ...rest, ...fields, ...(keepInterrupted ? { interrupted: true } : {}), updatedAt: now });
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
