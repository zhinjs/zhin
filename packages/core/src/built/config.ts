import path from "node:path";
import fs from "node:fs";
import { stringify as stringifyYaml,parse as parseYaml } from "yaml";
export class ConfigLoader<T extends object>{
    #data: T;
    get extension() {
        return path.extname(this.filename).toLowerCase();
    }
    constructor(public filename: string, public initial:T) {
        this.#data = this.initial;
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
        this.#data = rawConfig as T;
    }
    save(fullPath: string) {
        switch (this.extension) {
            case ".json":
                fs.writeFileSync(fullPath, JSON.stringify(this.initial, null, 2));
                break;
            case ".yaml":
            case ".yml":
                fs.writeFileSync(fullPath, stringifyYaml(this.initial));
                break;
        }
    }
}
export namespace ConfigLoader{
    export const supportedExtensions = [".json", ".yaml", ".yml"];
    export async function load<T extends object>(filename: string, initial:T) {
        const result = new ConfigLoader<T>(filename, initial);
        await result.load();
        return result;
    }
}
export class ConfigService{
    configs: Map<string, ConfigLoader<any>> = new Map();
    constructor() {
    }
    async load<T extends object>(filename: string, initial:Partial<T>) {
        const ext = path.extname(filename).toLowerCase();
        if (!ConfigLoader.supportedExtensions.includes(ext)) {
            throw new Error(`不支持的配置文件格式: ${ext}`);
        }
        const config = await ConfigLoader.load(filename, initial);
        this.configs.set(filename, config);
        return config;
    }
    async get<T extends object>(filename: string) {}
}