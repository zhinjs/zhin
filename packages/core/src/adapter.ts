import { Bot } from "./bot.js";
import { Plugin } from "./plugin.js";
import { EventEmitter } from "events";
import { Message } from "./message.js";
import { SendOptions } from "./types.js";
import { segment } from "./utils.js";
/**
 * Adapter类：适配器抽象，管理多平台Bot实例。
 * 负责根据配置启动/关闭各平台机器人，统一异常处理。
 */
export abstract class Adapter<R extends Bot = Bot> extends EventEmitter<Adapter.Lifecycle> {
  /** 当前适配器下所有Bot实例，key为bot名称 */
  public bots: Map<string, R> = new Map<string, R>();
  /**
   * 构造函数
   * @param name 适配器名称（如 'process'、'qq' 等）
   * @param botFactory Bot工厂函数或构造器
   */
  constructor(
    public plugin: Plugin,
    public name: string,
    public config: Adapter.BotConfig<R>[]
  ) {
    super();
    this.on('call.recallMessage', async(bot_id, id) => {
      const bot = this.bots.get(bot_id);
      if(!bot) throw new Error(`Bot ${bot_id} not found`);
      await bot.$recallMessage(id);
    })
    this.on('call.sendMessage', async(bot_id:string,options:SendOptions) => {
      const bot = this.bots.get(bot_id);
      if(!bot) throw new Error(`Bot ${bot_id} not found`);
      return await bot.$sendMessage(options);
    });
    this.on('message.receive', (message) => {
      this.logger.info(`${this.name} recv ${message.$channel.type}(${message.$channel.id}):${segment.raw(message.$content)}`);
      this.plugin?.middleware(message, async ()=>{});
    });
  }
  abstract createBot(config: Adapter.BotConfig<R>): R;
  get logger() {
    if(!this.plugin) throw new Error("Adapter is not associated with any plugin");
    return this.plugin.logger;
  }
  binding(plugin: Plugin) {
    this.plugin = plugin;
  }
  async start() {
    if (!this.config?.length) return;
    for (const config of this.config) {
      const bot = this.createBot(config);
      await bot.$connect();
      this.logger.info(`bot ${bot.$id} of adapter ${this.name} connected`);
      this.bots.set(bot.$id, bot);
    }
    this.logger.info(`adapter ${this.name} started`);
  }
  /**
   * 停止适配器，断开并移除所有Bot实例
   * @param plugin 所属插件实例
   */
  async stop() {
    try {
      for (const [id, bot] of this.bots) {
        try {
          await bot.$disconnect();
          this.logger.info(`bot ${id} of adapter ${this.name} disconnected`);
          this.bots.delete(id);
        } catch (error) {
          // 如果断开连接失败，确保错误正确传播
          throw error;
        }
      }
      this.logger.info(`adapter ${this.name} stopped`);
    } catch (error) {
      // 确保错误正确传播
      throw error;
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
    'call.recallMessage': [string, string];
    'call.sendMessage': [string, SendOptions];
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
