/**
 * EndpointLifecycle — WS/SSE 长连接端点生命周期基座。
 *
 * 把 napcat / milky / onebot11·12 各自重复实现（且重复犯错）的状态机收敛为一处：
 *
 * 状态机：idle → connecting → open → reconnecting → open … → stopped / closed
 *
 * - start(connectFn)：连接失败自动复位回 idle 且不武装重连（start 的 catch 语义）；
 *   stop-during-connect 竞态时 start() 静默 settle（视为主动停止，不抛错）。
 * - stop()：主动断开，清全部定时器、调用已注册的强关函数、唤醒所有竞态等待，绝不重连。
 * - handle.notifyClosed()：对端断开（ws close / SSE 流结束）时由适配器调用；
 *   仅在连接曾 open 时才按指数退避 + jitter 武装重连，初始连接失败不武装。
 * - startHeartbeat(fn, interval)：心跳 + 看门狗——连续 N 轮无回包（notifyHeartbeatAck
 *   未复位计数）时主动调用 onForceClose 注册的强关函数，由底层 close 事件驱动重连。
 * - 定时器集中管理：重连 timer 与心跳 timer 均在 close / stop / 看门狗触发时清理。
 *
 * 防叠套：重连循环单例（#reconnectRunning），且每次 connect 尝试递增 generation，
 * 陈旧连接句柄的 notifyClosed / onForceClose 一律忽略。
 *
 * 迁移指引（以 napcat/milky/onebot WS endpoint 为例）：
 * 1. 删除 #started / #stopping / #reconnectTimer / #heartbeatTimer / opened 旗标，
 *    构造器里 `this.#lifecycle = createEndpointLifecycle({ name: config.id, reconnect, heartbeat })`。
 * 2. `start()` 改为：
 *    ```ts
 *    this.#unregisterAgent = registerXxxAgentEndpoint(name, this); // agent 注册仍在适配器侧
 *    try {
 *      await this.#lifecycle.start(async (handle) => {
 *        this.#handle = handle; // 供 ws 'close' 回调引用
 *        await new Promise<void>((resolve, reject) => {
 *          const ws = createWebSocket(...); this.#ws = ws;
 *          ws.on('open', () => { this.#lifecycle.startHeartbeat(() => beat(), interval); resolve(); });
 *          ws.on('close', (code, reason) => { handle.notifyClosed(...); rejectIfNotSettled(...); });
 *          ws.on('error', (err) => rejectIfNotSettled(err));
 *        });
 *      });
 *    } catch (err) {
 *      this.#unregisterAgent?.(); this.#unregisterAgent = undefined; // 反注册对称
 *      throw err;
 *    }
 *    ```
 *    start 失败复位由基座保证；agent 注册/反注册是适配器专有依赖，刻意不收入基座。
 * 3. `stop()` 改为：先 `await this.#lifecycle.stop()`（清定时器 + 强关 ws + 竞态 settle），
 *    再做适配器专有清理（rejectAllPending、deduper.clear、agent 反注册）。
 * 4. `handle.onForceClose(() => this.#ws?.close())` 在每次拿到新 socket 后注册，
 *    供心跳看门狗主动断开；ws 'message'/'pong' 回调里调 `notifyHeartbeatAck()` 喂狗。
 * 5. 退避参数由配置映射：reconnect_interval → initialIntervalMs，可按需覆盖
 *    multiplier / maxIntervalMs / jitterMs / maxAttempts；重连成功后退避自动复位。
 */
// 使用全局定时器（而非 node:timers 导入）：vitest fake timers 只接管全局绑定，
// 这样单测可用 vi.useFakeTimers 驱动退避/心跳。
import { formatCompact, getLogger } from '@zhin.js/logger';

const logger = getLogger('adapter');

export type EndpointLifecycleState =
  | 'idle'
  | 'connecting'
  | 'open'
  | 'reconnecting'
  | 'closed'
  | 'stopped';

export interface EndpointLifecycleReconnectOptions {
  /** 首次重连间隔（ms），默认 5000。 */
  readonly initialIntervalMs?: number;
  /** 退避倍数，默认 2（1 = 固定间隔，兼容旧 reconnect_interval 语义）。 */
  readonly multiplier?: number;
  /** 退避封顶（ms），默认 60000。 */
  readonly maxIntervalMs?: number;
  /** 每次重连附加的随机抖动上限（ms），默认 250；测试可配 random 使其确定。 */
  readonly jitterMs?: number;
  /** 最大连续重连失败次数，默认 Infinity；耗尽后进入 closed 终态。 */
  readonly maxAttempts?: number;
}

