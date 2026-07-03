import type { JobHandler, JobInfo, ResolvedJob } from './types.js';

let nextJobId = 1;

export interface InternalJob {
  id: string;
  resolved: ResolvedJob;
  handler?: JobHandler;
  handlerKey?: string;
  payload?: unknown;
  nextRunAt: Date | null;
  cancelled: boolean;
  ephemeral: boolean;
  paused: boolean;
  runCount: number;
  maxRuns?: number;
  expiresAt?: Date | null;
}

export function createJobId(): string {
  return `job-${nextJobId++}`;
}

export function toJobInfo(job: InternalJob, cancel: () => void): JobInfo {
  return {
    id: job.id,
    kind: job.resolved.kind,
    nextRunAt: job.nextRunAt,
    cancel,
  };
}

/** 解析 handler 注册 key；默认取 `handler.name`，匿名函数需显式传入 key */
export function resolveHandlerKey(handler: JobHandler, key?: string): string | undefined {
  const resolved = key ?? handler.name;
  return resolved || undefined;
}

export class JobHeap {
  private items: InternalJob[] = [];
  private indexById = new Map<string, number>();

  get size(): number {
    return this.items.length;
  }

  peek(): InternalJob | undefined {
    return this.items[0];
  }

  push(job: InternalJob): void {
    this.items.push(job);
    this.indexById.set(job.id, this.items.length - 1);
    this.bubbleUp(this.items.length - 1);
  }

  remove(jobId: string): boolean {
    const index = this.indexById.get(jobId);
    if (index === undefined) {
      return false;
    }
    const last = this.items.pop()!;
    this.indexById.delete(jobId);
    if (index < this.items.length) {
      this.items[index] = last;
      this.indexById.set(last.id, index);
      this.bubbleDown(index);
      this.bubbleUp(index);
    }
    return true;
  }

  pop(): InternalJob | undefined {
    if (this.items.length === 0) {
      return undefined;
    }
    const top = this.items[0];
    this.remove(top.id);
    return top;
  }

  clear(): void {
    this.items = [];
    this.indexById.clear();
  }

  private compare(a: InternalJob, b: InternalJob): number {
    if (a.nextRunAt == null) return 1;
    if (b.nextRunAt == null) return -1;
    return a.nextRunAt.getTime() - b.nextRunAt.getTime();
  }

  private bubbleUp(index: number): void {
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.compare(this.items[index], this.items[parent]) >= 0) {
        break;
      }
      this.swap(index, parent);
      index = parent;
    }
  }

  private bubbleDown(index: number): void {
    const length = this.items.length;
    while (true) {
      const left = index * 2 + 1;
      const right = index * 2 + 2;
      let smallest = index;

      if (left < length && this.compare(this.items[left], this.items[smallest]) < 0) {
        smallest = left;
      }
      if (right < length && this.compare(this.items[right], this.items[smallest]) < 0) {
        smallest = right;
      }
      if (smallest === index) {
        break;
      }
      this.swap(index, smallest);
      index = smallest;
    }
  }

  private swap(a: number, b: number): void {
    const itemA = this.items[a];
    const itemB = this.items[b];
    this.items[a] = itemB;
    this.items[b] = itemA;
    this.indexById.set(itemA.id, b);
    this.indexById.set(itemB.id, a);
  }
}
