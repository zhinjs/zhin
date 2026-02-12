/**
 * ComponentFeature
 * 管理所有插件注册的组件，继承自 Feature 抽象类
 */
import { Feature, FeatureJSON } from "../feature.js";
import { Component, renderComponents } from "../component.js";
import { SendOptions, MaybePromise } from "../types.js";
import { Plugin, getPlugin } from "../plugin.js";

type Listener = (options: SendOptions) => MaybePromise<SendOptions>;

/**
 * ComponentContext 扩展方法类型
 */
export interface ComponentContextExtensions {
  /** 添加组件 */
  addComponent<T extends Component<any>>(component: T): () => void;
}

// 扩展 Plugin 接口
declare module "../plugin.js" {
  namespace Plugin {
    interface Extensions extends ComponentContextExtensions {}
    interface Contexts {
      component: ComponentFeature;
    }
  }
}

/**
 * 组件服务 Feature
 */
export class ComponentFeature extends Feature<Component<any>> {
  readonly name = 'component' as const;
  readonly icon = 'Box';
  readonly desc = '组件';

  /** 按名称索引 */
  readonly byName = new Map<string, Component<any>>();

  /** 内部状态：消息渲染监听器 & 宿主插件 */
  #listener?: Listener;
  #rootPlugin?: Plugin;

  /**
   * 添加组件
   */
  add(component: Component<any>, pluginName: string): () => void {
    this.byName.set(component.name, component);
    return super.add(component, pluginName);
  }

  /**
   * 移除组件
   */
  remove(component: Component<any>): boolean {
    this.byName.delete(component.name);
    return super.remove(component);
  }

  /**
   * 获取所有组件名称
   */
  getAllNames(): string[] {
    return Array.from(this.byName.keys());
  }

  /**
   * 按名称获取组件
   */
  get(name: string): Component<any> | undefined {
    return this.byName.get(name);
  }

  /**
   * 生命周期: 挂载时注册消息渲染监听器
   */
  mounted(plugin: Plugin): void {
    this.#rootPlugin = plugin;
    this.#listener = (options: SendOptions) => {
      return renderComponents(this.byName, options);
    };
    plugin.root.on('before.sendMessage', this.#listener);
  }

  /**
   * 生命周期: 销毁时移除监听器
   */
  dispose(): void {
    if (this.#listener && this.#rootPlugin) {
      this.#rootPlugin.root.off('before.sendMessage', this.#listener);
      this.#listener = undefined;
    }
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
        name: c.name,
        type: 'component',
      })),
    };
  }

  /**
   * 提供给 Plugin.prototype 的扩展方法
   */
  get extensions() {
    const feature = this;
    return {
      addComponent<T extends Component<any>>(component: T) {
        const plugin = getPlugin();
        const dispose = feature.add(component, plugin.name);
        plugin.recordFeatureContribution(feature.name, component.name);
        plugin.onDispose(dispose);
        return dispose;
      },
    };
  }
}
