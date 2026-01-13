import { Client } from "kook-client";
import path from "path";
import { 
  Bot,
  Adapter, 
  Plugin,
  Message, 
  SendOptions,
  SendContent,
  MessageElement,
  segment, 
  usePlugin,
  MessageType,
} from "zhin.js";

// 类型扩展
declare module "zhin.js" {
  interface Adapters {
    kook: KookAdapter;
  }
}

// KOOK 配置接口
export interface KookBotConfig {
  context: "kook";
  name: string;
  token: string;
  data_dir?: string;
  timeout?: number;
  max_retry?: number;
  ignore?: string;
  logLevel?: string;
}

// KOOK 原始消息类型
interface KookRawMessage {
  message_id: string;
  author_id: string;
  author: {
    info: {
      nickname: string;
    };
  };
  channel_id: string;
  message_type: MessageType;
  message: string;
  raw_message: string;
  timestamp: number;
}

const plugin = usePlugin();
const { provide } = plugin;
const logger = plugin.logger;

/**
 * KOOK Bot 实现
 */
export class KookBot extends Client implements Bot<KookBotConfig, KookRawMessage> {
  $connected: boolean = false;
  adapter: KookAdapter;

  get $id(): string {
    return this.$config.name;
  }

  constructor(adapter: KookAdapter, public $config: KookBotConfig) {
    super({
      token: $config.token,
      mode: "ws" as any, // KOOK 默认使用 WebSocket 模式
      data_dir: $config.data_dir || path.join(process.cwd(), "data", "kook"),
      timeout: $config.timeout || 10000,
      max_retry: $config.max_retry || 3,
      ignore: ($config.ignore || "bot") as any,
      logLevel: ($config.logLevel || "info") as any,
    });
    this.adapter = adapter;
    this.setupEventListeners();
  }

  /**
   * 设置事件监听器
   */
  private setupEventListeners(): void {
    // 监听消息事件
    this.on("message" as any, (msg: KookRawMessage) => {
      try {
        const message = this.$formatMessage(msg);
        this.adapter.emit("message.receive", message);
        
        // 根据消息类型触发特定事件
        const eventMap: Record<MessageType, string> = {
          private: "message.private.receive",
          group: "message.group.receive",
          channel: "message.channel.receive",
        };
        
        const specificEvent = eventMap[msg.message_type];
        if (specificEvent) {
          this.adapter.emit(specificEvent as any, message);
        }
      } catch (error) {
        logger.error(`处理 KOOK 消息失败:`, error);
      }
    });

    // 监听连接事件
    this.on("connect" as any, () => {
      this.$connected = true;
      logger.info(`KOOK Bot ${this.$id} 已连接`);
    });

    // 监听断开事件
    this.on("disconnect" as any, () => {
      this.$connected = false;
      logger.warn(`KOOK Bot ${this.$id} 已断开`);
    });

    // 监听错误事件
    this.on("error" as any, (error: Error) => {
      logger.error(`KOOK Bot ${this.$id} 错误:`, error);
    });
  }

  /**
   * 将 KOOK 消息转换为标准消息格式
   */
  $formatMessage(msg: KookRawMessage): Message<KookRawMessage> {
    const message: Message<KookRawMessage> = Message.from(msg, {
            $id: msg.message_id.toString(),
      $adapter: "kook" as const,
      $bot: this.$id,
            
            $sender: {
                id: msg.author_id.toString(),
                name: msg.author.info.nickname.toString(),
            },
            
            $channel: {
        id: msg.message_type === "channel" ? msg.channel_id.toString() : msg.author_id.toString(),
        type: msg.message_type,
            },
            
      $content: this.parseMessageContent(msg.message),
            $raw: msg.raw_message,
            $timestamp: msg.timestamp,
            
            $recall: async () => {
                await this.$recallMessage(message.$id);
            },
            
      $reply: async (content: SendContent, quote?: string | boolean): Promise<string> => {
        const elements = Array.isArray(content) ? content : [content];
        const finalContent: MessageElement[] = [];
                
        if (quote) {
          finalContent.push({
            type: "reply",
                    data: { 
              id: typeof quote === "boolean" ? message.$id : quote,
            },
          });
                    } 

        finalContent.push(...elements.map(el => 
          typeof el === 'string' ? { type: 'text' as const, data: { text: el } } : el
        ));
                
                return await this.$sendMessage({
                    ...message.$channel,
          context: "kook",
          bot: this.$id,
          content: finalContent,
        });
      },
        });
        
        return message;
    }

