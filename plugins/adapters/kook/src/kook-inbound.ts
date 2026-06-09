/**
 * KOOK 入站侧事件去重（gateway notice / 系统消息）
 */
const DEDUPE_TTL_MS = 120_000;

export class InboundMessageDeduper {
  private readonly seen = new Map<string, number>();

  shouldProcess(key: string): boolean {
    const now = Date.now();
    for (const [id, t] of this.seen) {
      if (now - t > DEDUPE_TTL_MS) this.seen.delete(id);
    }
    if (this.seen.has(key)) return false;
    this.seen.set(key, now);
    return true;
  }

  clear(): void {
    this.seen.clear();
  }
}
