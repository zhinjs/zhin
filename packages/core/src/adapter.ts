import { Bot } from "./bot.js";
import { Plugin } from "./plugin.js";
import { EventEmitter } from "events";
import { Message } from "./message.js";
import { Notice } from "./notice.js";
import { Request } from "./request.js";
import { BeforeSendHandler, SendOptions } from "./types.js";
import { segment } from "./utils.js";
/**
 * Adapter类：适配器抽象，管理多平台Bot实例。
 * 负责根据配置启动/关闭各平台机器人，统一异常处理。
 * 
 * 适配器可以提供 AI 工具，供 AI 服务调用。
 */
export abstract class Adapter<R extends Bot = Bot> extends EventEmitter<Adapter.Lifecycle> {
  /** 当前适配器下所有Bot实例，key为bot名称 */
  public bots: Map<string, R> = new Map<string, R>();

  /** 入站消息并发计数 */
  #pendingMessages = 0;
  /** 并发上限，0 表示不限制（默认） */
  static DEFAULT_MAX_CONCURRENT_MESSAGES = 0;

  get maxConcurrentMessages(): number {
    try {
      const configService = this.plugin?.root?.inject('config') as any;
      const appConfig = configService?.get?.('zhin.config.yml');
      return appConfig?.max_concurrent_messages ?? Adapter.DEFAULT_MAX_CONCURRENT_MESSAGES;
    } catch {
      return Adapter.DEFAULT_MAX_CONCURRENT_MESSAGES;
    }
  }

  /** 当前正在处理的消息数 */
  get pendingMessages(): number {
    return this.#pendingMessages;
  }

  /**
   * 构造函数
   * @param name 适配器名称（如 'process'、'qq' 等）
   * @param botFactory Bot工厂函数或构造器
   */
  constructor(
    public plugin: Plugin,
    public name: keyof Plugin.Contexts,
    public config: Adapter.BotConfig<R>[]
  ) {
    super();
    this.on('call.recallMessage', async(bot_id, id) => {
      const bot = this.bots.get(bot_id);
      if(!bot) throw new Error(`Bot ${bot_id} not found`);
      this.logger.info(`${bot_id} recall ${id}`);
      await bot.$recallMessage(id);
    })
  }

