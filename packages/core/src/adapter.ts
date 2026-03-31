import { Bot } from "./bot.js";
import { Plugin } from "./plugin.js";
import { EventEmitter } from "events";
import { Message } from "./message.js";
import { BeforeSendHandler, SendOptions, AITool, ToolContext } from "./types.js";
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
  /** 适配器提供的 AI 工具 */
  public tools: Map<string, AITool> = new Map<string, AITool>();
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
   */
  emit<K extends keyof Adapter.Lifecycle>(event: K, ...args: Adapter.Lifecycle[K]): boolean {
    if (event !== 'message.receive') {
      return super.emit(event, ...args as any);
    }
    const message = args[0] as Message;
    this.logger.info(`${message.$bot} recv ${message.$channel.type}(${message.$channel.id}):${segment.raw(message.$content)}`);
    // 异步执行入站消息处理链
    (async () => {
      // Step 1: 如果有 Dispatcher，先通过它
      const dispatcher = this.plugin?.inject('dispatcher');
      if (dispatcher && typeof dispatcher.dispatch === 'function') {
        await dispatcher.dispatch(message);
      }
      // Step 2: 触发插件生命周期事件
      this.plugin?.dispatch('message.receive', message);
      // Step 3: 通知 adapter.on('message.receive') 观察者
      super.emit(event, ...args as any);
    })().catch((e) => {
      this.logger.warn(`message.receive handling error: ${e instanceof Error ? e.message : String(e)}`);
    });
    return true;
  }
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
    this.plugin.root.adapters.push(this.name);
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
    try {
      for (const [id, bot] of this.bots) {
        try {
          await bot.$disconnect();
          this.logger.debug(`bot ${id} of adapter ${this.name} disconnected`);
        } catch (error) {
          // 如果断开连接失败，确保错误正确传播
          throw error;
        }
      }
      // 清理 bots Map
      this.bots.clear();
      
      // 从 adapters 数组中移除
      const idx = this.plugin.root.adapters.indexOf(this.name);
      if (idx !== -1) {
        this.plugin.root.adapters.splice(idx, 1);
      }
      
      // 移除所有事件监听器
      this.removeAllListeners();
      
      this.logger.info(`adapter ${this.name} stopped`);
    } catch (error) {
      // 确保错误正确传播
      throw error;
    }
  }
  
  /**
   * 注册 AI 工具
   * @param tool 工具定义
   * @returns 返回一个移除工具的函数
   */
  addTool(tool: AITool): () => void {
    // 自动添加适配器源标识
    const toolWithSource: AITool = {
      ...tool,
      source: tool.source || `adapter:${this.name}`,
      tags: [...(tool.tags || []), 'adapter', this.name],
    };
    this.tools.set(tool.name, toolWithSource);
    return () => {
      this.tools.delete(tool.name);
    };
  }
  
  /**
   * 获取所有注册的工具
   * @returns 工具数组
   */
  getTools(): AITool[] {
    return Array.from(this.tools.values());
  }
  
  /**
   * 根据名称获取工具
   * @param name 工具名称
   * @returns 工具定义或 undefined
   */
  getTool(name: string): AITool | undefined {
    return this.tools.get(name);
  }
  
  /**
   * 提供默认的适配器工具（子类可覆盖）
   * 包含发送消息、撤回消息等基础能力
   */
  protected registerDefaultTools(): void {
    // 发送消息工具
    this.addTool({
      name: `${this.name}_send_message`,
      description: `使用 ${this.name} 适配器发送消息到指定目标`,
      parameters: {
        type: 'object',
        properties: {
          bot: {
            type: 'string',
            description: 'Bot 名称/ID',
          },
          id: {
            type: 'string',
            description: '目标 ID（用户/群/频道）',
          },
          type: {
            type: 'string',
            enum: ['private', 'group', 'channel'],
            description: '消息类型',
          },
          content: {
            type: 'string',
            description: '消息内容',
          },
        },
        required: ['bot', 'id', 'type', 'content'],
      },
      execute: async (args) => {
        const { bot, id, type, content } = args;
        return await this.sendMessage({
          context: this.name,
          bot,
          id,
          type: type as 'private' | 'group' | 'channel',
          content,
        });
      },
    });
    
    // 获取 Bot 列表工具
    this.addTool({
      name: `${this.name}_list_bots`,
      description: `获取 ${this.name} 适配器下所有已连接的 Bot 列表`,
      parameters: {
        type: 'object',
        properties: {},
      },
      execute: async () => {
        return Array.from(this.bots.entries()).map(([id, bot]) => ({
          id,
          connected: bot.$connected,
        }));
      },
    });
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
