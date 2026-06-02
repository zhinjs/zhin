/**
 * ConfigFeature
 * 配置管理服务，继承自 Feature 抽象类
 * 保留原有 ConfigLoader / ConfigService 逻辑，增加 addConfig 扩展
 */
import path from "node:path";
import fs from "node:fs";
import { stringify as stringifyYaml, parse as parseYaml, parseDocument } from "yaml";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { Schema } from "@zhin.js/schema";
import { Feature, FeatureJSON } from "@zhin.js/kernel";
import { getPlugin } from "../plugin.js";

/** Deno / Node 统一的工作目录（`Deno.chdir` 后应与 `process.cwd()` 一致） */
export function runtimeCwd(): string {
  const g = globalThis as { Deno?: { cwd: () => string } };
  return g.Deno?.cwd?.() ?? process.cwd();
}

function envLookup(key: string): string | undefined {
  const g = globalThis as {
    Deno?: { env: { get: (k: string) => string | undefined } };
    process?: { env: Record<string, string | undefined> };
  };
  return g.Deno?.env.get(key) ?? g.process?.env?.[key];
}

// ============================================================================
// ConfigLoader（保持不变）
// ============================================================================

export class ConfigLoader<T extends object> {
  #data: T;
  /** `load()` 时解析的绝对路径，避免 proxy `save` 写到 cwd 下错误目录 */
  #resolvedPath = '';
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
            // 支持 bash 风格的默认值语法：${VAR:-default} 和 ${VAR:=default}
            let key: string;
            let defaultValue: string | undefined;
            const bashDefaultMatch = content.match(/^([^:}]+):[-=](.*)$/);
            if (bashDefaultMatch) {
              // ${VAR:-default} 或 ${VAR:=default}
              key = bashDefaultMatch[1];
              defaultValue = bashDefaultMatch[2];
            } else {
              key = content;
              defaultValue = undefined;
            }
            return envLookup(key) ?? defaultValue ?? (loader.initial as any)[key] ?? result;
          }
        }
        return result;
      },
      set(target, prop, value, receiver) {
        const result = Reflect.set(target, prop, value, receiver);
        loader.save();
        return result;
      },
      deleteProperty(target, prop) {
        const result = Reflect.deleteProperty(target, prop);
        loader.save();
        return result;
      }
    });
  }
  resolvePath(baseDir: string = runtimeCwd()): string {
    return path.isAbsolute(this.filename)
      ? this.filename
      : path.resolve(baseDir, this.filename);
  }

  load(baseDir: string = runtimeCwd()) {
    const fullPath = this.resolvePath(baseDir);
    this.#resolvedPath = fullPath;
    if (!fs.existsSync(fullPath)) {
      try {
        this.save(fullPath);
      } catch {
        // Workers 等无 fs.writeFileSync 的环境：使用内存 defaults
        const hasDefaults =
          this.initial != null && typeof this.initial === "object" && Object.keys(this.initial).length > 0;
        if (hasDefaults) {
          const merged = mergeConfigDefaults(this.initial, {});
          this.#data = this.schema ? this.schema(merged) as T : merged as T;
          return;
        }
        throw new Error(`Config file missing and cannot create: ${fullPath}`);
      }
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
      case ".toml":
        rawConfig = parseToml(content);
        break;
    }
    const merged = mergeConfigDefaults(this.initial, rawConfig || {});
    if (this.schema) {
      this.#data = this.schema(merged) as T;
    } else {
      this.#data = merged as T;
    }
  }
  save(fullPath?: string) {
    if (fullPath) {
      this.#resolvedPath = fullPath;
    }
    const target = this.#resolvedPath || this.resolvePath();
    if (!target) {
      throw new Error('ConfigLoader: call load() before save()');
    }
    switch (this.extension) {
      case ".json":
        fs.writeFileSync(target, JSON.stringify(this.#data, null, 2));
        break;
      case ".yaml":
      case ".yml":
        fs.writeFileSync(target, stringifyYaml(this.#data));
        break;
      case ".toml":
        fs.writeFileSync(target, stringifyToml(this.#data as Record<string, any>));
        break;
    }
  }
  /**
   * 精准修改单个顶层 key 并写回文件
   * 保留注释、格式和未修改字段（如 ${VAR} 环境变量引用）
   */
  patchKey(key: string, value: any) {
    const fullPath = this.#resolvedPath || this.resolvePath();
    switch (this.extension) {
      case ".yaml":
      case ".yml": {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const doc = parseDocument(content);
        doc.set(key, value);
        fs.writeFileSync(fullPath, doc.toString());
        break;
      }
      case ".json": {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const obj = JSON.parse(content);
        obj[key] = value;
        fs.writeFileSync(fullPath, JSON.stringify(obj, null, 2));
        break;
      }
      case ".toml": {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const obj = parseToml(content);
        (obj as Record<string, any>)[key] = value;
        fs.writeFileSync(fullPath, stringifyToml(obj));
        break;
      }
    }
    // 同步更新内存
    (this.#data as Record<string, any>)[key] = value;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

export function mergeConfigDefaults<T>(defaults: T, overrides: unknown): T {
  if (Array.isArray(defaults)) {
    return (Array.isArray(overrides) ? overrides : defaults) as T;
  }
  if (!isPlainObject(defaults)) {
    return (overrides === undefined ? defaults : overrides) as T;
  }
  if (!isPlainObject(overrides)) {
    return defaults;
  }

  const result: Record<string, unknown> = { ...defaults };
  for (const [key, value] of Object.entries(overrides)) {
    result[key] = key in result
      ? mergeConfigDefaults(result[key], value)
      : value;
  }
  return result as T;
}

export namespace ConfigLoader {
  export const supportedExtensions = [".json", ".yaml", ".yml", ".toml"];

  /**
   * 自动发现配置文件（按优先级：yml > yaml > json > toml）
   */
  export function discover(basename: string, cwd: string = runtimeCwd()): string | null {
    for (const ext of ['.yml', '.yaml', '.json', '.toml']) {
      const filename = `${basename}${ext}`;
      if (fs.existsSync(path.resolve(cwd, filename))) {
        return filename;
      }
    }
    return null;
  }
  export function load<T extends object>(
    filename: string,
    initial?: T,
    schema?: Schema<T>,
    baseDir?: string,
  ) {
    const result = new ConfigLoader<T>(filename, initial ?? {} as T, schema);
    result.load(baseDir);
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

  /** 获取主配置文件名 */
  get primaryFile(): string {
    return this.#primaryConfigFile;
  }

  /**
   * 加载配置文件
   */
  load<T extends object>(
    filename: string,
    initial?: Partial<T>,
    schema?: Schema<T>,
    baseDir?: string,
  ): ConfigLoader<T> {
    const ext = path.extname(filename).toLowerCase();
    if (!ConfigLoader.supportedExtensions.includes(ext)) {
      throw new Error(`不支持的配置文件格式: ${ext}`);
    }
    const config = ConfigLoader.load(filename, initial as T, schema, baseDir);
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
   * 获取主配置文件数据（第一个加载的配置文件）
   */
  getPrimary<T extends object>(): T {
    if (!this.#primaryConfigFile) throw new Error('没有加载任何配置文件');
    return this.get<T>(this.#primaryConfigFile);
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
    config.save(path.resolve(runtimeCwd(), filename));
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
              config.save(path.resolve(runtimeCwd(), feature.#primaryConfigFile));
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
