/**
 * CronFeature
 * 管理所有插件注册的定时任务，继承自 Feature 抽象类
 */
import { Feature, FeatureJSON } from "../feature.js";
import { Cron } from "../cron.js";
import { Plugin, getPlugin } from "../plugin.js";

/**
 * CronContext 扩展方法类型
 */
export interface CronContextExtensions {
  /** 添加定时任务 */
  addCron(cron: Cron): () => void;
}

// 扩展 Plugin 接口
declare module "../plugin.js" {
  namespace Plugin {
    interface Extensions extends CronContextExtensions {}
    interface Contexts {
      cron: CronFeature;
    }
  }
}

/**
 * 定时任务服务 Feature
 */
export class CronFeature extends Feature<Cron> {
  readonly name = 'cron' as const;
  readonly icon = 'Clock';
  readonly desc = '定时任务';

  /** 按 ID/表达式 索引 */
  readonly byName = new Map<string, Cron>();

  /**
   * 添加定时任务，自动启动
   */
  add(cron: Cron, pluginName: string): () => void {
    this.byName.set(cron.id || cron.cronExpression, cron);
    // 自动启动
    if (!cron.running) {
      cron.run();
    }
    return super.add(cron, pluginName);
  }

  /**
   * 移除定时任务，自动停止
   */
  remove(cron: Cron): boolean {
    if (cron.running) {
      cron.stop();
    }
    this.byName.delete(cron.id || cron.cronExpression);
    return super.remove(cron);
  }

  /**
   * 按 ID/表达式 获取
   */
  get(id: string): Cron | undefined {
    return this.byName.get(id);
  }

  /**
   * 停止所有任务
   */
  stopAll(): void {
    for (const cron of this.items) {
      if (cron.running) {
        cron.stop();
      }
    }
  }

  /**
   * 启动所有任务
   */
  startAll(): void {
    for (const cron of this.items) {
      if (!cron.running && !cron.disposed) {
        cron.run();
      }
    }
  }

  /**
   * 获取所有任务状态
   */
  getStatus(): Array<{
    expression: string;
    running: boolean;
    nextExecution: Date | null;
    plugin: string;
  }> {
    return this.items.map(cron => {
      // 从 pluginItems 中找到对应的插件名
      let pluginName = 'unknown';
      for (const [name, items] of this.pluginItems) {
        if (items.includes(cron)) {
          pluginName = name;
          break;
        }
      }
      return {
        expression: cron.cronExpression,
        running: cron.running,
        nextExecution: cron.running ? cron.getNextExecutionTime() : null,
        plugin: pluginName,
      };
    });
  }

  /**
   * 生命周期: 销毁时停止所有任务
   */
  dispose(): void {
    this.stopAll();
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
        expression: c.cronExpression,
        running: c.running,
      })),
    };
  }

  /**
   * 提供给 Plugin.prototype 的扩展方法
   */
  get extensions() {
    const feature = this;
    return {
      addCron(cron: Cron) {
        const plugin = getPlugin();
        const dispose = feature.add(cron, plugin.name);
        plugin.recordFeatureContribution(feature.name, cron.id || cron.cronExpression);
        plugin.onDispose(dispose);
        return dispose;
      },
    };
  }
}
