/**
 * Feature 抽象基类
 * 所有可追踪、可序列化的插件功能的基类，用于 provide/inject 机制。
 */

import type { PluginLike } from './plugin-types.js';

/**
 * Feature 序列化后的 JSON 格式，用于 HTTP API 返回给前端
 */
export interface FeatureJSON {
  name: string;
  icon: string;
  desc: string;
  count: number;
  items: any[];
}

/**
 * Feature 变更事件监听器类型
 */
export type FeatureListener<T> = (item: T, pluginName: string) => void;

/**
 * Feature<T> 抽象类
 * - name / icon / desc: 自描述元数据
 * - items: 全局 item 列表
 * - pluginItems: 按插件名分组的 item 列表
 * - toJSON: 控制 HTTP API 返回的数据格式
 * - extensions: 提供给 Plugin.prototype 的扩展方法（如 addCommand）
 * - mounted / dispose: 可选生命周期钩子
 * - on('add' | 'remove'): 变更事件通知
 */
export abstract class Feature<T = any> {
  abstract readonly name: string;
  abstract readonly icon: string;
  abstract readonly desc: string;

  /** 全局 item 列表 */
  readonly items: T[] = [];

  /** 按插件名分组的 item 列表 */
  protected pluginItems = new Map<string, T[]>();

  /** 事件监听器 */
  #listeners = new Map<string, Set<FeatureListener<T>>>();

  /**
   * 监听变更事件
   * @param event 'add' | 'remove'
   * @param listener 回调函数
   * @returns 取消监听的函数
   */
  on(event: 'add' | 'remove', listener: FeatureListener<T>): () => void {
    if (!this.#listeners.has(event)) {
      this.#listeners.set(event, new Set());
    }
    this.#listeners.get(event)!.add(listener);
    return () => { this.#listeners.get(event)?.delete(listener); };
  }

  /** 触发事件 */
  protected emit(event: 'add' | 'remove', item: T, pluginName: string): void {
    const listeners = this.#listeners.get(event);
    if (!listeners) return;
    for (const listener of listeners) {
      try { listener(item, pluginName); } catch { /* 防止监听器异常影响主流程 */ }
    }
  }

  /**
   * 添加 item，同时记录所属插件
   * @returns dispose 函数，用于移除该 item
   */
  add(item: T, pluginName: string): () => void {
    this.items.push(item);
    if (!this.pluginItems.has(pluginName)) {
      this.pluginItems.set(pluginName, []);
    }
    this.pluginItems.get(pluginName)!.push(item);
    this.emit('add', item, pluginName);
    return () => this.remove(item, pluginName);
  }

  /**
   * 移除 item
   */
  remove(item: T, pluginName?: string): boolean {
    const idx = this.items.indexOf(item);
    if (idx !== -1) {
      this.items.splice(idx, 1);
      const resolvedPluginName = pluginName ?? this.#findPluginName(item);
      for (const [, items] of this.pluginItems) {
        const i = items.indexOf(item);
        if (i !== -1) items.splice(i, 1);
      }
      this.emit('remove', item, resolvedPluginName ?? '');
      return true;
    }
    return false;
  }

  /** 反查 item 所属的 pluginName */
  #findPluginName(item: T): string | undefined {
    for (const [name, items] of this.pluginItems) {
      if (items.includes(item)) return name;
    }
    return undefined;
  }

  /**
   * 获取指定插件注册的 item 列表
   */
  getByPlugin(pluginName: string): T[] {
    return this.pluginItems.get(pluginName) || [];
  }

  /**
   * 全局 item 数量
   */
  get count(): number {
    return this.items.length;
  }

  /**
   * 指定插件的 item 数量
   */
  countByPlugin(pluginName: string): number {
    return this.getByPlugin(pluginName).length;
  }

  /**
   * 序列化为 JSON（用于 HTTP API）
   * @param pluginName 如果提供，则只返回该插件的 item；否则返回全部
   */
  abstract toJSON(pluginName?: string): FeatureJSON;

  /**
   * 提供给 Plugin.prototype 的扩展方法
   * 子类重写此 getter 以注册扩展（如 addCommand）
   */
  get extensions(): Record<string, Function> {
    return {};
  }

  /**
   * 生命周期: 服务挂载时调用
   * @param plugin 宿主插件
   */
  mounted?(plugin: PluginLike): void | Promise<void>;

  /**
   * 生命周期: 服务销毁时调用
   */
  dispose?(): void;
}
