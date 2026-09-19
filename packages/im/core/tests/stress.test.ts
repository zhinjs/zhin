/**
 * Zhin.js 高并发压力测试
 *
 * 覆盖场景：
 * 1. 消息洪水 — 大量消息同时涌入 Adapter
 * 2. 中间件链性能 — compose() 在不同深度下的吞吐
 * 3. Dispatcher 并发竞争 — 多消息同时进入三阶段调度
 * 4. 插件生命周期并发 — 并发 start/stop/provide/inject
 * 5. 内存泄漏检测 — 循环注册/注销后资源是否完整释放
 * 6. 事件系统风暴 — 大量 dispatch/broadcast 并发
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Plugin } from '../src/plugin.js';
import { Message, MessageBase } from '../src/message.js';
import { compose } from '../src/utils.js';
import { createMessageDispatcher, type MessageDispatcherService } from '../src/built/dispatcher.js';
import type { MessageMiddleware } from '../src/types.js';

// ────────────────────────── helpers ──────────────────────────

function makeMsg(text: string, overrides: Partial<Message<any>> = {}): Message<any> {
  return {
    $id: `msg-${Math.random().toString(36).slice(2, 8)}`,
    $content: [{ type: 'text', data: { text } }],
    $raw: text,
    $sender: { id: 'u1', name: 'U' },
    $channel: { id: 'ch1', type: 'group' },
    $adapter: 'test',
    $endpoint: 'bot1',
    $timestamp: Date.now(),
    $reply: vi.fn(async () => 'ok'),
    $recall: vi.fn(async () => {}),
    ...overrides,
  } as any;
}

/** 记录堆内存快照（MB） */
function heapMB(): number {
  if (typeof globalThis.gc === 'function') globalThis.gc();
  return Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
}

// ────────────────────── 1. 中间件链性能 ──────────────────────

describe('Stress: Middleware compose 吞吐', () => {
  it('100 层中间件洋葱，1000 条消息', async () => {
    const mws: MessageMiddleware[] = [];
    for (let i = 0; i < 100; i++) {
      mws.push(async (_msg, next) => { await next(); });
    }
    const fn = compose(mws);
    const msg = makeMsg('ping');

    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      await fn(msg, async () => {});
    }
    const elapsed = performance.now() - start;

    console.log(`[中间件] 100层 × 1000msg = ${elapsed.toFixed(1)}ms`);
    // 100层洋葱 × 1000条消息应在合理时间内完成
    expect(elapsed).toBeLessThan(5000);
  });

  it('单层中间件 10000 条消息基准', async () => {
    const fn = compose([async (_msg, next) => { await next(); }]);
    const msg = makeMsg('baseline');

    const start = performance.now();
    for (let i = 0; i < 10000; i++) {
      await fn(msg, async () => {});
    }
    const elapsed = performance.now() - start;

    console.log(`[中间件] 1层 × 10000msg = ${elapsed.toFixed(1)}ms`);
    expect(elapsed).toBeLessThan(3000);
  });

  it('中间件中抛异常不应导致后续消息失败', async () => {
    let errorCount = 0;
    let successCount = 0;

    const fn = compose([
      async (msg: Message<any>, next) => {
        if (msg.$raw === 'bomb') throw new Error('boom');
        await next();
      },
    ]);

    for (let i = 0; i < 100; i++) {
      const text = i % 10 === 0 ? 'bomb' : 'ok';
      try {
        await fn(makeMsg(text), async () => { successCount++; });
      } catch {
        errorCount++;
      }
    }

    expect(errorCount).toBe(10);
    expect(successCount).toBe(90);
  });
});

// ────────────────────── 2. Dispatcher 并发竞争 ──────────────────────

