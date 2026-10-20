import type { InternalJob } from '../job.js';
import { JobHeap } from '../job.js';

/** Node.js setTimeout max delay ~24.8 days */
const MAX_TIMEOUT_MS = 2_147_000_000;

export type TimerCallback = (job: InternalJob) => void | Promise<void>;

export class TimerWheel {
  private heap = new JobHeap();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private targetJobId: string | null = null;
  private stopped = false;
  private onFire: TimerCallback;

  constructor(onFire: TimerCallback) {
    this.onFire = onFire;
  }

  add(job: InternalJob): void {
    if (job.cancelled || job.nextRunAt == null) {
      return;
    }
    this.heap.push(job);
    this.reschedule();
  }

  remove(jobId: string): void {
    this.heap.remove(jobId);
    if (this.targetJobId === jobId) {
      this.clearTimer();
      this.reschedule();
    }
  }

  update(job: InternalJob): void {
    this.heap.remove(job.id);
    if (!job.cancelled && job.nextRunAt != null) {
      this.heap.push(job);
    }
    this.reschedule();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimer();
    this.heap.clear();
  }

  private clearTimer(): void {
    if (this.timer != null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.targetJobId = null;
  }

  private reschedule(): void {
    if (this.stopped) {
      return;
    }

    this.clearTimer();
    const next = this.heap.peek();
    if (!next?.nextRunAt) {
      return;
    }

    const now = Date.now();
    let delay = next.nextRunAt.getTime() - now;
    if (delay < 0) {
      delay = 0;
    }

    this.targetJobId = next.id;

    if (delay > MAX_TIMEOUT_MS) {
      this.timer = setTimeout(() => this.reschedule(), MAX_TIMEOUT_MS);
      return;
    }

    this.timer = setTimeout(() => {
      void this.fire(next);
    }, delay);
  }

  private async fire(expected: InternalJob): Promise<void> {
    if (this.stopped) {
      return;
    }

    const job = this.heap.pop();
    if (!job || job.id !== expected.id) {
      this.reschedule();
      return;
    }

    if (job.cancelled) {
      this.reschedule();
      return;
    }

    await this.onFire(job);
    this.reschedule();
  }
}
