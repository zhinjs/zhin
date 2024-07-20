import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import { CONFIG_DIR } from './constans';
import { App } from './app';
export class Config<T extends object = object> {
  public static exts: string[] = ['.json', '.yaml', '.yml'];
  filename: string = '';
  #type: Config.Type = Config.Type.YAML;
  private _data: T;
  get data() {
    return this._data;
  }
  constructor(name: string, defaultValue?: T) {
    try {
      this.filename = this.#resolveByName(name);
    } catch (e) {
      if (!defaultValue) throw e;
      const ext = path.extname(name);
      if (!Config.exts.includes(ext)) this.filename = path.join(CONFIG_DIR, `${name}${this.#resolveExt()}`);
      this.#saveConfig(defaultValue);
    }
    this._data = this.#loadConfig();
    return new Proxy<T>(this._data, {
      get: (target, p, receiver) => {
        if (Reflect.has(this, p)) return Reflect.get(this, p, receiver);
        return this.#proxied(target, p, receiver);
      },
      set: (target, p, value, receiver) => {
        if (Reflect.has(this, p)) return Reflect.set(this, p, value, receiver);
        const result = Reflect.set(target, p, value, receiver);
        this.#saveConfig();
        return result;
      },
      defineProperty: (target: T, property: string | symbol, attributes: PropertyDescriptor) => {
        if (Reflect.has(this, property)) return Reflect.defineProperty(target, property, attributes);
        const result = Reflect.defineProperty(target, property, attributes);
        this.#saveConfig();
        return result;
      },
      deleteProperty: (target, p) => {
        if (Reflect.has(this, p)) return Reflect.deleteProperty(this, p);
        const result = Reflect.deleteProperty(target, p);
        this.#saveConfig();
        return result;
      },
    }) as unknown as Config<T>;
  }
  #resolveByName(name: string): string {
    if (!Config.exts.includes(path.extname(name))) {
      for (const ext of Config.exts) {
        try {
          return this.#resolveByName(`${name}${ext}`);
        } catch {}
      }
      throw new Error(`未找到配置文件${name}`);
    }
    name = path.resolve(CONFIG_DIR, name);
    if (!fs.existsSync(name)) {
      throw new Error(`未找到配置文件${name}`);
    }
    const ext = path.extname(name);
    this.#type = ['.yaml', '.yml'].includes(ext) ? Config.Type.YAML : Config.Type.JSON;
    return name;
  }
  #resolveExt() {
    switch (this.#type) {
      case Config.Type.JSON:
        return '.json';
      case Config.Type.YAML:
        return '.yml';
      default:
        throw new Error(`不支持的配置文件类型${this.#type}`);
    }
  }
  #loadConfig() {
    const content = fs.readFileSync(this.filename, 'utf8');
    switch (this.#type) {
      case Config.Type.JSON:
        return JSON.parse(content);
      case Config.Type.YAML:
        return yaml.parse(content);
      default:
        throw new Error(`不支持的配置文件类型${this.#type}`);
    }
  }
  #saveConfig(data: T = this._data) {
    switch (this.#type) {
      case Config.Type.JSON:
        return fs.writeFileSync(this.filename, JSON.stringify(data, null, 2));
      case Config.Type.YAML:
        return fs.writeFileSync(this.filename, yaml.stringify(data));
      default:
        throw new Error(`不支持的配置文件类型${this.#type}`);
    }
  }
  #replaceEnv<T>(data: T): T {
    if (typeof data !== 'string') return data;
    return data.replace(/\${([^}]+)}/g, (_, key) => process.env[key] || '') as T;
  }
  #proxied<T extends object, R = any>(obj: T, p: string | symbol, receiver: any): R {
    const result = Reflect.get(obj, p, receiver);
    if (!result || typeof result !== 'object') return this.#replaceEnv(result as R);
    return new Proxy(result, {
      get: (target, p, receiver) => {
        const result = Reflect.get(target, p, receiver);
        if (typeof result !== 'object') return this.#replaceEnv(result);
        return this.#proxied(target, p, receiver);
      },
      set: (target, p, value, receiver) => {
        const result = Reflect.set(target, p, value, receiver);
        this.#saveConfig();
        return result;
      },
      deleteProperty: (target, p) => {
        const result = Reflect.deleteProperty(target, p);
        this.#saveConfig();
        return result;
      },
    }) as R;
  }
}
export namespace Config {
  export enum Type {
    JSON = 'json',
    YAML = 'yaml',
  }
}
export interface Config extends App.Config {}