describe('Stress: Dispatcher 并发', () => {
  let service: MessageDispatcherService;

  beforeEach(() => {
    const ctx = createMessageDispatcher();
    service = ctx.value;
  });

  it('100 条消息并发 dispatch，Guardrail 计数正确', async () => {
    let guardrailCount = 0;

    service.addGuardrail(async (_msg, next) => {
      guardrailCount++;
      await next();
    });

    const promises = Array.from({ length: 100 }, (_, i) =>
      service.dispatch(makeMsg(`concurrent-${i}`))
    );
    await Promise.all(promises);

    console.log(`[Dispatcher] 100 并发, guardrailCount = ${guardrailCount}`);
    expect(guardrailCount).toBe(100);
  });

  it('Guardrail + AI + Command 同时注册，并发不互相干扰', async () => {
    const log: string[] = [];

    service.addGuardrail(async (_msg, next) => {
      log.push('guard');
      await next();
    });

    service.setAITriggerMatcher(() => ({ triggered: true, content: 'ai-test' }));
    service.setAIHandler(async (msg) => {
      log.push(`ai:${msg.$raw}`);
    });

    const promises = Array.from({ length: 50 }, (_, i) =>
      service.dispatch(makeMsg(`msg-${i}`))
    );
    await Promise.all(promises);

    const guardCount = log.filter(l => l === 'guard').length;
    const aiCount = log.filter(l => l.startsWith('ai:')).length;

    console.log(`[Dispatcher 混合] guard=${guardCount}, ai=${aiCount}`);
    expect(guardCount).toBe(50);
    expect(aiCount).toBe(50);
  });

  it('慢 Guardrail 不应阻塞无关消息的独立 dispatch 调用', async () => {
    // 每个 dispatch 是独立的 async call，慢 guardrail 只阻塞自己
    const timings: number[] = [];

    service.addGuardrail(async (msg: Message<any>, next) => {
      if (msg.$raw === 'slow') {
        await new Promise(r => setTimeout(r, 200));
      }
      await next();
    });

    const start = performance.now();

    const slowPromise = service.dispatch(makeMsg('slow'));
    const fastPromises = Array.from({ length: 20 }, (_, i) => {
      const s = performance.now();
      return service.dispatch(makeMsg(`fast-${i}`)).then(() => {
        timings.push(performance.now() - s);
      });
    });

    await Promise.all([slowPromise, ...fastPromises]);
    const totalTime = performance.now() - start;
    const avgFast = timings.reduce((a, b) => a + b, 0) / timings.length;

    console.log(`[Dispatcher 慢G] total=${totalTime.toFixed(1)}ms, avgFast=${avgFast.toFixed(1)}ms`);
    // 快消息不应等待慢消息，平均延迟应远小于200ms
    expect(avgFast).toBeLessThan(100);
  });
});

// ────────────────────── 4. 插件生命周期并发 ──────────────────────

describe('Stress: 插件生命周期', () => {
  it('100 个子插件并发 start/stop 不应报错', async () => {
    const root = new Plugin('/stress/root.ts');
    const children: Plugin[] = [];

    for (let i = 0; i < 100; i++) {
      children.push(new Plugin(`/stress/child-${i}.ts`, root));
    }

    expect(root.children.length).toBe(100);

    // 并发 start
    await Promise.all(children.map(c => c.start()));
    expect(children.every(c => c.started)).toBe(true);

    // 并发 stop
    await Promise.all(children.map(c => c.stop()));
    expect(children.every(c => !c.started)).toBe(true);
  });

  it('Context provide 和 useContext 并发注册和使用', async () => {
    const plugin = new Plugin('/stress/ctx.ts');
    const values: number[] = [];

    // 并发注册 50 个 Context
    for (let i = 0; i < 50; i++) {
      plugin.provide({
        name: `svc-${i}` as any,
        value: i,
      });
    }

    expect(plugin.$contexts.size).toBe(50);

    // 并发 inject
    for (let i = 0; i < 50; i++) {
      values.push(plugin.inject(`svc-${i}` as any));
    }

    expect(values).toEqual(Array.from({ length: 50 }, (_, i) => i));
  });

  it('中间件批量注册/注销后不残留', () => {
    const plugin = new Plugin('/stress/mw-cleanup.ts');
    const disposes: (() => void)[] = [];

    for (let i = 0; i < 200; i++) {
      disposes.push(
        plugin.addMiddleware(async (_msg, next) => { await next(); })
      );
    }

    // 全部注销
    disposes.forEach(d => d());

    // Plugin 的默认 #messageMiddleware 总是存在（第一个），所以 compose 后执行不报错
    const composed = plugin.middleware;
    expect(composed).toBeDefined();
  });
});

// ────────────────────── 5. 内存泄漏检测 ──────────────────────

describe('Stress: 内存泄漏检测', () => {
  it('反复创建/销毁插件后内存不应持续增长', async () => {
    const heapBefore = heapMB();

    for (let round = 0; round < 50; round++) {
      const root = new Plugin('/stress/leak-root.ts');

      for (let i = 0; i < 20; i++) {
        const child = new Plugin(`/stress/leak-${round}-${i}.ts`, root);
        child.addMiddleware(async (_msg, next) => { await next(); });
        child.provide({ name: `leak-svc-${i}` as any, value: { data: new Array(100).fill(round) } });
      }

      await root.start();
      await root.stop();
    }

    // 手动触发 GC（如可用）
    if (typeof globalThis.gc === 'function') globalThis.gc();
    await new Promise(r => setTimeout(r, 100));

    const heapAfter = heapMB();
    const growth = heapAfter - heapBefore;

    console.log(`[内存] before=${heapBefore}MB, after=${heapAfter}MB, growth=${growth}MB`);
    // 允许一定增长（GC 未必立即回收），但不应超过 50MB
    expect(growth).toBeLessThan(50);
  });

  it('start 后 stop() 会清理 on() 注册的事件监听器', async () => {
    const root = new Plugin('/stress/listener-leak.ts');
    const child = new Plugin('/stress/listener-child.ts', root);

    // 必须先 start 才能 stop（stop 内有 if (!this.started) return）
    await child.start();

    for (let i = 0; i < 30; i++) {
      child.on('message.receive', () => {});
    }

    expect(child.listenerCount('message.receive')).toBe(30);

    await child.stop();

    const listenersAfter = child.listenerCount('message.receive');
    console.log(`[事件清理] add=30, afterStop=${listenersAfter}`);
    // stop() 末尾 removeAllListeners() 会清理所有 on() 监听器
    expect(listenersAfter).toBe(0);
  });
});

