/**
 * In-process park/resume for HTTP tool approval (ADR 0040 P3 / ADR 0041).
 */

type WaiterEntry = {
  resolve: (approved: boolean) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class HttpApprovalWaiter {
  private readonly pending = new Map<string, WaiterEntry>();

  wait(requestId: string, timeoutMs = 300_000): Promise<boolean> {
    if (this.pending.has(requestId)) {
      return Promise.reject(new Error(`Duplicate approval request: ${requestId}`));
    }
    return new Promise<boolean>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`Approval timed out: ${requestId}`));
      }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
    });
  }

  resolve(requestId: string, approved: boolean): boolean {
    const entry = this.pending.get(requestId);
    if (!entry) return false;
    clearTimeout(entry.timer);
    this.pending.delete(requestId);
    entry.resolve(approved);
    return true;
  }

  has(requestId: string): boolean {
    return this.pending.has(requestId);
  }

  dispose(): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error('HttpApprovalWaiter disposed'));
    }
    this.pending.clear();
  }
}
