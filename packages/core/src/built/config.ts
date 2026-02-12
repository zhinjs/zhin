/**
 * ConfigFeature
 * 配置管理服务，继承自 Feature 抽象类
 * 保留原有 ConfigLoader / ConfigService 逻辑，增加 addConfig 扩展
 */
import path from "node:path";
import fs from "node:fs";
import { stringify as stringifyYaml, parse as parseYaml } from "yaml";
import { Schema } from "@zhin.js/schema";
import { Feature, FeatureJSON } from "../feature.js";
import { getPlugin } from "../plugin.js";

// ============================================================================
// ConfigLoader（保持不变）
// ============================================================================

export class ConfigLoader<T extends object> {
  #data: T;
  get data(): T {
    return this.#proxy(this.#data, this);
  }
  get raw(): T {
    return this.#data;
  }
  get extension() {
    return path.extname(this.filename).toLowerCase();
  }
  constructor(public filename: string, public initial: T, public schema?: Schema<T>) {
    this.#data = this.initial;
  }
  #proxy<R extends object>(data: R, loader: ConfigLoader<T>) {
    return new Proxy(data, {
      get(target, prop, receiver) {
        if (typeof prop === 'symbol' || prop === 'constructor' || prop === 'prototype') {
          return Reflect.get(target, prop, receiver);
        }

        const result = Reflect.get(target, prop, receiver);

        if (typeof result === 'function') {
          return result;
        }

        if (result instanceof Object && result !== null && typeof result !== 'function') {
          return loader.#proxy(result, loader);
        }

        if (typeof result === 'string') {
          if (result.startsWith('\\${') && result.endsWith('}')) return result.slice(1);
          if (/^\$\{(.*)\}$/.test(result)) {
            const content = result.slice(2, -1);
            const [key, ...rest] = content.split(':');
            const defaultValue = rest.length > 0 ? rest.join(':') : undefined;
            return process.env[key] ?? defaultValue ?? (loader.initial as any)[key] ?? result;
          }
        }
        return result;
      },
      set(target, prop, value, receiver) {
        const result = Reflect.set(target, prop, value, receiver);
        loader.save(loader.filename);
        return result;
      },
      deleteProperty(target, prop) {
        const result = Reflect.deleteProperty(target, prop);
        loader.save(loader.filename);
        return result;
      }
    });
  }
  load() {
    const fullPath = path.resolve(process.cwd(), this.filename);
    if (!fs.existsSync(fullPath)) {
      this.save(fullPath);
    }
    const content = fs.readFileSync(fullPath, "utf-8");
    let rawConfig: any;
    switch (this.extension) {
      case ".json":
        rawConfig = JSON.parse(content);
        break;
      case ".yaml":
      case ".yml":
        rawConfig = parseYaml(content);
        break;
    }
    if (this.schema) {
      this.#data = this.schema(rawConfig || this.initial) as T;
    } else {
      this.#data = rawConfig as T;
    }
  }
  save(fullPath: string) {
    switch (this.extension) {
      case ".json":
        fs.writeFileSync(fullPath, JSON.stringify(this.#data, null, 2));
        break;
      case ".yaml":
      case ".yml":
        fs.writeFileSync(fullPath, stringifyYaml(this.#data));
        break;
    }
  }
}

export namespace ConfigLoader {
  export const supportedExtensions = [".json", ".yaml", ".yml"];
  export function load<T extends object>(filename: string, initial?: T, schema?: Schema<T>) {
    const result = new ConfigLoader<T>(filename, initial ?? {} as T, schema);
    result.load();
    return result;
  }
}

// ============================================================================
// ConfigFeature
// ============================================================================

/**
 * 配置项声明记录
 */
export interface ConfigRecord {
  key: string;
  defaultValue: any;
}

/**
 * ConfigFeature 扩展方法类型
 */
export interface ConfigContextExtensions {
  /** 声明插件配置项（key + 默认值），如果配置文件中不存在则写入默认值 */
  addConfig(key: string, defaultValue: any): () => void;
}

declare module "../plugin.js" {
  namespace Plugin {
    interface Extensions extends ConfigContextExtensions {}
    interface Contexts {
      config: ConfigFeature;
    }
  }
}

export class ConfigFeature extends Feature<ConfigRecord> {
  readonly name = 'config' as const;
  readonly icon = 'Settings';
  readonly desc = '配置';

  /** 内部配置文件管理 */
  readonly configs: Map<string, ConfigLoader<any>> = new Map();

  /** 主配置文件名（第一个加载的配置文件） */
  #primaryConfigFile: string = '';

  /**
   * 加载配置文件
   */
  load<T extends object>(filename: string, initial?: Partial<T>, schema?: Schema<T>): ConfigLoader<T> {
    const ext = path.extname(filename).toLowerCase();
    if (!ConfigLoader.supportedExtensions.includes(ext)) {
      throw new Error(`不支持的配置文件格式: ${ext}`);
    }
    const config = ConfigLoader.load(filename, initial as T, schema);
    this.configs.set(filename, config);
    if (!this.#primaryConfigFile) {
      this.#primaryConfigFile = filename;
    }
    return config;
  }

  /**
   * 获取配置数据（代理模式，自动保存）
   */
  get<T extends object>(filename: string, initial?: Partial<T>, schema?: Schema<T>): T {
    if (!this.configs.has(filename)) this.load(filename, initial, schema);
    const config = this.configs.get(filename);
    if (!config) throw new Error(`配置文件 ${filename} 未加载`);
    return config.data as T;
  }

  /**
   * 获取原始配置数据
   */
  getRaw<T extends object>(filename: string, initial?: Partial<T>, schema?: Schema<T>): T {
    if (!this.configs.has(filename)) this.load(filename, initial, schema);
    const config = this.configs.get(filename);
    if (!config) throw new Error(`配置文件 ${filename} 未加载`);
    return config.raw as T;
  }

  /**
   * 更新配置文件内容
   */
  set<T extends object>(filename: string, data: T): void {
    const config = this.configs.get(filename);
    if (!config) throw new Error(`配置文件 ${filename} 未加载`);
    Object.assign(config.raw, data);
    config.save(path.resolve(process.cwd(), filename));
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
        name: r.key,
        // 不暴露 defaultValue 以防止泄露密钥/令牌
      })),
    };
  }

  /**
   * 提供给 Plugin.prototype 的扩展方法
   */
  get extensions() {
    const feature = this;
    return {
      addConfig(key: string, defaultValue: any) {
        const plugin = getPlugin();

        // 尝试写入主配置文件（如果 key 不存在）
        if (feature.#primaryConfigFile) {
          const config = feature.configs.get(feature.#primaryConfigFile);
          if (config) {
            const raw = config.raw as Record<string, any>;
            if (!(key in raw)) {
              raw[key] = defaultValue;
              config.save(path.resolve(process.cwd(), feature.#primaryConfigFile));
            }
          }
        }

        const record: ConfigRecord = { key, defaultValue };
        const dispose = feature.add(record, plugin.name);
        plugin.recordFeatureContribution(feature.name, key);
        plugin.onDispose(dispose);
        return dispose;
      },
    };
  }
}

/**
 * @deprecated Use ConfigFeature instead
 */
export const ConfigService = ConfigFeature;
