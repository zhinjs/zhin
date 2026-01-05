/**
 * Cron Context
 * 管理所有插件注册的定时任务
 */
import { Cron } from "../cron.js";
import { Context, Plugin, getPlugin } from "../plugin.js";

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
      cron: CronService;
    }
  }
}

/**
 * 定时任务服务数据
 */
export interface CronService {
  /** 任务列表 */
  readonly items: Cron[];
  /** 按 ID/表达式 索引 */
  readonly byName: Map<string, Cron>;
  /** 添加任务 */
  add(cron: Cron, pluginName: string): () => void;
  /** 移除任务 */
  remove(cron: Cron): boolean;
  /** 按名称获取 */
  get(id: string): Cron | undefined;
  /** 停止所有任务 */
  stopAll(): void;
  /** 启动所有任务 */
  startAll(): void;
  /** 获取状态 */
  getStatus(): Array<{
    expression: string;
    running: boolean;
    nextExecution: Date | null;
    plugin: string;
  }>;
}

/**
 * 创建定时任务 Context
 */
export function createCronService(): Context<'cron', CronContextExtensions> {
  const items: Cron[] = [];
  const byName = new Map<string, Cron>();
  const pluginMap = new Map<Cron, string>();
  
  const value: CronService = {
    items,
    byName,
    
    add(cron, pluginName) {
      items.push(cron);
      byName.set(cron.id || cron.cronExpression, cron);
      pluginMap.set(cron, pluginName);
      // 自动启动
      if (!cron.running) {
        cron.run();
      }
      return () => value.remove(cron);
    },
    
    remove(cron) {
      const index = items.indexOf(cron);
      if (index !== -1) {
        // 自动停止
        if (cron.running) {
          cron.stop();
        }
        items.splice(index, 1);
        byName.delete(cron.id || cron.cronExpression);
        pluginMap.delete(cron);
        return true;
      }
      return false;
    },
    
    get(id) {
      return byName.get(id);
    },
    
    stopAll() {
      for (const cron of items) {
        if (cron.running) {
          cron.stop();
        }
      }
    },
    
    startAll() {
      for (const cron of items) {
        if (!cron.running && !cron.disposed) {
          cron.run();
        }
      }
    },
    
    getStatus() {
      return items.map(cron => ({
        expression: cron.cronExpression,
        running: cron.running,
        nextExecution: cron.running ? cron.getNextExecutionTime() : null,
        plugin: pluginMap.get(cron) || 'unknown',
      }));
    }
  };
  
  return {
    name: 'cron',
    description: '定时任务服务',
    value,
    
    dispose() {
      value.stopAll();
    },
    
    extensions: {
      addCron(cron: Cron) {
        const plugin = getPlugin();
        const dispose = value.add(cron, plugin.name);
        plugin.onDispose(dispose);
        return dispose;
      }
    }
  };
}