    /**
   * 解析消息内容为消息段数组
   * 支持 KMarkdown 格式：文本、图片、表情、@提及等
   */
  private parseMessageContent(content: string): MessageElement[] {
    const elements: MessageElement[] = [];
    
    // KMarkdown 图片格式: ![alt](url)
    const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
    // KMarkdown @提及格式: (met)userId(met) 或 @用户名
    const mentionRegex = /\(met\)(\d+)\(met\)|@([^\s]+)/g;
    // KMarkdown 表情格式: (emj)表情名(emj)[表情ID]
    const emojiRegex = /\(emj\)([^(]+)\(emj\)\[([^\]]+)\]/g;
    // KMarkdown 频道格式: (chn)channelId(chn)
    const channelRegex = /\(chn\)(\d+)\(chn\)/g;
    
    let lastIndex = 0;
    const matches: Array<{ index: number; length: number; element: MessageElement }> = [];
    
    // 解析图片
    let match: RegExpExecArray | null;
    while ((match = imageRegex.exec(content)) !== null) {
      matches.push({
        index: match.index,
        length: match[0].length,
        element: { type: "image", data: { url: match[2], alt: match[1] } }
      });
    }
    
    // 解析 @提及
    while ((match = mentionRegex.exec(content)) !== null) {
      const userId = match[1] || match[2];
      matches.push({
        index: match.index,
        length: match[0].length,
        element: { type: "at", data: { id: userId } }
      });
    }
    
    // 解析表情
    while ((match = emojiRegex.exec(content)) !== null) {
      matches.push({
        index: match.index,
        length: match[0].length,
        element: { type: "face", data: { id: match[2], name: match[1] } }
      });
    }
    
    // 解析频道引用
    while ((match = channelRegex.exec(content)) !== null) {
      matches.push({
        index: match.index,
        length: match[0].length,
        element: { type: "text", data: { text: `#频道:${match[1]}` } }
      });
    }
    
    // 按位置排序
    matches.sort((a, b) => a.index - b.index);
    
    // 组装消息段
    for (const match of matches) {
      // 添加之前的文本
      if (match.index > lastIndex) {
        const text = content.slice(lastIndex, match.index);
        if (text) {
          elements.push({ type: "text", data: { text } });
        }
      }
      
      // 添加特殊元素
      elements.push(match.element);
      lastIndex = match.index + match.length;
    }
    
    // 添加剩余文本
    if (lastIndex < content.length) {
      const text = content.slice(lastIndex);
      if (text) {
        elements.push({ type: "text", data: { text } });
      }
    }
    
    // 如果没有解析到任何特殊元素，返回纯文本
    if (elements.length === 0) {
      elements.push({ type: "text", data: { text: content } });
    }
    
    return elements;
  }

  /**
   * 连接到 KOOK
   */
  async $connect(): Promise<void> {
    try {
      await this.connect();
      this.$connected = true;
      logger.info(`KOOK Bot ${this.$id} 连接成功`);
        } catch (error) {
      logger.error(`KOOK Bot ${this.$id} 连接失败:`, error);
      throw error;
        }
    }

    /**
   * 断开连接
   */
  async $disconnect(): Promise<void> {
    try {
      await this.disconnect();
      this.$connected = false;
      logger.info(`KOOK Bot ${this.$id} 已断开连接`);
        } catch (error) {
      logger.error(`KOOK Bot ${this.$id} 断开连接失败:`, error);
      throw error;
        }
    }

