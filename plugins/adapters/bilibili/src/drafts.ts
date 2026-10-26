/**
 * 草稿队列（review 模式）：AI 生成的回复先停在这里，等人确认后再发。
 * v1 只存进程内存，重启即丢；持久化与 Console 审批入口见 ADR 0035 后续项。
 */
export interface BilibiliReplyDraft {
  readonly id: string;
  readonly oid: string;
  readonly root: string;
  readonly parent: string;
  readonly message: string;
  readonly createdAt: number;
}

export class BilibiliDraftQueue {
  readonly #drafts = new Map<string, BilibiliReplyDraft>();
  #seq = 0;

  constructor(readonly capacity = 200) {}

  add(input: Omit<BilibiliReplyDraft, 'id' | 'createdAt'>, now = Date.now()): BilibiliReplyDraft {
    if (this.#drafts.size >= this.capacity) {
      const oldest = this.#drafts.keys().next().value;
      if (oldest !== undefined) this.#drafts.delete(oldest);
    }
    const draft = Object.freeze({ ...input, id: `draft-${now}-${++this.#seq}`, createdAt: now });
    this.#drafts.set(draft.id, draft);
    return draft;
  }

  list(): readonly BilibiliReplyDraft[] {
    return Object.freeze([...this.#drafts.values()]);
  }

  get(id: string): BilibiliReplyDraft | undefined {
    return this.#drafts.get(id);
  }

  discard(id: string): boolean {
    return this.#drafts.delete(id);
  }

  clear(): void {
    this.#drafts.clear();
  }
}
