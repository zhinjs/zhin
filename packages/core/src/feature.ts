import type { Plugin } from "./plugin.js";
/**
 * Feature 抽象基类
 * 所有可追踪、可序列化的插件功能（命令、组件、定时任务、中间件等）的基类。
 * Feature 替换原来的 Context 接口，用于 provide/inject 机制。
 */

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
 * Feature<T> 抽象类
 * - name / icon / desc: 自描述元数据
 * - items: 全局 item 列表
 * - pluginItems: 按插件名分组的 item 列表
 * - toJSON: 控制 HTTP API 返回的数据格式
 * - extensions: 提供给 Plugin.prototype 的扩展方法（如 addCommand）
 * - mounted / dispose: 可选生命周期钩子
 */
export abstract class Feature<T = any> {
  abstract readonly name: string;
  abstract readonly icon: string;
  abstract readonly desc: string;

  /** 全局 item 列表 */
  readonly items: T[] = [];

  /** 按插件名分组的 item 列表 */
  protected pluginItems = new Map<string, T[]>();

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
    return () => this.remove(item);
  }

  /**
   * 移除 item
   */
  remove(item: T): boolean {
    const idx = this.items.indexOf(item);
    if (idx !== -1) {
      this.items.splice(idx, 1);
      for (const [, items] of this.pluginItems) {
        const i = items.indexOf(item);
        if (i !== -1) items.splice(i, 1);
      }
      return true;
    }
    return false;
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
   * @param plugin 宿主插件（通常是 root plugin）
   */
  mounted?(plugin: Plugin): void | Promise<void>;

  /**
   * 生命周期: 服务销毁时调用
   */
  dispose?(): void;
}
