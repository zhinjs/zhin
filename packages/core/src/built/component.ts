/**
 * Component Context
 * 管理所有插件注册的组件
 */
import { Component, renderComponents } from "../component.js";
import { SendOptions, MaybePromise } from "../types.js";
import { Context, Plugin, getPlugin } from "../plugin.js";

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
      component: ComponentService;
    }
  }
}

/**
 * 组件服务数据
 */
export interface ComponentService {
  /** 按名称索引 */
  readonly byName: Map<string, Component<any>>;
  /** 添加组件 */
  add(component: Component<any>, pluginName: string): () => void;
  /** 获取所有组件名称 */
  getAllNames(): string[];
  /** 移除组件 */
  remove(component: Component<any>): boolean;
  /** 按名称获取 */
  get(name: string): Component<any> | undefined;
}

/**
 * 创建组件 Context
 */
export function createComponentService(): Context<'component', ComponentContextExtensions> {
  const byName = new Map<string, Component<any>>();
  const pluginMap = new Map<Component<any>, string>();
  let listener: Listener | undefined;
  let rootPlugin: Plugin | undefined;
  
  const value: ComponentService = {
    byName,
    
    add(component, pluginName) {
      byName.set(component.name, component);
      pluginMap.set(component, pluginName);
      return () => value.remove(component);
    },
    getAllNames() {
      return Array.from(byName.keys());
    },
    remove(component) {
      if (byName.has(component.name)) {
        byName.delete(component.name);
        pluginMap.delete(component);
        return true;
      }
      return false;
    },
    
    get(name) {
      return byName.get(name);
    }
  };
  
  return {
    name: 'component',
    description: '组件服务',
    value,
    
    mounted(plugin: Plugin) {
      rootPlugin = plugin;
      // 创建消息渲染监听器
      listener = (options: SendOptions) => {
        return renderComponents(byName, options);
      };
      plugin.root.on('before.sendMessage', listener);
      return value;
    },
    
    dispose() {
      if (listener && rootPlugin) {
        rootPlugin.root.off('before.sendMessage', listener);
        listener = undefined;
      }
    },
    
    extensions: {
      addComponent<T extends Component<any>>(component: T) {
        const plugin = getPlugin();
        const dispose = value.add(component, plugin.name);
        plugin.onDispose(dispose);
        return dispose;
      }
    }
  };
}

