/**
 * DatabaseFeature
 * 数据库服务，管理数据模型定义，继承自 Feature 抽象类
 */
import { Registry, Definition, Databases, Database } from "@zhin.js/database";
import { DatabaseConfig, Models } from "../types.js";
import { Feature, FeatureJSON } from "../feature.js";
import { Plugin, getPlugin } from "../plugin.js";
import { SystemLogDefinition } from "../models/system-log.js";
import { UserDefinition } from "../models/user.js";

/**
 * 模型定义记录
 */
export interface ModelRecord {
  name: string;
  definition: Definition<any>;
}

declare module "../plugin" {
  namespace Plugin {
    interface Extensions {
      defineModel<K extends keyof Models>(name: K, definition: Definition<Models[K]>): void;
    }
    interface Contexts {
      database: DatabaseFeature;
    }
  }
}

export class DatabaseFeature extends Feature<ModelRecord> {
  readonly name = 'database' as const;
  readonly icon = 'Database';
  readonly desc = '数据模型';

  /** 内部数据库实例 */
  readonly db: Database<any, Models, any>;

  /** 按模型名索引 */
  readonly byName = new Map<string, ModelRecord>();

  constructor(config: DatabaseConfig) {
    super();
    this.db = Registry.create<Models, keyof Databases>(config.dialect, config, {
      SystemLog: SystemLogDefinition,
      User: UserDefinition,
    });
  }

  // ====================================================================
  // 向后兼容代理：旧代码 inject('database').xxx 可直接使用
  // ====================================================================

  get models() {
    return this.db.models;
  }

  define<K extends keyof Models>(name: K, definition: Definition<Models[K]>) {
    return this.db.define(name, definition);
  }

  start() {
    return this.db.start();
  }

  stop() {
    return this.db.stop();
  }

  /**
   * 添加模型定义
   */
  add(record: ModelRecord, pluginName: string): () => void {
    this.db.define(record.name as keyof Models, record.definition);
    this.byName.set(record.name, record);
    return super.add(record, pluginName);
  }

  /**
   * 移除模型定义
   */
  remove(record: ModelRecord): boolean {
    this.byName.delete(record.name);
    return super.remove(record);
  }

  /**
   * 生命周期: 启动数据库
   */
  async mounted(plugin: Plugin): Promise<void> {
    plugin.logger.info('Database service started');
    await this.db.start();
  }

  /**
   * 生命周期: 停止数据库
   */
  async dispose(): Promise<void> {
    await this.db.stop();
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
      items: list.map(r => ({
        name: r.name,
      })),
    };
  }

  /**
   * 提供给 Plugin.prototype 的扩展方法
   */
  get extensions() {
    const feature = this;
    return {
      defineModel<K extends keyof Models>(name: K, definition: Definition<Models[K]>) {
        const plugin = getPlugin();
        const record: ModelRecord = { name: name as string, definition };
        const dispose = feature.add(record, plugin.name);
        plugin.recordFeatureContribution(feature.name, name as string);
        plugin.onDispose(dispose);
      },
    };
  }
}