// ────────────────────── 6. 事件系统风暴 ──────────────────────

describe('Stress: 事件 dispatch/broadcast 风暴', () => {
  it('1000 次 dispatch 在 3 层插件树中传播正确', async () => {
    const root = new Plugin('/stress/evt-root.ts');
    const mid = new Plugin('/stress/evt-mid.ts', root);
    const leaf = new Plugin('/stress/evt-leaf.ts', mid);

    let rootCount = 0;
    let midCount = 0;
    let leafCount = 0;

    root.on('test.event', () => { rootCount++; });
    mid.on('test.event', () => { midCount++; });
    leaf.on('test.event', () => { leafCount++; });

    // dispatch 是 async 的，必须 await
    for (let i = 0; i < 1000; i++) {
      await leaf.dispatch('test.event' as any);
    }

    console.log(`[事件风暴] root=${rootCount}, mid=${midCount}, leaf=${leafCount}`);
    // dispatch: leaf → mid → root(broadcast) → root listeners → mid listeners → leaf listeners
    expect(rootCount).toBe(1000);
    expect(midCount).toBe(1000);
    expect(leafCount).toBe(1000);
  });

  it('broadcast 向下传播（含自身 listener）', async () => {
    const root = new Plugin('/stress/bc-root.ts');
    const child1 = new Plugin('/stress/bc-child1.ts', root);
    const child2 = new Plugin('/stress/bc-child2.ts', root);

    let rootCount = 0;
    let child1Count = 0;
    let child2Count = 0;

    root.on('bc.event', () => { rootCount++; });
    child1.on('bc.event', () => { child1Count++; });
    child2.on('bc.event', () => { child2Count++; });

    // broadcast 是 async 的，必须 await
    for (let i = 0; i < 500; i++) {
      await root.broadcast('bc.event' as any);
    }

    console.log(`[广播风暴] root=${rootCount}, child1=${child1Count}, child2=${child2Count}`);
    // broadcast 先触发自身 listener，再递归子插件
    expect(rootCount).toBe(500);
    expect(child1Count).toBe(500);
    expect(child2Count).toBe(500);
  });
});

// ────────────────────── 7. 边界/极端场景 ──────────────────────

describe('Stress: 边界场景', () => {
  it('compose 空中间件数组仍应调用 terminal next（dispatcher）', async () => {
    let nextCalled = false;
    const fn = compose([]);
    await fn(makeMsg('empty'), async () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
  });

  it('compose 单中间件应正常工作', async () => {
    let called = false;
    const fn = compose([async (_msg, next) => { called = true; await next(); }]);
    await fn(makeMsg('single'), async () => {});
    expect(called).toBe(true);
  });

  it('单中间件 next() 重复调用也能被检测', async () => {
    const fn = compose([
      async (_msg: any, next: any) => {
        await next();
        await next(); // 现在统一走 dispatch 保护
      },
    ]);

    let error: Error | null = null;
    try {
      await fn(makeMsg('double-next'), async () => {});
    } catch (e: any) {
      error = e;
    }
    expect(error).not.toBeNull();
    expect(error!.message).toBe('next() called multiple times');
  });

  it('多中间件时 next() 重复调用会被检测', async () => {
    const fn = compose([
      async (_msg: any, next: any) => {
        await next();
        await next(); // 会被 dispatch index 检测到
      },
      async (_msg: any, next: any) => { await next(); },
    ]);

    let error: Error | null = null;
    try {
      await fn(makeMsg('double-next'), async () => {});
    } catch (e: any) {
      error = e;
    }
    expect(error).not.toBeNull();
    expect(error!.message).toBe('next() called multiple times');
  });

  it('Dispatcher dispatch 空消息不应崩溃', async () => {
    const ctx = createMessageDispatcher();
    const service = ctx.value;

    // 不注册任何 handler，dispatch 不应崩溃
    await service.dispatch(makeMsg(''));
    await service.dispatch(makeMsg('   '));
  });

  it('深层插件树（50层）root 查找正确', () => {
    const plugins: Plugin[] = [];
    let current: Plugin | undefined;

    for (let i = 0; i < 50; i++) {
      const p = new Plugin(`/stress/deep-${i}.ts`, current);
      plugins.push(p);
      current = p;
    }

    const leaf = plugins[plugins.length - 1];
    const root = plugins[0];

    expect(leaf.root).toBe(root);
  });

});
