import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { parse as parseToml } from "toml";
import { config as loadDotenv } from "dotenv";
import { Schema } from '@zhin.js/hmr';
import type { AppConfig, DefineConfig } from "./types.js";
import { LogLevel } from "@zhin.js/logger";
import { EventEmitter } from "node:events";

export interface ConfigOptions {
  configPath?: string;
  envPath?: string;
  envOverride?: boolean;
}

/**
 * 支持的配置文件格式
 */
export type ConfigFormat = "json" | "yaml" | "yml" | "toml" | "js" | "ts";
export class Config<T extends object = object> extends EventEmitter {
  #filepath: string;
  #schema: Schema<Partial<T>>;
  #data: T;
  constructor(filename: string, schema: Schema<Partial<T>>, initialConfig: T) {
    super();
    const ext = path.extname(filename).toLowerCase();
    if (!Config.supportedExtensions.includes(ext)) {
      throw new Error(
        `不支持的配置文件格式: ${ext}，支持的格式有 ${Config.supportedExtensions.join(
          "/"
        )}`
      );
    }
    const fullpath = path.resolve(process.cwd(), filename);
    if (!fs.existsSync(fullpath)) {
      Config.save(fullpath, initialConfig);
    }
    this.#filepath = fullpath;
    this.#schema = schema;
    this.#data = initialConfig;
    this.#load(this.#data);
  }
  get filepath() {
    return this.#filepath;
  }
  get config() {
    return Config.proxyResult(this.#data,()=>{Config.save(this.#filepath, this.#data);});
  }
  set config(newConfig: T) {
    const beforeConfig = this.#data;
    this.#data = newConfig;
    this.emit("change", beforeConfig, this.#data);
    Config.save(this.#filepath, this.#data);
  }
  #load(before: T) {
    // 加载配置文件
    Config.load(this.#filepath, this.#schema)
      .then((data) => {
        this.#data = data as T;
        if (JSON.stringify(before) !== JSON.stringify(this.#data)) {
          this.emit("change", before, this.#data);
        }
      })
  }
  reload() {
    this.#load(this.#data);
  }
  get<K extends Config.Paths<T>>(key: K): Config.Value<T, K> {
    const lastKey = /\.?([^.]*)$/.exec(key)?.[1];
    if (!lastKey) throw new Error(`无法获取配置项: ${key}`);
    const obj = Config.getNestedObject(this.#data, key);
    const result= Reflect.get(obj, lastKey);
    return Config.proxyResult(result,()=>{Config.save(this.#filepath, this.#data);}) as Config.Value<T, K>;
  }
  set<K extends Config.Paths<T>>(key: K, value: Config.Value<T, K>): void {
    const prop = /\.?([^.]*)$/.exec(key)?.[1];
    if (!prop) throw new Error(`无法设置配置项: ${key}`);
    const obj = Config.getNestedObject(this.#data, key);
    const beforeConfig = this.#data;
    Reflect.set(obj, prop, value);
    Config.save(this.#filepath, this.#data);
    this.emit("change", beforeConfig, this.#data);
  }
}
export namespace Config {
  export const supportedExtensions = [
    ".json",
    ".yaml",
    ".yml",
    ".toml",
    ".js",
    ".ts",
  ];
  export function proxyResult<T>(result:T,onSet:(value:T)=>void):T{
    if((typeof result!=='object' && typeof result!=='string') || result===null) return result;
    if(typeof result==='string') return replaceEnvVars(result) as T;
    return new Proxy(result as (T & object),{
      get(target,prop,receiver){
        const value=Reflect.get(target,prop,receiver)
        return proxyResult(value as T,onSet);
      },
      set(target,prop,value,receiver){
        const result=Reflect.set(target,prop,value,receiver)
        onSet(value);
        return result;
      }
    });
  }
  /**
   * 配置文件元数据，用于记录原始格式信息
   */
  interface ConfigMetadata {
    usesFunction: boolean; // 是否使用函数导出
    originalContent?: string; // 原始文件内容
  }

  // 存储配置文件的元数据
  const configMetadataMap = new Map<string, ConfigMetadata>();

  /**
   * 智能保存配置文件，保留原有格式
   */
  export function save<T extends object>(filePath: string, config: T): void {
    const ext = path.extname(filePath).toLowerCase();
    const metadata = configMetadataMap.get(filePath);
    let content: string;

    switch (ext) {
      case ".json":
        content = JSON.stringify(config, null, 2);
        break;
      case ".yaml":
      case ".yml":
        content = stringifyYaml(config, { indent: 2 });
        break;
      case ".toml":
        throw new Error("暂不支持保存 TOML 格式的配置文件");
      case ".js":
      case ".ts":
        // 智能保存 JS/TS 配置
        content = saveJsConfig(filePath, config, metadata);
        break;
      default:
        throw new Error(`不支持的配置文件格式: ${ext}`);
    }

    fs.writeFileSync(filePath, content, "utf-8");
  }

  /**
   * 智能保存 JS/TS 配置文件，保留函数格式和环境变量
   */
  function saveJsConfig<T extends object>(
    filePath: string,
    config: T,
    metadata?: ConfigMetadata
  ): string {
    const ext = path.extname(filePath);
    const usesFunction = metadata?.usesFunction ?? false;
    const originalContent = metadata?.originalContent;

    if (usesFunction && originalContent) {
      // 如果使用函数导出，尝试保留原有格式并更新配置
      return updateJsConfigWithFunction(originalContent, config, ext === ".ts");
    } else {
      // 简单对象导出
      const typeAnnotation = ext === ".ts" ? ": DefineConfig<AppConfig>" : "";
      return `export default ${JSON.stringify(
        config,
        null,
        2
      )}${typeAnnotation};`;
    }
  }

  /**
   * 更新使用函数导出的配置文件
   * 保留环境变量访问模式和原有代码结构
   */
  function updateJsConfigWithFunction<T extends object>(
    originalContent: string,
    newConfig: T,
    isTypeScript: boolean
  ): string {
    // 简单的字符串替换策略：
    // 1. 找到 return 语句中的对象
    // 2. 替换对象内容，但保留环境变量访问

    const returnMatch = originalContent.match(
      /return\s*({[\s\S]*?})\s*[;}]?\s*$/m
    );
    if (!returnMatch) {
      // 如果找不到 return 语句，回退到简单格式
      const typeAnnotation = isTypeScript ? ": DefineConfig<AppConfig>" : "";
      return `export default ${JSON.stringify(
        newConfig,
        null,
        2
      )}${typeAnnotation};`;
    }

    // 保留原有的函数签名和代码结构
    // 只更新 return 语句中的对象
    const configString = formatConfigObject(newConfig, 2);
    const beforeReturn = originalContent.substring(0, returnMatch.index! + 6); // "return"

    return `${beforeReturn.trim()} ${configString}\n});`;
  }

  /**
   * 格式化配置对象为字符串，保留环境变量访问模式
   */
  function formatConfigObject(obj: any, indent: number = 0): string {
    const spaces = " ".repeat(indent);
    const nextSpaces = " ".repeat(indent + 2);

    if (obj === null || obj === undefined) {
      return String(obj);
    }

    if (typeof obj === "string") {
      for(const [key,value] of Object.entries(process.env)){
        if(obj===value && value!=='zhin') return `process.env.${key}`;
      }
      return JSON.stringify(obj);
    }

    if (typeof obj === "number" || typeof obj === "boolean") {
      return String(obj);
    }

    if (Array.isArray(obj)) {
      if (obj.length === 0) return "[]";
      const items = obj
        .map((item) => `${nextSpaces}${formatConfigObject(item, indent + 2)}`)
        .join(",\n");
      return `[\n${items}\n${spaces}]`;
    }

    if (typeof obj === "object") {
      const entries = Object.entries(obj);
      if (entries.length === 0) return "{}";

      const props = entries
        .map(([key, value]) => {
          const needsQuotes = /[^a-zA-Z0-9_$]/.test(key);
          const keyStr = needsQuotes ? `'${key}'` : key;
          return `${nextSpaces}${keyStr}: ${formatConfigObject(
            value,
            indent + 2
          )}`;
        })
        .join(",\n");

      return `{\n${props}\n${spaces}}`;
    }

    return JSON.stringify(obj);
  }

  /**
   * 记录配置文件的元数据
   */
  export function setMetadata(
    filePath: string,
    metadata: ConfigMetadata
  ): void {
    configMetadataMap.set(filePath, metadata);
  }

  /**
   * 获取配置文件的元数据
   */
  export function getMetadata(filePath: string): ConfigMetadata | undefined {
    return configMetadataMap.get(filePath);
  }
  export async function load<T extends object>(
    filePath: string,
    schema: Schema<T>
  ): Promise<T> {
    const ext = path.extname(filePath).toLowerCase();
    const content = fs.readFileSync(filePath, "utf-8");
    let rawConfig: any;
    let usesFunction = false;

    switch (ext) {
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
      case ".js":
      case ".ts":
        // 使用动态导入加载 JS/TS 模块
        const fileUrl = pathToFileURL(path.resolve(filePath)).href;
        const module = await import(`${fileUrl}?t=${Date.now()}`);
        // 支持 ES 模块的 default 导出和 CommonJS 模块
        rawConfig = module.default || module;
        if (typeof rawConfig === "function") {
          usesFunction = true;
          rawConfig = await rawConfig(
            (process.env || {}) as Record<string, string>
          );
        }
        // 记录元数据
        setMetadata(filePath, { usesFunction, originalContent: content });
        break;
      default:
        throw new Error(`不支持的配置文件格式: ${ext}`);
    }
    return schema(rawConfig);
  }
  export type Value<
    T,
    K extends Paths<T>
  > = K extends `${infer Key}.${infer Rest}`
    ? Key extends keyof T
      ? Rest extends Paths<T[Key]>
        ? Value<T[Key], Rest>
        : never
      : never
    : K extends keyof T
    ? T[K]
    : never;

  export type Paths<
    T,
    Prefix extends string = "",
    Depth extends any[] = []
  > = Depth["length"] extends 10
    ? never
    : {
        [K in keyof T]: T[K] extends object
          ?
              | `${Prefix}${K & string}`
              | Paths<T[K], `${Prefix}${K & string}.`, [...Depth, 1]>
          : `${Prefix}${K & string}`;
      }[keyof T];
  export function getNestedObject<T>(obj: T, path: string): any {
    const parts = path.split(".");
    let current: any = obj;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!(part in current)) {
        current[part] = {};
      }
      current = current[part];
    }

    return current;
  }
}

/**
 * 替换字符串中的环境变量
 */
function replaceEnvVars(str: string): string{
  if (typeof str !== 'string') return str;
  return (str as string).replace(/^\$\{([^}]+)\}$/, (match, content) => {
    // 解析环境变量名和默认值
    const colonIndex = content.indexOf(":-");
    let envName: string;
    let defaultValue: string | undefined;

    if (colonIndex !== -1) {
      // 格式: VAR_NAME:-default_value
      envName = content.slice(0, colonIndex);
      defaultValue = content.slice(colonIndex + 2);
    } else {
      // 格式: VAR_NAME
      envName = content;
      defaultValue = undefined;
    }

    const envValue = process.env[envName];

    if (envValue !== undefined) {
      return envValue;
    } else if (defaultValue !== undefined) {
      return defaultValue;
    } else {
      return match;
    }
  });
}

export function defineConfig<T extends DefineConfig<AppConfig>>(config: T): T {
  return config;
}
