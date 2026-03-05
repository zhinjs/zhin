/**
 * SchemaFeature — 插件配置 Schema 注册表
 *
 * 插件通过 declareConfig(key, schema) 声明配置项及其 Schema，
 * SchemaFeature 全局收集后供 Web 控制台渲染配置编辑表单。
 *
 * 与 ConfigFeature 协作：
 *   - declareConfig 内部调用 addConfig(key, defaults) 写入默认值
 *   - Schema.toJSON() 传给前端驱动 PluginConfigForm
 *   - reloadable 标记决定保存后是否自动重载插件
 */

import { Feature, FeatureJSON } from '../feature.js';
import { Schema } from '@zhin.js/schema';
import { Plugin, getPlugin } from '../plugin.js';

// ============================================================================
// 类型
// ============================================================================

export interface SchemaRecord {
  /** 配置 key（对应 zhin.config.yml 中的顶级字段） */
  key: string;
  /** Schema 实例 */
  schema: Schema;
  /** 保存后是否支持热重载（http/database 等底层服务应为 false） */
  reloadable: boolean;
}

export interface SchemaContextExtensions {
  /**
   * 声明插件配置 Schema
   * @param key 配置 key，如 "rss"
   * @param schema Schema.object({...}) 定义
   * @param options.reloadable 保存后是否自动重载，默认 true
   * @returns 当前配置值（已合并默认值）
   */
  declareConfig<T extends Record<string, any>>(
    key: string,
    schema: Schema<T>,
    options?: { reloadable?: boolean },
  ): Required<T>;
}

declare module '../plugin.js' {
  namespace Plugin {
    interface Extensions extends SchemaContextExtensions {}
    interface Contexts {
      schema: SchemaFeature;
    }
  }
}

// ============================================================================
// SchemaFeature
// ============================================================================

export class SchemaFeature extends Feature<SchemaRecord> {
  readonly name = 'schema' as const;
  readonly icon = 'FileCode';
  readonly desc = '配置模型';

  /**
   * 按配置 key 查找 Schema
   */
  getByKey(key: string): SchemaRecord | null {
    return this.items.find(r => r.key === key) ?? null;
  }

  /**
   * 获取指定插件名注册的 Schema
   */
  getByPluginName(pluginName: string): SchemaRecord | null {
    const list = this.getByPlugin(pluginName);
    return list.length > 0 ? list[0] : null;
  }

  /**
   * 获取某个 key 的 Schema 实例（WebSocket handler 使用）
   */
  get(keyOrPlugin: string): Schema | null {
    const byKey = this.getByKey(keyOrPlugin);
    if (byKey) return byKey.schema;
    const byPlugin = this.getByPluginName(keyOrPlugin);
    return byPlugin?.schema ?? null;
  }

  /**
   * 判断某个 key 对应的插件是否支持热重载
   */
  isReloadable(keyOrPlugin: string): boolean {
    const byKey = this.getByKey(keyOrPlugin);
    if (byKey) return byKey.reloadable;
    const byPlugin = this.getByPluginName(keyOrPlugin);
    return byPlugin?.reloadable ?? true;
  }

  /**
   * 通过 pluginName 获取对应的 config key
   */
  resolveConfigKey(pluginName: string): string | null {
    const byKey = this.getByKey(pluginName);
    if (byKey) return byKey.key;
    const byPlugin = this.getByPluginName(pluginName);
    return byPlugin?.key ?? null;
  }

  /**
   * 返回 pluginName → configKey 的映射
   */
  getPluginKeyMap(): Map<string, string> {
    const map = new Map<string, string>();
    for (const [pluginName, records] of this.pluginItems) {
      if (records.length > 0) {
        map.set(pluginName, records[0].key);
      }
    }
    return map;
  }

  toJSON(pluginName?: string): FeatureJSON {
    const list = pluginName ? this.getByPlugin(pluginName) : this.items;
    return {
      name: this.name,
      icon: this.icon,
      desc: this.desc,
      count: list.length,
      items: list.map(r => ({
        name: r.key,
        reloadable: r.reloadable,
        schema: r.schema.toJSON(),
      })),
    };
  }

  get extensions() {
    const feature = this;
    return {
      declareConfig<T extends Record<string, any>>(
        key: string,
        schema: Schema<T>,
        options?: { reloadable?: boolean },
      ): Required<T> {
        const plugin = getPlugin() as Plugin;
        const reloadable = options?.reloadable ?? true;

        // 从 Schema 提取默认值
        const defaults = extractDefaults(schema);

        // 注册到 ConfigFeature（写入 config.yml 的默认值）
        if (typeof plugin.addConfig === 'function') {
          plugin.addConfig(key, defaults);
        }

        // 注册到 SchemaFeature
        const record: SchemaRecord = { key, schema, reloadable };
        const dispose = feature.add(record, plugin.name);
        plugin.recordFeatureContribution(feature.name, key);
        plugin.onDispose(dispose);

        // 读取当前配置并与默认值合并
        const root = plugin.root ?? plugin;
        const configService = root.inject('config') as any;
        const appConfig = configService?.get?.('zhin.config.yml') ?? {};
        const current = appConfig[key] ?? {};

        return { ...defaults, ...current } as Required<T>;
      },
    };
  }
}

// ============================================================================
// 辅助：从 Schema 提取默认值
// ============================================================================

function extractDefaults(schema: Schema): Record<string, any> {
  const json = schema.toJSON();
  const result: Record<string, any> = {};

  const fields = json.object || json.properties || json.dict || {};
  for (const [fieldKey, fieldSchema] of Object.entries(fields)) {
    const field = fieldSchema as Record<string, any>;
    if (field.default !== undefined) {
      result[fieldKey] = field.default;
    }
  }

  return result;
}