    /**
   * 发送消息
   */
  async $sendMessage(options: SendOptions): Promise<string> {
    try {
      const { id, type, content } = options;
      
      // 将消息段转换为 KOOK 格式
      const elements: MessageElement[] = Array.isArray(content) 
        ? content.map(el => typeof el === 'string' ? { type: 'text' as const, data: { text: el } } : el)
        : [typeof content === 'string' ? { type: 'text' as const, data: { text: content } } : content];
      
      const kookContent = this.convertToKookFormat(elements);
      
      // 根据消息类型发送
      let result: any;
      if (type === "private") {
        result = await (this as any).sendPrivateMsg(id, kookContent);
      } else {
        result = await (this as any).sendChannelMsg(id, kookContent);
      }
      
      return result?.msg_id || "";
        } catch (error) {
      logger.error(`KOOK Bot ${this.$id} 发送消息失败:`, error);
      throw error;
        }
    }

    /**
   * 撤回消息
     */
  async $recallMessage(messageId: string): Promise<void> {
        try {
      await (this as any).deleteMsg(messageId);
      logger.debug(`KOOK Bot ${this.$id} 撤回消息: ${messageId}`);
        } catch (error) {
      logger.error(`KOOK Bot ${this.$id} 撤回消息失败:`, error);
      throw error;
        }
    }

    /**
   * 将消息段转换为 KOOK KMarkdown 格式
   * 支持：文本、图片、@提及、表情、引用等
   */
  private convertToKookFormat(content: MessageElement[]): string {
    return content
      .map((el) => {
        switch (el.type) {
          case "text":
            // 纯文本，转义特殊字符
            return el.data.text.replace(/[\\`*_{}[\]()#+\-.!]/g, '\\$&');
          
          case "image":
            // 图片：![alt](url)
            return `![${el.data.alt || '图片'}](${el.data.url || el.data.file})`;
          
          case "at":
            // @提及：(met)userId(met) 或 @all
            if (el.data.id === "all") {
              return "(met)all(met)";
            }
            return `(met)${el.data.id}(met)`;
          
          case "face":
            // 表情：(emj)表情名(emj)[表情ID]
            return `(emj)${el.data.name || 'emoji'}(emj)[${el.data.id}]`;
          
          case "reply":
            // 引用消息（KOOK 使用 quote 参数，不在消息内容中）
            return "";
          
          case "video":
            // 视频：使用链接形式
            return `[视频](${el.data.url || el.data.file})`;
          
          case "audio":
            // 音频：使用链接形式
            return `[音频](${el.data.url || el.data.file})`;
          
          case "file":
            // 文件：使用链接形式
            return `[文件: ${el.data.name || '未命名'}](${el.data.url || el.data.file})`;
          
          case "link":
            // 链接：[文本](url)
            return `[${el.data.text || el.data.url}](${el.data.url})`;
          
          case "bold":
            // 粗体：**文本**
            return `**${el.data.text}**`;
          
          case "italic":
            // 斜体：*文本*
            return `*${el.data.text}*`;
          
          case "code":
            // 行内代码：`代码`
            return `\`${el.data.text}\``;
          
          case "code_block":
            // 代码块：```语言\n代码\n```
            return `\`\`\`${el.data.language || ''}\n${el.data.text}\n\`\`\``;
          
          default:
            // 未知类型，尝试转换为文本
            logger.warn(`未知的消息段类型: ${el.type}`);
            return el.data.text || JSON.stringify(el.data);
        }
      })
      .filter(Boolean)
      .join("");
  }
}

/**
 * KOOK 适配器
 */
export class KookAdapter extends Adapter<KookBot> {
  constructor(plugin: Plugin) {
    super(plugin, "kook", []);
  }

  createBot(config: KookBotConfig): KookBot {
    const bot = new KookBot(this, config);
    this.bots.set(bot.$id, bot);
    return bot;
  }

  async start(): Promise<void> {
    logger.info("KOOK 适配器已启动");
  }

  async stop(): Promise<void> {
    // 断开所有 bot 连接
    for (const bot of this.bots.values()) {
      await bot.$disconnect();
    }
    logger.info("KOOK 适配器已停止");
  }
}

/**
 * 注册 KOOK 适配器
 */
provide({
  name: "kook",
  description: "KOOK Adapter",
  mounted: async (p: Plugin) => {
    const adapter = new KookAdapter(p);
    await adapter.start();
    return adapter;
  },
  dispose: async (adapter: KookAdapter) => {
    await adapter.stop();
  },
});

logger.info("✅ KOOK 适配器已加载");