  /**
   * 重写 emit：拦截 message.receive 事件，按架构规定的入站流程处理
   * 入站消息链：adapter.emit → dispatcher.dispatch → plugin.dispatch('message.receive') → adapter observers
   *
   * 以属性 + `EventEmitter.prototype.emit` 调用满足 Node @types 25 对泛型 `emit` 的可赋值检查。
   */
  override emit: EventEmitter<Adapter.Lifecycle>['emit'] = ((
    event: string | symbol,
    ...args: unknown[]
  ): boolean => {
    if (event !== 'message.receive') {
      return EventEmitter.prototype.emit.call(this, event, ...args);
    }
    const message = args[0] as Message;
    this.logger.info(`${message.$bot} recv ${message.$channel.type}(${message.$channel.id}):${segment.raw(message.$content)}`);

    // 背压控制：limit > 0 时启用，超出并发上限丢弃消息并告警
    const limit = this.maxConcurrentMessages;
    if (limit > 0 && this.#pendingMessages >= limit) {
      this.logger.warn(`message dropped: concurrency limit reached (${limit})`);
      return false;
    }

    this.#pendingMessages++;
    // 异步执行入站消息处理链
    const processing = async () => {
      // Step 1: 如果有 Dispatcher，先通过它
      const dispatcher = this.plugin?.inject('dispatcher');
      if (dispatcher && typeof dispatcher.dispatch === 'function') {
        await dispatcher.dispatch(message);
      }
      // Step 2: 触发插件生命周期事件
      this.plugin?.dispatch('message.receive', message);
      // Step 3: 通知 adapter.on('message.receive') 观察者
      EventEmitter.prototype.emit.call(this, event, ...args);
    };

    processing().catch((e) => {
      this.logger.warn(`message.receive handling error: ${e instanceof Error ? e.message : String(e)}`);
    }).finally(() => {
      this.#pendingMessages--;
    });
    return true;
  }) as EventEmitter<Adapter.Lifecycle>['emit'];
  abstract createBot(config: Adapter.BotConfig<R>): R;
  get logger() {
    if(!this.plugin) throw new Error("Adapter is not associated with any plugin");
    return this.plugin.logger;
  }
  binding(plugin: Plugin) {
    this.plugin = plugin;
  }
  private async renderSendMessage(options:SendOptions):Promise<SendOptions>{
    const fns=this.plugin.root.listeners('before.sendMessage') as BeforeSendHandler[];
    for(const fn of fns){
      const result=await fn(options);
      if(result) options=result;
    }
    return options;
  }
  async sendMessage(options:SendOptions):Promise<string>{
    options=await this.renderSendMessage(options);
    const bot = this.bots.get(options.bot);
    if(!bot) throw new Error(`Bot ${options.bot} not found`);
    this.logger.info(`${options.bot} send ${options.type}(${options.id}):${segment.raw(options.content)}`);
    return await bot.$sendMessage(options);
  }
  async start() {
    const rootAdapters = this.plugin.root.adapters;
    if (!rootAdapters.some((n) => String(n) === String(this.name))) {
      rootAdapters.push(this.name);
    }
    if (!this.config?.length) return;

    for (const config of this.config) {
      const bot = this.createBot(config);
      await bot.$connect();
      this.logger.debug(`bot ${bot.$id} of adapter ${this.name} connected`);
      this.bots.set(bot.$id, bot);
    }
    this.logger.debug(`adapter ${this.name} started`);
  }
  /**
   * 停止适配器，断开并移除所有Bot实例
   * @param plugin 所属插件实例
   */
  async stop() {
    const errors: Error[] = [];
    for (const [id, bot] of this.bots) {
      try {
        await bot.$disconnect();
        this.logger.debug(`bot ${id} of adapter ${this.name} disconnected`);
      } catch (error) {
        errors.push(error instanceof Error ? error : new Error(String(error)));
        this.logger.error(`bot ${id} of adapter ${this.name} disconnect failed:`, error);
      }
    }
    // 无论是否有错误，始终完成清理
    this.bots.clear();
    
    // 从 adapters 数组中移除（可能因重复 start 出现多条同名，需全部删掉）
    const rootAdapters = this.plugin.root.adapters;
    for (let i = rootAdapters.length - 1; i >= 0; i--) {
      if (rootAdapters[i] === this.name) rootAdapters.splice(i, 1);
    }
    
    // 移除所有事件监听器
    this.removeAllListeners();
    
    this.logger.info(`adapter ${this.name} stopped`);
    
    if (errors.length) {
      throw new AggregateError(errors, `adapter ${this.name}: ${errors.length} bot(s) failed to disconnect`);
    }
  }
}
export interface Adapters {}
export namespace Adapter {
  export type Factory<R extends Adapter = Adapter> = {
    new (
    plugin: Plugin,
    name: string,
    config: Adapter.BotConfig<Adapter.InferBot<R>>[]
  ):R
  };
  export interface Lifecycle {
    'message.receive': [Message];
    'message.private.receive': [Message];
    'message.group.receive': [Message];
    'message.channel.receive': [Message];
    'notice.receive': [Notice];
    'request.receive': [Request];
    'call.recallMessage': [string, string];
  }
  /**
   * 适配器工厂注册表
   * 灵感来源于 zhinjs/next 的 Adapter.Registry
   */
  export const Registry = new Map<string, Factory>();
  export type InferBot<R extends Adapter=Adapter> = R extends Adapter<infer T>
    ? T
    : never;
  export type BotConfig<T extends Bot> = T extends Bot<infer R> ? R : never;
  export type BotMessage<T extends Bot> = T extends Bot<infer _L, infer R>
    ? R
    : never;
  /**
   * 注册适配器工厂
   *
   * @param name 适配器名称
   * @param factory 适配器工厂函数
   * @example
   * ```typescript
   * Adapter.register('icqq', IcqqAdapter);
   * ```
   */
  export function register(name: string, factory: Factory) {
    Registry.set(name, factory);
  }
}
