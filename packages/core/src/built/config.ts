import path from "node:path";
import fs from "node:fs";
import { stringify as stringifyYaml,parse as parseYaml } from "yaml";
import { Schema } from "@zhin.js/schema";
export class ConfigLoader<T extends object>{
    #data: T;
    get data(): T {
        return this.#proxy(this.#data,this);
    }
    get raw(): T {
        return this.#data;
    }
    get extension() {
        return path.extname(this.filename).toLowerCase();
    }
    constructor(public filename: string, public initial:T, public schema?: Schema<T>) {
        this.#data = this.initial;
    }
    #proxy<R extends object>(data: R, loader: ConfigLoader<T>) {
        return new Proxy(data, {
            get(target, prop, receiver) {
                const result= Reflect.get(target, prop, receiver);
                if(result instanceof Object && result!==null) return loader.#proxy(result,loader);
                if(typeof result==='string') {
                    if(result.startsWith('\\${') && result.endsWith('}')) return result.slice(1);
                    if(/^\$\{(.*)\}$/.test(result)){
                        const content = result.slice(2, -1);
                        const [key, ...rest] = content.split(':');
                        const defaultValue = rest.length > 0 ? rest.join(':') : undefined;
                        return process.env[key] ?? defaultValue ?? (loader.initial as any)[key] ?? result;
                    }
                }
                return result;
            },
            set(target, prop, value, receiver) {
                const result= Reflect.set(target, prop, value, receiver);
                loader.save(loader.filename);
                return result;
            },
            deleteProperty(target, prop) {
                const result= Reflect.deleteProperty(target, prop);
                loader.save(loader.filename);
                return result;
            }
        });
    }
    load() {
        const fullPath=path.resolve(process.cwd(), this.filename);
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
        if(this.schema){
            this.#data = this.schema(rawConfig || this.initial) as T;
        }else{
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
export namespace ConfigLoader{
    export const supportedExtensions = [".json", ".yaml", ".yml"];
    export function load<T extends object>(filename: string, initial?:T, schema?: Schema<T>) {
        const result = new ConfigLoader<T>(filename, initial??{} as T, schema);
        result.load();
        return result;
    }
}
export class ConfigService{
    configs: Map<string, ConfigLoader<any>> = new Map();
    constructor() {
    }
    load<T extends object>(filename: string, initial?:Partial<T>, schema?: Schema<T>) {
        const ext = path.extname(filename).toLowerCase();
        if (!ConfigLoader.supportedExtensions.includes(ext)) {
            throw new Error(`不支持的配置文件格式: ${ext}`);
        }
        const config = ConfigLoader.load(filename, initial as T, schema);
        this.configs.set(filename, config);
        return config;
    }
    get<T extends object>(filename: string, initial?:Partial<T>, schema?: Schema<T>): T {
        if(!this.configs.has(filename)) this.load(filename, initial, schema);
        const config = this.configs.get(filename);
        if(!config) throw new Error(`配置文件 ${filename} 未加载`);
        return config.data as T;
    }
    getRaw<T extends object>(filename: string, initial?:Partial<T>, schema?: Schema<T>): T {
        if(!this.configs.has(filename)) this.load(filename, initial, schema);
        const config = this.configs.get(filename);
        if(!config) throw new Error(`配置文件 ${filename} 未加载`);
        return config.raw as T;
    }
    /**
     * 更新配置文件内容
     * @param filename 配置文件名
     * @param data 新的配置数据
     */
    set<T extends object>(filename: string, data: T): void {
        const config = this.configs.get(filename);
        if(!config) throw new Error(`配置文件 ${filename} 未加载`);
        // 直接更新内部数据（会触发 Proxy 的 set 拦截器并自动保存）
        Object.assign(config.raw, data);
        config.save(path.resolve(process.cwd(), filename));
    }
}