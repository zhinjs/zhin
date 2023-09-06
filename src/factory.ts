import fs from "fs";
import * as Yaml from "js-yaml";
import { deepClone, deepEqual, deepMerge, getCaller, getValue, Keys, Value } from "@zhinjs/shared";
import path from "path";
import { watch } from "obj-observer";
import { Proxied } from "obj-observer/lib/deepProxy";
import { Dispose } from "@/dispose";
import { Command, Component, Zhin } from "@";
import { Context } from "@/context";
import { Middleware } from "@/middleware";

export function createZhinAPI() {
    const zhinMap: Map<string | symbol, Zhin> = new Map<string | symbol, Zhin>();
    const createZhin = (options: Partial<Zhin.Options> | string, key = Zhin.key) => {
        if (zhinMap.get(key)) return zhinMap.get(key);
        if (typeof options === "string") {
            if (!fs.existsSync(options))
                fs.writeFileSync(
                    options,
                    Yaml.dump({
                        protocols: {
                            oicq: {
                                bots: [],
                            },
                        },
                        plugins: {},
                        log_level: "info",
                        delay: {
                            prompt: 60000,
                        },
                    }),
                );
            options = Yaml.load(fs.readFileSync(options, { encoding: "utf8" }));
        }
        const zhin = new Zhin(deepMerge(deepClone(Zhin.defaultConfig), options));
        zhinMap.set(key, zhin);
        return zhin;
    };
    // 获取插件上下文
    const useContext = (zhinKey = Zhin.key) => {
        const callSite = getCaller();
        const pluginFullPath = callSite.getFileName();
        return getContext(pluginFullPath, zhinKey);
    };
    const getContext = (pluginFullPath: string, key = Zhin.key) => {
        const zhin = zhinMap.get(key);
        if (!zhin) throw new Error(`can't found zhin with context for key:${key.toString()}`);
        const context = zhin.pluginList.find(plugin => plugin.options.fullPath === pluginFullPath)
            ?.context;
        if (context) return context;
        const pluginDir = path.dirname(pluginFullPath);
        const reg = new RegExp(`${pluginDir}/index\.[tj]s`);
        const parent = zhin.pluginList.find(plugin => {
            return plugin.options.fullPath?.match(reg);
        });
        if (parent) {
            parent.context.plugin(pluginFullPath);
            return zhin.pluginList.find(plugin => plugin.options.fullPath === pluginFullPath)
                .context;
        }
        zhin.plugin(pluginFullPath);
        return zhin.pluginList.find(plugin => plugin.options.fullPath === pluginFullPath).context;
    };
    // 添加指定组件到插件中
    const useComponent = (name: string, component: Component, key = Zhin.key) => {
        const zhin = zhinMap.get(key);
        if (!zhin) throw new Error(`can't found zhin with context for key:${key.toString()}`);
        const callSite = getCaller();
        const pluginFullPath = callSite.getFileName();
        const context = getContext(pluginFullPath);
        context.component(name, component);
    };
    // 添加指定事件监听到插件中
    const on = <T extends keyof Zhin.EventMap<Context>>(
        event: T,
        listener: Zhin.EventMap<Context>[T],
        key = Zhin.key,
    ) => {
        const zhin = zhinMap.get(key);
        if (!zhin) throw new Error(`can't found zhin with context for key:${key.toString()}`);
        const callSite = getCaller();
        const pluginFullPath = callSite.getFileName();
        const context = getContext(pluginFullPath);
        return context.on(event, listener);
    };
    // 监听指定事件监听一次到插件中
    const once = <T extends keyof Zhin.EventMap<Context>>(
        event: T,
        listener: Zhin.EventMap<Context>[T],
        zhinKey = Zhin.key,
    ) => {
        const zhin = zhinMap.get(zhinKey);
        if (!zhin) throw new Error(`can't found zhin with context for key:${zhinKey.toString()}`);
        const callSite = getCaller();
        const pluginFullPath = callSite.getFileName();
        const context = getContext(pluginFullPath);
        return context.once(event, listener);
    };
    // 添加插件到插件中
    const useMiddleware = (middleware: Middleware, zhinKey = Zhin.key) => {
        const zhin = zhinMap.get(zhinKey);
        if (!zhin) throw new Error(`can't found zhin with context for key:${zhinKey.toString()}`);
        const callSite = getCaller();
        const pluginFullPath = callSite.getFileName();
        const context = getContext(pluginFullPath);
        return context.middleware(middleware) as Dispose;
    };
    // 添加指令到插件中
    const useCommand = <A extends any[], O = {}>(
        name: string,
        command: Command<A, O>,
        zhinKey = Zhin.key,
    ) => {
        const zhin = zhinMap.get(zhinKey);
        if (!zhin) throw new Error(`can't found zhin with context for key:${zhinKey.toString()}`);
        const callSite = getCaller();
        const pluginFullPath = callSite.getFileName();
        const context = getContext(pluginFullPath);
        context.useCommand(name, command);
    };

    type EffectReturn = () => void;
    type EffectCallBack<T = any> = (value?: T, oldValue?: T) => void | EffectReturn;

    /**
     * 添加插件副作用，类似react的useEffect使用方法
     * @param callback
     * @param effect
     * @param zhinKey
     */
    function useEffect<T extends object = object>(
        callback: EffectCallBack<T>,
        effect?: Proxied<T>,
        zhinKey = Zhin.key,
    ) {
        const zhin = zhinMap.get(zhinKey);
        if (!zhin) throw new Error(`can't found zhin with context for key:${zhinKey.toString()}`);
        const callSite = getCaller();
        const pluginFullPath = callSite.getFileName();
        const plugin = zhin.pluginList.find(plugin => plugin.options.fullPath === pluginFullPath);
        if (!effect) {
            const dispose = callback();
            if (dispose) {
                plugin.context.on("dispose", dispose);
            }
        } else {
            const unWatch = watch(effect, callback);
            plugin.context.on("dispose", unWatch);
        }
    }

    /**
     * 添加插件卸载副作用
     * @param callback
     * @param zhinKey
     */
    function onDispose(callback: Dispose, zhinKey = Zhin.key) {
        const zhin = zhinMap.get(zhinKey);
        if (!zhin) throw new Error(`can't found zhin with context for key:${zhinKey.toString()}`);
        const callSite = getCaller();
        const pluginFullPath = callSite.getFileName();
        const plugin = zhin.pluginList.find(plugin => plugin.options.fullPath === pluginFullPath);
        plugin.context.on("dispose", callback);
    }

    return {
        createZhin,
        useContext,
        useEffect,
        listen: on,
        listenOnce: once,
        useMiddleware,
        useCommand,
        useComponent,
        onDispose,
    };
}
