import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createEndpointLifecycle,
  type EndpointConnectFn,
  type EndpointConnectHandle,
} from '../src/index.js';

interface VirtualConnection {
  readonly handle: EndpointConnectHandle;
  readonly resolve: () => void;
  readonly reject: (err: Error) => void;
}

/** 虚拟 connect：每次调用挂起，测试手动 resolve（= open）/ reject（= 失败）。 */
function createVirtualConnect() {
  const connections: VirtualConnection[] = [];
  const connect = vi.fn(((handle: EndpointConnectHandle) => new Promise<void>((resolve, reject) => {
    connections.push({ handle, resolve: () => resolve(), reject });
  })) as EndpointConnectFn);
  return { connect, connections };
}

/** 冲刷微任务链（reject/resolve → race → 重连循环下一步）；fake timers 不接管微任务，需显式让出。 */
async function flush(times = 10): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

describe('createEndpointLifecycle', () => {
  it('does not publish open when the transport closes just after connect resolves', async () => {
    const lifecycle = createEndpointLifecycle({ name: 'immediate-close', reconnect: false });
    await lifecycle.start((handle) => new Promise<void>((resolve) => {
      resolve();
      queueMicrotask(() => handle.notifyClosed('closed immediately after open'));
    }));
    expect(lifecycle.state).toBe('closed');
    expect(lifecycle.started).toBe(false);
    await lifecycle.stop();
  });

  it('retries an immediately closed reconnect exactly once per backoff interval', async () => {
    let handle!: EndpointConnectHandle;
    let attempt = 0;
    const lifecycle = createEndpointLifecycle({
      name: 'immediate-reconnect-close',
      reconnect: { initialIntervalMs: 10, jitterMs: 0 },
    });
    const connect = vi.fn((next: EndpointConnectHandle) => new Promise<void>((resolve) => {
      handle = next;
      attempt += 1;
      resolve();
      if (attempt === 2) queueMicrotask(() => next.notifyClosed('closed after reconnect open'));
    }));
    await lifecycle.start(connect);
    handle.notifyClosed();
    await vi.advanceTimersByTimeAsync(10);
    expect(lifecycle.state).toBe('reconnecting');
    expect(connect).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(19);
    expect(connect).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(lifecycle.state).toBe('open');
    expect(connect).toHaveBeenCalledTimes(3);
    await lifecycle.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('counts closed-but-resolved reconnects toward exponential backoff and the finite attempt budget', async () => {
    let handle!: EndpointConnectHandle; let calls = 0;
    const lifecycle = createEndpointLifecycle({ name: 'sdk-close-abort', reconnect: { initialIntervalMs: 10, multiplier: 2, maxIntervalMs: 100, jitterMs: 0, maxAttempts: 3 } });
    const connect = vi.fn(async (next: EndpointConnectHandle) => { handle = next; if (++calls > 1) next.notifyClosed('SDK close then swallowed abort'); });
    await lifecycle.start(connect); handle.notifyClosed('network cut');
    await vi.advanceTimersByTimeAsync(10); expect(connect).toHaveBeenCalledTimes(2); expect(lifecycle.state).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(19); expect(connect).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1); expect(connect).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(39); expect(connect).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1); expect(connect).toHaveBeenCalledTimes(4); expect(lifecycle.state).toBe('closed');
    await vi.advanceTimersByTimeAsync(1000); expect(connect).toHaveBeenCalledTimes(4); expect(vi.getTimerCount()).toBe(0);
    await lifecycle.stop();
  });

  it('resets backoff only after a reconnect stays open', async () => {
    let handle!: EndpointConnectHandle; let calls = 0;
    const lifecycle = createEndpointLifecycle({ name: 'sdk-close-recovered', reconnect: { initialIntervalMs: 10, multiplier: 2, jitterMs: 0 } });
    const connect = vi.fn(async (next: EndpointConnectHandle) => { handle = next; if (++calls === 2) next.notifyClosed('still cut'); });
    await lifecycle.start(connect); handle.notifyClosed();
    await vi.advanceTimersByTimeAsync(10); expect(lifecycle.state).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(20); expect(lifecycle.state).toBe('open');
    handle.notifyClosed('new independent outage');
    await vi.advanceTimersByTimeAsync(9); expect(connect).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1); expect(connect).toHaveBeenCalledTimes(4); expect(lifecycle.state).toBe('open');
    await lifecycle.stop(); expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['missing', 'silent', 'throwing'] as const)(
    'retires a watchdog connection with a %s force-close callback until close is confirmed',
    async (kind) => {
      let handle!: EndpointConnectHandle;
      const lifecycle = createEndpointLifecycle({
        name: 'watchdog-close-confirmation',
        reconnect: { initialIntervalMs: 10, jitterMs: 0 },
        heartbeat: { watchdogMisses: 1 },
      });
      const connect = vi.fn(async (next: EndpointConnectHandle) => {
        handle = next;
        if (kind !== 'missing') next.onForceClose(() => {
          if (kind === 'throwing') throw new Error('force close failed');
        });
      });
      await lifecycle.start(connect);
      lifecycle.startHeartbeat(() => {}, 10);
      await vi.advanceTimersByTimeAsync(20);
      expect(lifecycle.state).toBe('closed');
      expect(lifecycle.started).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(100);
      expect(connect).toHaveBeenCalledOnce();
      // An actual late close confirms cleanup and can safely arm reconnection.
      handle.notifyClosed();
      await vi.advanceTimersByTimeAsync(10);
      expect(connect).toHaveBeenCalledTimes(2);
      expect(lifecycle.state).toBe('open');
      await lifecycle.stop();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('a delayed watchdog close after stop cannot arm reconnection', async () => {
    let handle!: EndpointConnectHandle;
    const lifecycle = createEndpointLifecycle({
      name: 'watchdog-stop', heartbeat: { watchdogMisses: 1 },
    });
    const connect = vi.fn(async (next: EndpointConnectHandle) => { handle = next; });
    await lifecycle.start(connect);
    lifecycle.startHeartbeat(() => {}, 10);
    await vi.advanceTimersByTimeAsync(20);
    await lifecycle.stop();
    handle.notifyClosed();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(connect).toHaveBeenCalledOnce();
    expect(lifecycle.state).toBe('stopped');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects manual start while watchdog closure is unconfirmed and reconnects after actual close', async () => {
    let handle!: EndpointConnectHandle;
    const lifecycle = createEndpointLifecycle({
      name: 'watchdog-manual-restart',
      reconnect: { initialIntervalMs: 10, jitterMs: 0 },
      heartbeat: { watchdogMisses: 1 },
    });
    const connect = vi.fn(async (next: EndpointConnectHandle) => {
      handle = next;
      next.onForceClose(() => {});
    });
    await lifecycle.start(connect);
    lifecycle.startHeartbeat(() => {}, 10);
    await vi.advanceTimersByTimeAsync(20);
    expect(lifecycle.state).toBe('closed');
    const replacement = vi.fn(async () => {});
    await expect(lifecycle.start(replacement)).rejects.toThrow('close has not been confirmed');
    expect(replacement).not.toHaveBeenCalled();
    expect(connect).toHaveBeenCalledOnce();
    handle.notifyClosed();
    await vi.advanceTimersByTimeAsync(10);
    expect(connect).toHaveBeenCalledTimes(2);
    expect(lifecycle.state).toBe('open');
    await lifecycle.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('allows manual restart after confirmed watchdog close with reconnect disabled', async () => {
    let handle!: EndpointConnectHandle;
    const lifecycle = createEndpointLifecycle({
      name: 'watchdog-confirmed-restart', reconnect: false, heartbeat: { watchdogMisses: 1 },
    });
    const connect = vi.fn(async (next: EndpointConnectHandle) => { handle = next; });
    await lifecycle.start(connect);
    lifecycle.startHeartbeat(() => {}, 10);
    await vi.advanceTimersByTimeAsync(20);
    await expect(lifecycle.start(connect)).rejects.toThrow('close has not been confirmed');
    handle.notifyClosed();
    await lifecycle.start(connect);
    expect(lifecycle.state).toBe('open');
    expect(connect).toHaveBeenCalledTimes(2);
    await lifecycle.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('an obsolete reconnect cannot mark a replacement startup open', async () => {
    const lifecycle = createEndpointLifecycle({
      name: 'restart-during-reconnect', reconnect: { initialIntervalMs: 10, jitterMs: 0 },
    });
    const first = createVirtualConnect();
    const replacement = createVirtualConnect();
    const starting = lifecycle.start(first.connect);
    await flush();
    first.connections[0]!.resolve();
    await starting;
    first.connections[0]!.handle.notifyClosed();
    await vi.advanceTimersByTimeAsync(10);
    expect(first.connections).toHaveLength(2);
    const stopping = lifecycle.stop();
    const restarting = lifecycle.start(replacement.connect);
    await stopping;
    await flush();
    expect(lifecycle.state).toBe('connecting');
    first.connections[1]!.resolve();
    await flush();
    expect(lifecycle.state).toBe('connecting');
    replacement.connections[0]!.resolve();
    await restarting;
    expect(lifecycle.state).toBe('open');
    await lifecycle.stop();
  });

  it('does not create a connection when stopped before its deferred connect runs', async () => {
    const lifecycle = createEndpointLifecycle({ name: 'cancel-before-connect' });
    const connect = vi.fn(async () => {});
    const starting = lifecycle.start(connect);
    await lifecycle.stop();
    await starting;
    expect(connect).not.toHaveBeenCalled();
    expect(lifecycle.state).toBe('stopped');
  });

  it('an old start settling after stop cannot mark a new pending connection open', async () => {
    const lifecycle = createEndpointLifecycle({ name: 'restart-during-connect' });
    const first = createVirtualConnect();
    const second = createVirtualConnect();
    const oldStart = lifecycle.start(first.connect);
    await flush();
    const stopping = lifecycle.stop();
    const newStart = lifecycle.start(second.connect);
    await stopping;
    await oldStart;
    expect(lifecycle.state).toBe('connecting');
    first.connections[0]!.resolve();
    await flush();
    expect(lifecycle.state).toBe('connecting');
    second.connections[0]!.resolve();
    await newStart;
    expect(lifecycle.state).toBe('open');
    await lifecycle.stop();
  });

  it('closes a resource registered after stop while connection setup was awaiting', async () => {
    const lifecycle = createEndpointLifecycle({ name: 'late-cleanup' });
    const { connect, connections } = createVirtualConnect();
    const starting = lifecycle.start(connect);
    await flush();
    await lifecycle.stop();
    await starting;
    const close = vi.fn();
    connections[0]!.handle.onForceClose(close);
    expect(close).toHaveBeenCalledTimes(1);
    connections[0]!.resolve();
    await flush();
    expect(lifecycle.state).toBe('stopped');
  });

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('start 失败复位回 idle 且不武装重连', async () => {
    const { connect, connections } = createVirtualConnect();
    const lifecycle = createEndpointLifecycle({
      name: 't',
      random: () => 0,
      reconnect: { initialIntervalMs: 1_000, jitterMs: 0 },
    });

    const started = lifecycle.start(connect);
    await flush();
    // open 前先收到 close：仅曾 open 才武装重连，此处不应武装
    connections[0]!.handle.notifyClosed(new Error('refused'));
    connections[0]!.reject(new Error('refused'));
    await expect(started).rejects.toThrow('refused');
    expect(lifecycle.state).toBe('idle');
    expect(lifecycle.started).toBe(false);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(connect).toHaveBeenCalledTimes(1);

    // 复位后允许重试
    const retry = lifecycle.start(connect);
    await flush();
    connections[1]!.resolve();
    await retry;
    expect(lifecycle.state).toBe('open');
    await lifecycle.stop();
  });

  it('open 后 notifyClosed 才按退避序列重连，成功后复位退避', async () => {
    const { connect, connections } = createVirtualConnect();
    const lifecycle = createEndpointLifecycle({
      name: 't',
      random: () => 0,
      reconnect: {
        initialIntervalMs: 1_000,
        multiplier: 2,
        maxIntervalMs: 5_000,
        jitterMs: 0,
      },
    });

    const started = lifecycle.start(connect);
    await flush();
    connections[0]!.resolve();
    await started;
    expect(lifecycle.state).toBe('open');

    connections[0]!.handle.notifyClosed();
    expect(lifecycle.state).toBe('reconnecting');

    // 退避序列：1000 / 2000 / 4000 / 5000(封顶) / 5000
    const delays = [1_000, 2_000, 4_000, 5_000, 5_000];
    for (const delay of delays) {
      const before = connections.length;
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(connect).toHaveBeenCalledTimes(before);
      await vi.advanceTimersByTimeAsync(1);
      expect(connect).toHaveBeenCalledTimes(before + 1);
      connections[before]!.reject(new Error('still down'));
      await flush();
    }

    // 5 次失败后退避到 5000（封顶），第 7 次连接成功：状态回 open，退避计数复位
    await vi.advanceTimersByTimeAsync(5_000);
    expect(connect).toHaveBeenCalledTimes(7);
    connections[6]!.resolve();
    await flush();
    expect(lifecycle.state).toBe('open');

    // 再次断开：退避从 initial 重新开始
    connections[6]!.handle.notifyClosed();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(connect).toHaveBeenCalledTimes(8);
    connections[7]!.resolve();
    await flush();
    expect(lifecycle.state).toBe('open');
    await lifecycle.stop();
  });

  it('jitter 由 random 注入叠加在退避上', async () => {
    const { connect, connections } = createVirtualConnect();
    const lifecycle = createEndpointLifecycle({
      name: 't',
      random: () => 0.5,
      reconnect: { initialIntervalMs: 1_000, multiplier: 1, jitterMs: 200 },
    });
    const started = lifecycle.start(connect);
    await flush();
    connections[0]!.resolve();
    await started;
    connections[0]!.handle.notifyClosed();

    await vi.advanceTimersByTimeAsync(1_099);
    expect(connect).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(connect).toHaveBeenCalledTimes(2);
    connections[1]!.resolve();
    await flush();
    await lifecycle.stop();
  });

  it('stop 后不重连：武装前 stop、武装后 stop 均静默', async () => {
    const { connect, connections } = createVirtualConnect();
    const lifecycle = createEndpointLifecycle({
      name: 't',
      random: () => 0,
      reconnect: { initialIntervalMs: 1_000, jitterMs: 0 },
    });
    const started = lifecycle.start(connect);
    await flush();
    connections[0]!.resolve();
    await started;

    // 武装后、timer 触发前 stop
    connections[0]!.handle.notifyClosed();
    expect(lifecycle.state).toBe('reconnecting');
    await lifecycle.stop();
    expect(lifecycle.state).toBe('stopped');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(connect).toHaveBeenCalledTimes(1);

    // stop 后迟到的 close 一律忽略
    connections[0]!.handle.notifyClosed();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(lifecycle.state).toBe('stopped');
  });

  it('stop-during-connect：start 静默 settle，连接迟到成功也不复活', async () => {
    const { connect, connections } = createVirtualConnect();
    const lifecycle = createEndpointLifecycle({
      name: 't',
      random: () => 0,
      reconnect: { initialIntervalMs: 1_000, jitterMs: 0 },
    });
    const started = lifecycle.start(connect);
    await flush();
    expect(lifecycle.state).toBe('connecting');

    await lifecycle.stop();
    await expect(started).resolves.toBeUndefined();
    expect(lifecycle.state).toBe('stopped');

    // 迟到的 open / close 不改变终态，也不武装重连
    connections[0]!.resolve();
    connections[0]!.handle.notifyClosed();
    await flush();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(lifecycle.state).toBe('stopped');
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('陈旧句柄的 notifyClosed 不武装重连（防叠套）', async () => {
    const { connect, connections } = createVirtualConnect();
    const lifecycle = createEndpointLifecycle({
      name: 't',
      random: () => 0,
      reconnect: { initialIntervalMs: 1_000, jitterMs: 0 },
    });
    const started = lifecycle.start(connect);
    await flush();
    connections[0]!.resolve();
    await started;

    connections[0]!.handle.notifyClosed();
    await vi.advanceTimersByTimeAsync(1_000);
    connections[1]!.resolve();
    await flush();
    expect(lifecycle.state).toBe('open');

    // 旧连接的迟到 close：state 保持 open，不再调度
    connections[0]!.handle.notifyClosed();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(lifecycle.state).toBe('open');
    expect(connect).toHaveBeenCalledTimes(2);
    await lifecycle.stop();
  });

  it('重连循环进行中重复 notifyClosed 不产生第二条循环', async () => {
    const { connect, connections } = createVirtualConnect();
    const lifecycle = createEndpointLifecycle({
      name: 't',
      random: () => 0,
      reconnect: { initialIntervalMs: 1_000, jitterMs: 0 },
    });
    const started = lifecycle.start(connect);
    await flush();
    connections[0]!.resolve();
    await started;

    connections[0]!.handle.notifyClosed();
    // 重连中重试连接失败前又收到 close（state 非 open，应忽略）
    await vi.advanceTimersByTimeAsync(500);
    connections[0]!.handle.notifyClosed();
    await vi.advanceTimersByTimeAsync(500);
    expect(connect).toHaveBeenCalledTimes(2);
    connections[1]!.resolve();
    await flush();
    expect(lifecycle.state).toBe('open');
    await lifecycle.stop();
  });

  it('心跳看门狗：连续 N 轮无回包后主动强关，ack 复位计数', async () => {
    const { connect, connections } = createVirtualConnect();
    const forceClose = vi.fn();
    const lifecycle = createEndpointLifecycle({
      name: 't',
      random: () => 0,
      reconnect: false,
      heartbeat: { watchdogMisses: 2 },
    });
    const started = lifecycle.start(connect);
    await flush();
    connections[0]!.handle.onForceClose(forceClose);
    connections[0]!.resolve();
    await started;

    const beat = vi.fn();
    lifecycle.startHeartbeat(beat, 1_000);

    await vi.advanceTimersByTimeAsync(1_000); // miss 1
    expect(beat).toHaveBeenCalledTimes(1);
    lifecycle.notifyHeartbeatAck(); // 喂狗复位
    await vi.advanceTimersByTimeAsync(2_000); // miss 1、2
    expect(beat).toHaveBeenCalledTimes(3);
    expect(forceClose).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000); // miss 3 > 2 → 强关
    expect(forceClose).toHaveBeenCalledTimes(1);
    expect(beat).toHaveBeenCalledTimes(3);

    // 看门狗触发后心跳已停
    await vi.advanceTimersByTimeAsync(5_000);
    expect(beat).toHaveBeenCalledTimes(3);
    await lifecycle.stop();
  });

  it('close 清心跳，stop 集中清理全部定时器', async () => {
    const { connect, connections } = createVirtualConnect();
    const lifecycle = createEndpointLifecycle({
      name: 't',
      random: () => 0,
      reconnect: { initialIntervalMs: 10_000, jitterMs: 0 },
    });
    const started = lifecycle.start(connect);
    await flush();
    connections[0]!.resolve();
    await started;

    const beat = vi.fn();
    lifecycle.startHeartbeat(beat, 1_000);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(beat).toHaveBeenCalledTimes(2);

    // close 清心跳：重连等待期间不再 beat
    connections[0]!.handle.notifyClosed();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(beat).toHaveBeenCalledTimes(2);

    // stop 清理重连 timer
    await lifecycle.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('reconnect: false 时对端断开进入 closed 终态', async () => {
    const { connect, connections } = createVirtualConnect();
    const lifecycle = createEndpointLifecycle({ name: 't', reconnect: false });
    const started = lifecycle.start(connect);
    await flush();
    connections[0]!.resolve();
    await started;

    connections[0]!.handle.notifyClosed();
    expect(lifecycle.state).toBe('closed');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('maxAttempts 耗尽后进入 closed 终态', async () => {
    const { connect, connections } = createVirtualConnect();
    const lifecycle = createEndpointLifecycle({
      name: 't',
      random: () => 0,
      reconnect: { initialIntervalMs: 1_000, multiplier: 1, jitterMs: 0, maxAttempts: 2 },
    });
    const started = lifecycle.start(connect);
    await flush();
    connections[0]!.resolve();
    await started;

    connections[0]!.handle.notifyClosed();
    await vi.advanceTimersByTimeAsync(1_000);
    connections[1]!.reject(new Error('down'));
    await flush();
    await vi.advanceTimersByTimeAsync(1_000);
    connections[2]!.reject(new Error('down'));
    await flush();
    expect(lifecycle.state).toBe('closed');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(connect).toHaveBeenCalledTimes(3);
  });

  it('重复 start 幂等', async () => {
    const { connect, connections } = createVirtualConnect();
    const lifecycle = createEndpointLifecycle({ name: 't' });
    const first = lifecycle.start(connect);
    const second = lifecycle.start(connect);
    await flush();
    connections[0]!.resolve();
    await Promise.all([first, second]);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(lifecycle.state).toBe('open');
    await lifecycle.stop();
  });
});
