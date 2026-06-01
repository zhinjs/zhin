import { describe, expect, it } from 'vitest';
import { createMemoryStoragePort } from '@zhin.js/storage-port';
import { QueueRuntime } from '../src/runtime.js';

describe('QueueRuntime outbound pipeline smoke', () => {
  it('enqueue 多条后 claim 仅取最早 pending', async () => {
    const rt = new QueueRuntime(createMemoryStoragePort(), { botId: 'b1' });
    const a = await rt.enqueueOutgoing('b1', { content: 'a' });
    const b = await rt.enqueueOutgoing('b1', { content: 'b' });
    const claimed = await rt.claimOutgoing('w1');
    expect(claimed?.id).toBe(a.id);
    expect(claimed?.id).not.toBe(b.id);
  });

  it('executeOutbound 失败时标记 failed 并记录 error', async () => {
    const rt = new QueueRuntime(createMemoryStoragePort(), { botId: 'b2' });
    const out = await rt.enqueueOutgoing('b2', { content: 'x' });
    await rt.claimOutgoing('w1');
    const result = await rt.executeOutbound(out.id, async () => {
      throw new Error('adapter down');
    });
    expect(result.executed).toBe(false);
    expect(result.record.status).toBe('failed');
    expect(result.record.error).toContain('adapter down');
  });

  it('不同 worker 在锁未过期时 claim 返回 null', async () => {
    const rt = new QueueRuntime(createMemoryStoragePort(), { botId: 'b3' });
    await rt.enqueueOutgoing('b3', { content: 'x' });
    const first = await rt.claimOutgoing('w-a');
    expect(first).not.toBeNull();
    const second = await rt.claimOutgoing('w-b');
    expect(second).toBeNull();
  });

  it('listOutgoing 按 createdAt 排序', async () => {
    const rt = new QueueRuntime(createMemoryStoragePort(), { botId: 'b4' });
    await rt.enqueueOutgoing('b4', { n: 1 });
    await rt.enqueueOutgoing('b4', { n: 2 });
    const list = await rt.listOutgoing();
    expect(list.length).toBe(2);
    expect(list[0]!.createdAt).toBeLessThanOrEqual(list[1]!.createdAt);
  });
});