export interface EndpointLifecycleHeartbeatOptions {
  /** startHeartbeat 缺省间隔（ms），默认 30000；<=0 表示不开心跳。 */
  readonly intervalMs?: number;
  /**
   * 看门狗轮数：连续 N 次心跳未收到回包（notifyHeartbeatAck）后，
   * 下一心跳周期主动调用强关函数。默认 0 = 关闭看门狗。
   */
  readonly watchdogMisses?: number;
}

export interface EndpointLifecycleOptions {
  /** 端点名，仅用于日志字段。 */
  readonly name: string;
  /** 重连配置；传 false 禁用自动重连（对端断开后进入 closed）。 */
  readonly reconnect?: EndpointLifecycleReconnectOptions | false;
  /** 心跳配置。 */
  readonly heartbeat?: EndpointLifecycleHeartbeatOptions;
  /** 随机源（jitter 用），默认 Math.random；测试注入 () => 0 获得确定退避序列。 */
  readonly random?: () => number;
}

/**
 * 每次 connect 尝试获得一个句柄；generation 过期后其方法自动失效，
 * 因此适配器无需担心旧 socket 的迟到事件污染新连接。
 */
export interface EndpointConnectHandle {
  /**
   * 底层连接关闭（对端断开 / 看门狗强关 / 任意 close 事件）时调用。
   * 仅当本次连接曾 open（即 connectFn 已 resolve）才武装退避重连；
   * 初始连接失败由 start() 的拒绝路径复位，不武装重连。
   */
  notifyClosed(reason?: unknown): void;
  /** 注册当前连接的强制关闭函数（心跳看门狗与 stop 使用）；每次 connect 覆盖。 */
  onForceClose(close: () => void): void;
}

export type EndpointConnectFn = (handle: EndpointConnectHandle) => Promise<void>;

export interface EndpointLifecycle {
  readonly state: EndpointLifecycleState;
  /** start 已成功且未 stop（含 connecting / open / reconnecting）。 */
  readonly started: boolean;
  /**
   * 启动并建立首连。重复调用幂等（进行中/已连接时直接返回）。
   * connectFn 须在连接 open 时 resolve、失败或 open 前 close 时 reject；
   * stop-during-connect 时本方法静默 resolve（主动停止不算失败）。
   */
  start(connect: EndpointConnectFn): Promise<void>;
  /** 主动停止：清全部定时器、强关连接、唤醒竞态等待；幂等，绝不触发重连。 */
  stop(): Promise<void>;
  /** 启动心跳；重复调用先清旧 timer。intervalMs 缺省取配置，<=0 不开。 */
  startHeartbeat(beat: () => void, intervalMs?: number): void;
  /** 清理心跳 timer（close / stop / 看门狗触发时基座会自动调用）。 */
  stopHeartbeat(): void;
  /** 喂狗：收到任何回包（message / pong / 心跳响应）时调用，复位看门狗计数。 */
  notifyHeartbeatAck(): void;
}

interface ResolvedReconnectOptions {
  readonly initialIntervalMs: number;
  readonly multiplier: number;
  readonly maxIntervalMs: number;
  readonly jitterMs: number;
  readonly maxAttempts: number;
}

const DEFAULT_RECONNECT: ResolvedReconnectOptions = {
  initialIntervalMs: 5_000,
  multiplier: 2,
  maxIntervalMs: 60_000,
  jitterMs: 250,
  maxAttempts: Number.POSITIVE_INFINITY,
};

const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;

class EndpointLifecycleImpl implements EndpointLifecycle {
  readonly #name: string;
  readonly #reconnect: ResolvedReconnectOptions | false;
  readonly #heartbeat: Required<EndpointLifecycleHeartbeatOptions>;
  readonly #random: () => number;
  #state: EndpointLifecycleState = 'idle';
  #connect?: EndpointConnectFn;
  /** 每次 connect 尝试 +1，识别陈旧句柄。 */
  #generation = 0;
  /** 连续重连失败计数，open 成功后复位。 */
  #attempt = 0;
  /** 重连循环单例旗标（防叠套）。 */
  #reconnectRunning = false;
  #reconnectTimer?: NodeJS.Timeout;
  #reconnectWake?: (elapsed: boolean) => void;
  #heartbeatTimer?: NodeJS.Timeout;
  #heartbeatMisses = 0;
  #forceClose?: () => void;
  /** stop() 时唤醒的竞态等待（start / 重连中的 connect 尝试）。 */
  #stopWaiters: Array<() => void> = [];

