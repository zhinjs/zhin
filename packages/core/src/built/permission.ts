/**
 * PermissionFeature
 * 权限管理服务，继承自 Feature 抽象类
 */
import { Feature, FeatureJSON } from "../feature.js";
import { getPlugin } from "../plugin.js";
import type { MaybePromise, RegisteredAdapter, AdapterMessage } from "../types.js";
import { Message as MessageClass } from "../message.js";

export type PermissionItem<T extends RegisteredAdapter = RegisteredAdapter> = {
  name: string | RegExp;
  check: PermissionChecker<T>;
};

export type PermissionChecker<T extends RegisteredAdapter = RegisteredAdapter> = (
  name: string,
  message: MessageClass<AdapterMessage<T>>
) => MaybePromise<boolean>;

/**
 * PermissionFeature 扩展方法类型
 */
export interface PermissionContextExtensions {
  addPermission(permission: PermissionItem): () => void;
}

declare module "../plugin.js" {
  namespace Plugin {
    interface Extensions extends PermissionContextExtensions {}
    interface Contexts {
      permission: PermissionFeature;
    }
  }
}

export class PermissionFeature extends Feature<PermissionItem> {
  readonly name = 'permission' as const;
  readonly icon = 'Shield';
  readonly desc = '权限';

  constructor() {
    super();
    // 注册默认权限检查器（使用 'built-in' 作为插件名）
    this.add(
      Permissions.define(/^adapter\([^)]+\)$/, (name, message) => {
        return message.$adapter === name.replace(/^adapter\(([^)]+)\)$/, '$1');
      }),
      '__built-in__',
    );
    this.add(
      Permissions.define(/^group\([^)]+\)$/, (name, message) => {
        const match = name.match(/^group\(([^)]+)\)$/);
        if (!match) return false;
        const id = match[1];
        if (message.$channel.type !== 'group') return false;
        if (id === '' || id === '*') return true;
        return message.$channel.id === id;
      }),
      '__built-in__',
    );
    this.add(
      Permissions.define(/^private\([^)]+\)$/, (name, message) => {
        const match = name.match(/^private\(([^)]+)\)$/);
        if (!match) return false;
        const id = match[1];
        if (message.$channel.type !== 'private') return false;
        if (id === '' || id === '*') return true;
        return message.$channel.id === id;
      }),
      '__built-in__',
    );
    this.add(
      Permissions.define(/^channel\([^)]+\)$/, (name, message) => {
        const match = name.match(/^channel\(([^)]+)\)$/);
        if (!match) return false;
        const id = match[1];
        if (message.$channel.type !== 'channel') return false;
        if (id === '' || id === '*') return true;
        return message.$channel.id === id;
      }),
      '__built-in__',
    );
    this.add(
      Permissions.define(/^user\([^)]+\)$/, (name, message) => {
        const match = name.match(/^user\(([^)]+)\)$/);
        if (!match) return false;
        const id = match[1];
        return message.$sender.id === id;
      }),
      '__built-in__',
    );
  }

  /**
   * 检查权限
   */
  async check(name: string, message: MessageClass<AdapterMessage<RegisteredAdapter>>): Promise<boolean> {
    for (const permission of this.items) {
      const passed = await permission.check(name, message);
      if (passed) return true;
    }
    return false;
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
      items: list.map(p => ({
        name: p.name instanceof RegExp ? p.name.source : p.name,
      })),
    };
  }

  /**
   * 提供给 Plugin.prototype 的扩展方法
   */
  get extensions() {
    const feature = this;
    return {
      addPermission(permission: PermissionItem) {
        const plugin = getPlugin();
        const dispose = feature.add(permission, plugin.name);
        const permName = permission.name instanceof RegExp ? permission.name.source : permission.name;
        plugin.recordFeatureContribution(feature.name, permName);
        plugin.onDispose(dispose);
        return dispose;
      },
    };
  }
}

export namespace Permissions {
  export function define<T extends RegisteredAdapter = RegisteredAdapter>(
    name: string | RegExp,
    check: PermissionChecker<T>,
  ): PermissionItem<T> {
    return { name, check };
  }
}

/**
 * @deprecated Use PermissionFeature instead
 */
export const PermissionService = PermissionFeature;
