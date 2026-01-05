/**
 * Command Context
 * 管理所有插件注册的命令
 */
import { MessageCommand } from "../command.js";
import { Message } from "../message.js";
import { Context, Plugin, getPlugin } from "../plugin.js";
import type { RegisteredAdapter, AdapterMessage } from "../types.js";

/**
 * CommandContext 扩展方法类型
 */
export interface CommandContextExtensions {
  /** 添加命令 */
  addCommand<T extends RegisteredAdapter>(command: MessageCommand<T>): () => void;
}

// 扩展 Plugin 接口
declare module "../plugin.js" {
  namespace Plugin {
    interface Extensions extends CommandContextExtensions {}
    interface Contexts {
      command: CommandService;
    }
  }
}

/**
 * 命令服务数据
 */
export interface CommandService {
  /** 命令列表（保持顺序） */
  readonly items: MessageCommand<RegisteredAdapter>[];
  /** 按 pattern 索引 */
  readonly byName: Map<string, MessageCommand<RegisteredAdapter>>;
  /** 添加命令 */
  add(command: MessageCommand<RegisteredAdapter>, pluginName: string): () => void;
  /** 移除命令 */
  remove(command: MessageCommand<RegisteredAdapter>): boolean;
  /** 按名称获取 */
  get(pattern: string): MessageCommand<RegisteredAdapter> | undefined;
  /** 处理消息 */
  handle(message: Message<AdapterMessage<RegisteredAdapter>>, plugin: Plugin): Promise<any>;
}

/**
 * 创建命令 Context
 */
export function createCommandService(): Context<'command', CommandContextExtensions> {
  const items: MessageCommand<RegisteredAdapter>[] = [];
  const byName = new Map<string, MessageCommand<RegisteredAdapter>>();
  const pluginMap = new Map<MessageCommand<RegisteredAdapter>, string>();
  
  const value: CommandService = {
    items,
    byName,
    
    add(command, pluginName) {
      items.push(command);
      byName.set(command.pattern, command);
      pluginMap.set(command, pluginName);
      return () => value.remove(command);
    },
    
    remove(command) {
      const index = items.indexOf(command);
      if (index !== -1) {
        items.splice(index, 1);
        byName.delete(command.pattern);
        pluginMap.delete(command);
        return true;
      }
      return false;
    },
    
    get(pattern) {
      return byName.get(pattern);
    },
    
    async handle(message, plugin) {
      for (const command of items) {
        const result = await command.handle(message, plugin);
        if (result) return result;
      }
      return null;
    }
  };
  
  return {
    name: 'command',
    description: '命令服务',
    value,
    extensions: {
      addCommand<T extends RegisteredAdapter>(command: MessageCommand<T>) {
        const plugin = getPlugin();
        const dispose = value.add(command as MessageCommand<RegisteredAdapter>, plugin.name);
        plugin.onDispose(dispose);
        return dispose;
      }
    }
  };
}
