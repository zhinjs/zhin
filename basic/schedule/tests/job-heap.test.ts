import { describe, expect, it } from 'vitest';
import { JobHeap, type InternalJob } from '../src/job.js';

function job(id: string, nextRunAt: Date | null): InternalJob {
  return {
    id,
    resolved: { kind: 'solar', cron: '0 0 9 * * *', timezone: 'Asia/Shanghai' },
    nextRunAt,
    cancelled: false,
    ephemeral: true,
    paused: false,
    runCount: 0,
  };
}

describe('JobHeap', () => {
  it('orders jobs by nextRunAt', () => {
    const heap = new JobHeap();
    heap.push(job('later', new Date('2025-06-28T09:00:00+08:00')));
    heap.push(job('sooner', new Date('2025-06-27T09:00:00+08:00')));

    expect(heap.peek()?.id).toBe('sooner');
    expect(heap.pop()?.id).toBe('sooner');
    expect(heap.pop()?.id).toBe('later');
    expect(heap.pop()).toBeUndefined();
  });

  it('remove returns false for unknown id', () => {
    const heap = new JobHeap();
    expect(heap.remove('missing')).toBe(false);
  });

  it('remove reorders remaining jobs', () => {
    const heap = new JobHeap();
    heap.push(job('a', new Date('2025-06-27T09:00:00+08:00')));
    heap.push(job('b', new Date('2025-06-28T09:00:00+08:00')));
    heap.push(job('c', new Date('2025-06-29T09:00:00+08:00')));

    expect(heap.remove('b')).toBe(true);
    expect(heap.pop()?.id).toBe('a');
    expect(heap.pop()?.id).toBe('c');
  });

  it('clear empties heap', () => {
    const heap = new JobHeap();
    heap.push(job('a', new Date('2025-06-27T09:00:00+08:00')));
    heap.clear();
    expect(heap.size).toBe(0);
    expect(heap.peek()).toBeUndefined();
  });

  it('bubbleDown prefers smaller child when removing root', () => {
    const heap = new JobHeap();
    heap.push(job('a', new Date('2025-06-27T09:00:00+08:00')));
    heap.push(job('b', new Date('2025-06-27T10:00:00+08:00')));
    heap.push(job('c', new Date('2025-06-27T11:00:00+08:00')));
    heap.push(job('d', new Date('2025-06-27T12:00:00+08:00')));

    heap.remove('a');
    expect(heap.peek()?.id).toBe('b');
  });

  it('orders null nextRunAt after dated jobs in heap compare', () => {
    const heap = new JobHeap();
    heap.push(job('dated', new Date('2025-06-27T09:00:00+08:00')));
    heap.push(job('null', null));
    expect(heap.pop()?.id).toBe('dated');
    expect(heap.pop()?.id).toBe('null');
  });

  it('bubbleDown prefers left child when it is smaller than right', () => {
    const heap = new JobHeap();
    heap.push(job('root', new Date('2025-06-27T09:00:00+08:00')));
    heap.push(job('left', new Date('2025-06-27T10:00:00+08:00')));
    heap.push(job('right', new Date('2025-06-27T11:00:00+08:00')));

    heap.remove('root');
    expect(heap.peek()?.id).toBe('left');
  });

  it('bubbleDown uses right child when it is smaller', () => {
    const heap = new JobHeap();
    heap.push(job('root', new Date('2025-06-27T09:00:00+08:00')));
    heap.push(job('left', new Date('2025-06-27T11:00:00+08:00')));
    heap.push(job('right', new Date('2025-06-27T10:00:00+08:00')));

    heap.remove('root');
    expect(heap.peek()?.id).toBe('right');
  });
});
