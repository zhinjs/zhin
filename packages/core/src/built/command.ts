/**
 * CommandFeature
 * 管理所有插件注册的命令，继承自 Feature 抽象类
 */
import { Feature, FeatureJSON } from "../feature.js";
import { MessageCommand } from "../command.js";
import { Message } from "../message.js";
import { Plugin, getPlugin } from "../plugin.js";
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
      command: CommandFeature;
    }
  }
}

/**
 * 命令服务 Feature
 */
export class CommandFeature extends Feature<MessageCommand<RegisteredAdapter>> {
  readonly name = 'command' as const;
  readonly icon = 'Terminal';
  readonly desc = '命令';

  /** 按 pattern 索引 */
  readonly byName = new Map<string, MessageCommand<RegisteredAdapter>>();

  /**
   * 添加命令
   */
  add(command: MessageCommand<RegisteredAdapter>, pluginName: string): () => void {
    this.byName.set(command.pattern, command);
    return super.add(command, pluginName);
  }

  /**
   * 移除命令
   */
  remove(command: MessageCommand<RegisteredAdapter>): boolean {
    this.byName.delete(command.pattern);
    return super.remove(command);
  }

  /**
   * 按 pattern 获取命令
   */
  get(pattern: string): MessageCommand<RegisteredAdapter> | undefined {
    return this.byName.get(pattern);
  }

  /**
   * 处理消息，依次尝试匹配命令
   */
  async handle(message: Message<AdapterMessage<RegisteredAdapter>>, plugin: Plugin): Promise<any> {
    for (const command of this.items) {
      const result = await command.handle(message, plugin);
      if (result) return result;
    }
    return null;
  }

  /**
   * 序列化为 JSON
   */
  toJSON(pluginName?: string): FeatureJSON {
    const list = pluginName ? this.getByPlugin(pluginName) : this.items;
    return {
      name: this.name,
      icon: this.icon,
      desc: this.desc,
      count: list.length,
      items: list.map(c => ({
        name: c.pattern,
        desc: c.helpInfo?.desc,
        usage: c.helpInfo?.usage,
        examples: c.helpInfo?.examples,
      })),
    };
  }

  /**
   * 提供给 Plugin.prototype 的扩展方法
   */
  get extensions() {
    const feature = this;
    return {
      addCommand<T extends RegisteredAdapter>(command: MessageCommand<T>) {
        const plugin = getPlugin();
        const dispose = feature.add(command as MessageCommand<RegisteredAdapter>, plugin.name);
        plugin.recordFeatureContribution(feature.name, command.pattern);
        plugin.onDispose(dispose);
        return dispose;
      },
    };
  }
}
