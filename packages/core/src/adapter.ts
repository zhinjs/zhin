import { Bot } from "./bot.js";
import { Plugin } from "./plugin.js";
import { EventEmitter } from "events";
import { Message } from "./message.js";
import { BeforeSendHandler, SendOptions, Tool, ToolContext } from "./types.js";
import { segment } from "./utils.js";
import { ZhinTool, isZhinTool, type ToolInput } from "./built/tool.js";
import type { Skill, SkillFeature } from "./built/skill.js";
/**
 * Adapter类：适配器抽象，管理多平台Bot实例。
 * 负责根据配置启动/关闭各平台机器人，统一异常处理。
 * 
 * 适配器可以提供 AI 工具，供 AI 服务调用。
 */
export abstract class Adapter<R extends Bot = Bot> extends EventEmitter<Adapter.Lifecycle> {
  /** 当前适配器下所有Bot实例，key为bot名称 */
  public bots: Map<string, R> = new Map<string, R>();
  /** 适配器提供的工具 */
  public tools: Map<string, Tool> = new Map<string, Tool>();
  /** Skill 注销函数（declareSkill 时设置） */
  private _skillDispose?: () => void;
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
    this.on('message.receive', (message) => {
      this.logger.info(`${message.$bot} recv ${message.$channel.type}(${message.$channel.id}):${segment.raw(message.$content)}`);
      const rootPlugin = this.plugin?.root || this.plugin;
      // 优先使用 MessageDispatcher（新架构），回退到旧中间件链（兼容）
      const dispatcher = rootPlugin?.inject('dispatcher' as any) as any;
      if (dispatcher && typeof dispatcher.dispatch === 'function') {
        dispatcher.dispatch(message);
      } else {
        // 旧中间件链回退
        rootPlugin?.middleware(message, async ()=>{});
      }
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

      // 清理 Skill
      this._skillDispose?.();
      this._skillDispose = undefined;
      
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
   * 注册工具
   * @param input 工具定义（支持 Tool 对象或 ZhinTool 实例）
   * @returns 返回一个移除工具的函数
   */
  addTool(input: ToolInput): () => void {
    // 如果是 ZhinTool 实例，转换为 Tool 对象
    const tool: Tool = isZhinTool(input) ? input.toTool() : input;
    
    // 自动添加适配器源标识
    const toolWithSource: Tool = {
      ...tool,
      source: tool.source || `adapter:${this.name}`,
      tags: [...(tool.tags || []), 'adapter', this.name],
    };
    this.tools.set(tool.name, toolWithSource);

    // 同步到全局 ToolFeature（如果可用），使适配器工具出现在插件 features 统计中
    let globalDispose: (() => void) | undefined;
    const toolFeature = this.plugin?.root?.inject('tool' as any) as any;
    if (toolFeature && typeof toolFeature.addTool === 'function') {
      const adapterPluginName = this.plugin?.name || `adapter:${this.name}`;
      globalDispose = toolFeature.addTool(toolWithSource, adapterPluginName, false);
      // 记录到宿主插件的 feature 贡献
      this.plugin?.recordFeatureContribution('tool', tool.name);
    }

    return () => {
      this.tools.delete(tool.name);
      globalDispose?.();
    };
  }
  
  /**
   * 获取所有注册的工具
   * @returns 工具数组
   */
  getTools(): Tool[] {
    return Array.from(this.tools.values());
  }
  
  /**
   * 根据名称获取工具
   * @param name 工具名称
   * @returns 工具定义或 undefined
   */
  getTool(name: string): Tool | undefined {
    return this.tools.get(name);
  }
  
  /**
   * 声明适配器的 Skill（将 this.tools 聚合为一个 Skill 注册到 SkillFeature）
   *
   * @param metadata Skill 元数据
   *   - description: 平台级能力描述
   *   - keywords: 额外的触发关键词（可选，会自动从工具中聚合）
   *   - tags: 额外的分类标签（可选，会自动从工具中聚合）
   *   - conventions: 平台调用约定（可选，拼接到 description 末尾）
   */
  declareSkill(metadata: {
    description: string;
    keywords?: string[];
    tags?: string[];
    conventions?: string;
  }): void {
    const skillFeature = this.plugin?.root?.inject('skill' as any) as SkillFeature | undefined;
    if (!skillFeature) {
      this.logger.debug(`declareSkill: SkillFeature 不可用，跳过 Skill 注册`);
      return;
    }

    // 收集适配器所有工具
    const tools = this.getTools();

    // 聚合关键词：metadata 声明 + 工具自带
    const allKeywords = new Set<string>(metadata.keywords || []);
    for (const tool of tools) {
      if (tool.keywords) {
        for (const kw of tool.keywords) {
          allKeywords.add(kw);
        }
      }
    }

    // 聚合标签：metadata 声明 + 工具自带
    const allTags = new Set<string>(metadata.tags || []);
    for (const tool of tools) {
      if (tool.tags) {
        for (const tag of tool.tags) {
          allTags.add(tag);
        }
      }
    }

    // 拼接描述：基础描述 + 调用约定
    let description = metadata.description;
    if (metadata.conventions) {
      description += `\n\n调用约定：${metadata.conventions}`;
    }

    const pluginName = this.plugin?.name || `adapter:${this.name}`;
    const skill: Skill = {
      name: `adapter:${this.name}`,
      description,
      tools,
      keywords: Array.from(allKeywords),
      tags: Array.from(allTags),
      pluginName,
    };

    // 清理旧的 Skill（如果有）
    this._skillDispose?.();

    // 注册到 SkillFeature
    this._skillDispose = skillFeature.add(skill, pluginName);
    this.plugin?.recordFeatureContribution('skill', `adapter:${this.name}`);

    this.logger.debug(`declareSkill: 已注册 Skill "${skill.name}"，包含 ${tools.length} 个工具`);
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
