/**
 * 草稿队列（review 模式）：AI 生成的回复先停在这里，等人确认后再发。
 * 只存进程内存，重启即丢；持久化见 ADR 0035 后续项。
 */
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
  readonly createdAt: number;
  readonly updatedAt?: number;
}

export type BilibiliDraftInput = Omit<BilibiliReplyDraft, 'id' | 'createdAt' | 'status' | 'updatedAt'>;

export class BilibiliDraftQueue {
  readonly #drafts = new Map<string, BilibiliReplyDraft>();
  #seq = 0;

  constructor(readonly capacity = 200) {}

  add(input: BilibiliDraftInput, now = Date.now()): BilibiliReplyDraft {
    if (this.#drafts.size >= this.capacity) {
      // 优先挤掉最老的 pending 草稿，不动正在发送的。
      for (const [id, draft] of this.#drafts) {
        if (draft.status !== 'sending') {
          this.#drafts.delete(id);
          break;
        }
      }
    }
    const draft: BilibiliReplyDraft = Object.freeze({
      ...input,
      id: `d${(++this.#seq).toString(36)}${(now % 1296).toString(36).padStart(2, '0')}`,
      status: 'pending',
      createdAt: now,
    });
    this.#drafts.set(draft.id, draft);
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
    const next: BilibiliReplyDraft = Object.freeze({ ...current, ...patch, updatedAt: now });
    this.#drafts.set(id, next);
    return next;
  }

  discard(id: string): boolean {
    return this.#drafts.delete(id);
  }

  clear(): void {
    this.#drafts.clear();
  }

  get size(): number {
    return this.#drafts.size;
  }
}