  constructor(options: EndpointLifecycleOptions) {
    this.#name = options.name;
    this.#reconnect = options.reconnect === false
      ? false
      : { ...DEFAULT_RECONNECT, ...options.reconnect };
    this.#heartbeat = {
      intervalMs: options.heartbeat?.intervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS,
      watchdogMisses: options.heartbeat?.watchdogMisses ?? 0,
    };
    this.#random = options.random ?? Math.random;
  }

  get state(): EndpointLifecycleState {
    return this.#state;
  }

  /**
   * 并发安全的状态读取：stop() 可能在任意 await 点并发改写 #state，
   * 经方法调用读取可避免 TS 对字段/getter 的控制流窄化误判（TS2367）。
   */
  #currentState(): EndpointLifecycleState {
    return this.#state;
  }

  get started(): boolean {
    return this.#state === 'connecting' || this.#state === 'open' || this.#state === 'reconnecting';
  }

  async start(connect: EndpointConnectFn): Promise<void> {
    if (this.started) return;
    this.#connect = connect;
    this.#state = 'connecting';
    this.#attempt = 0;
    try {
      await this.#runConnect(connect);
    } catch (err) {
      // 注意：stop() 可能在 await 期间并发改写 #state，必须经 getter 读取避免 TS 窄化误判
      if (this.#currentState() === 'stopped') return; // stop-during-connect 竞态：静默 settle
      // start 失败复位：回 idle、不武装重连，允许调用方重试
      this.#state = 'idle';
      throw err;
    }
    if (this.#currentState() === 'stopped') return; // stop 竞态先于 open
    this.#state = 'open';
  }

  async stop(): Promise<void> {
    const wasActive = this.#state !== 'stopped';
    this.#state = 'stopped';
    this.#attempt = 0;
    this.stopHeartbeat();
    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = undefined;
    }
    this.#reconnectWake?.(false);
    this.#reconnectWake = undefined;
    for (const wake of this.#stopWaiters.splice(0)) wake();
    const close = this.#forceClose;
    this.#forceClose = undefined;
    if (close) {
      try {
        close();
      } catch {
        /* ignore */
      }
    }
    if (wasActive) {
      logger.debug(formatCompact({ op: 'disconnect', endpoint: this.#name }));
    }
  }

  startHeartbeat(beat: () => void, intervalMs = this.#heartbeat.intervalMs): void {
    this.stopHeartbeat();
    if (intervalMs <= 0) return;
    const watchdogMisses = this.#heartbeat.watchdogMisses;
    this.#heartbeatMisses = 0;
    this.#heartbeatTimer = setInterval(() => {
      if (watchdogMisses > 0) {
        this.#heartbeatMisses += 1;
        if (this.#heartbeatMisses > watchdogMisses) {
          this.stopHeartbeat();
          logger.warn(formatCompact({
            op: 'heartbeat_watchdog',
            endpoint: this.#name,
            ok: false,
            misses: this.#heartbeatMisses,
          }));
          const close = this.#forceClose;
          if (close) {
            try {
              close();
            } catch {
              /* ignore */
            }
          }
          return;
        }
      }
      try {
        beat();
      } catch (err) {
        logger.warn(formatCompact({
          op: 'heartbeat',
          endpoint: this.#name,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        }));
      }
    }, intervalMs);
  }

  stopHeartbeat(): void {
    if (this.#heartbeatTimer) {
      clearInterval(this.#heartbeatTimer);
      this.#heartbeatTimer = undefined;
    }
    this.#heartbeatMisses = 0;
  }

  notifyHeartbeatAck(): void {
    this.#heartbeatMisses = 0;
  }

  #createHandle(generation: number): EndpointConnectHandle {
    return {
      notifyClosed: (reason) => {
        if (generation !== this.#generation) return; // 陈旧连接的迟到事件
        this.#forceClose = undefined;
        this.stopHeartbeat(); // close 清心跳
        // 仅曾 open 的连接才武装重连；初始连接失败由 start() 的 catch 复位
        if (this.#state !== 'open') return;
        logger.warn(formatCompact({
          op: 'disconnect',
          endpoint: this.#name,
          ok: false,
          error: reason instanceof Error ? reason.message : reason != null ? String(reason) : 'closed',
        }));
        if (!this.#reconnect) {
          this.#state = 'closed';
          return;
        }
        this.#state = 'reconnecting';
        this.#scheduleReconnect();
      },
      onForceClose: (close) => {
        if (generation === this.#generation) this.#forceClose = close;
      },
    };
  }

  /** 跑一次 connect 尝试；与 stop 信号竞态，stop 先到则静默返回。 */
  async #runConnect(connect: EndpointConnectFn): Promise<void> {
    const generation = ++this.#generation;
    this.#forceClose = undefined;
    const handle = this.#createHandle(generation);
    // Promise.resolve().then 兜底同步抛错；额外 catch 防止 stop 竞态后迟到拒绝变 unhandled
    const connecting = Promise.resolve().then(() => connect(handle));
    connecting.catch(() => { /* settled via race; late rejection ignored */ });
    let wake!: () => void;
    const stopped = new Promise<void>((resolve) => {
      wake = resolve;
    });
    this.#stopWaiters.push(wake);
    try {
      await Promise.race([connecting, stopped]);
    } finally {
      const index = this.#stopWaiters.indexOf(wake);
      if (index >= 0) this.#stopWaiters.splice(index, 1);
    }
  }

  /** 武装重连循环（单例，防叠套）。 */
  #scheduleReconnect(): void {
    if (this.#reconnectRunning) return;
    this.#reconnectRunning = true;
    void this.#reconnectLoop().finally(() => {
      this.#reconnectRunning = false;
    });
  }

  async #reconnectLoop(): Promise<void> {
    const config = this.#reconnect;
    const connect = this.#connect;
    if (!config || !connect) return;
    while (this.#state === 'reconnecting') {
      if (this.#attempt >= config.maxAttempts) {
        this.#state = 'closed';
        logger.warn(formatCompact({
          op: 'reconnect',
          endpoint: this.#name,
          ok: false,
          error: `gave up after ${this.#attempt} attempts`,
        }));
        return;
      }
      const base = Math.min(
        config.initialIntervalMs * config.multiplier ** this.#attempt,
        config.maxIntervalMs,
      );
      const delay = base + Math.floor(this.#random() * config.jitterMs);
      // 首次断开 WARN，后续重试静默为 DEBUG，避免刷屏（对齐 icqq）
      const log = this.#attempt === 0 ? logger.warn.bind(logger) : logger.debug.bind(logger);
      log(formatCompact({
        op: 'reconnect',
        endpoint: this.#name,
        delay_ms: delay,
        attempt: this.#attempt + 1,
      }));
      const elapsed = await this.#sleep(delay);
      if (!elapsed || this.#currentState() !== 'reconnecting') return;
      try {
        await this.#runConnect(connect);
      } catch (err) {
        if (this.#currentState() === 'stopped') return;
        this.#attempt += 1;
        logger.debug(formatCompact({
          op: 'reconnect',
          endpoint: this.#name,
          ok: false,
          attempt: this.#attempt,
          error: err instanceof Error ? err.message : String(err),
        }));
        continue;
      }
      if (this.#currentState() === 'stopped') return;
      this.#state = 'open';
      this.#attempt = 0;
      logger.info(formatCompact({ op: 'reconnect', endpoint: this.#name, ok: true }));
      return;
    }
  }

  /** 可中断 sleep：stop() 唤醒并返回 false。 */
  #sleep(ms: number): Promise<boolean> {
    return new Promise((resolve) => {
      this.#reconnectTimer = setTimeout(() => {
        this.#reconnectTimer = undefined;
        this.#reconnectWake = undefined;
        resolve(true);
      }, ms);
      this.#reconnectWake = resolve;
    });
  }
}

/** 创建端点生命周期基座实例（见文件头迁移指引）。 */
export function createEndpointLifecycle(options: EndpointLifecycleOptions): EndpointLifecycle {
  return new EndpointLifecycleImpl(options);
}
