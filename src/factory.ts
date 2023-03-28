import fs from "fs";
import * as Yaml from "js-yaml";
import {deepClone, deepEqual, deepMerge, getCaller, getValue} from "@zhinjs/shared";
import path from "path";
import {watch} from "obj-observer";
import {Proxied} from "obj-observer/lib/deepProxy";
import {Dispose} from "@/dispose";
import {Argv, Command, Component, TriggerSessionMap, Zhin} from "@";
import {Context} from "@/context";
import {Middleware} from "@/middleware";

export function createZhinAPI() {
    const zhinMap: Map<string | symbol, Zhin> = new Map<string | symbol, Zhin>()
    const createZhin = (options: Partial<Zhin.Options> | string) => {
        if (zhinMap.get(Zhin.key)) return zhinMap.get(Zhin.key)
        if (typeof options === 'string') {
            if (!fs.existsSync(options)) fs.writeFileSync(options, Yaml.dump({
                protocols: {
                    oicq: {
                        bots: []
                    }
                },
                plugins: {
                },
                log_level: 'info',
                delay: {
                    prompt: 60000
                },
            }))
            options = Yaml.load(fs.readFileSync(options, {encoding: 'utf8'}))
        }
        const zhin = new Zhin(deepMerge(deepClone(Zhin.defaultConfig), options))
        zhinMap.set(Zhin.key, zhin)
        return zhin
    }
    // 获取插件上下文
    const useContext = () => {
        const callSite = getCaller()
        const pluginFullPath = callSite.getFileName()
        return getContext(pluginFullPath)
    }
    const getContext=(pluginFullPath:string)=>{
        const zhin = zhinMap.get(Zhin.key)
        if (!zhin) throw new Error(`can't found zhin with context for key:${Zhin.key.toString()}`)
        const context=zhin.pluginList.find(plugin => plugin.options.fullPath === pluginFullPath)?.context
        if (context) return context
        const pluginDir = path.dirname(pluginFullPath)
        const reg = new RegExp(`${pluginDir}/index\.[tj]s`)
        const parent = zhin.pluginList.find(plugin => {
            return plugin.options.fullPath.match(reg)
        })
        if (parent) {
            parent.context.plugin(pluginFullPath)
            return zhin.pluginList.find(plugin => plugin.options.fullPath === pluginFullPath).context
        }
        zhin.plugin(pluginFullPath)
        return zhin.pluginList.find(plugin => plugin.options.fullPath === pluginFullPath).context
    }
    // 定义一个指令
    const defineCommand=<D extends string, T extends keyof TriggerSessionMap>(decl: D, trigger?: T)=>{
        const command=new Command('{placeholder} '+decl)
        command.trigger=trigger
        return command as Command<Argv.ArgumentType<`{placeholder} ${D}`>, {}, T>
    }
    // 添加指定组件到插件中
    const useComponent=(name:string,component:Component)=>{
        const zhin = zhinMap.get(Zhin.key)
        if (!zhin) throw new Error(`can't found zhin with context for key:${Zhin.key.toString()}`)
        const callSite = getCaller()
        const pluginFullPath = callSite.getFileName()
        const context=getContext(pluginFullPath)
        context.component(name,component)
    }
    // 添加指定事件监听到插件中
    const on=<T extends keyof Zhin.EventMap<Context>>(event: T, listener: Zhin.EventMap<Context>[T])=>{
        const zhin = zhinMap.get(Zhin.key)
        if (!zhin) throw new Error(`can't found zhin with context for key:${Zhin.key.toString()}`)
        const callSite = getCaller()
        const pluginFullPath = callSite.getFileName()
        const context=getContext(pluginFullPath)
        return context.on(event,listener)
    }
    // 监听指定事件监听一次到插件中
    const once=<T extends keyof Zhin.EventMap<Context>>(event: T, listener: Zhin.EventMap<Context>[T])=>{
        const zhin = zhinMap.get(Zhin.key)
        if (!zhin) throw new Error(`can't found zhin with context for key:${Zhin.key.toString()}`)
        const callSite = getCaller()
        const pluginFullPath = callSite.getFileName()
        const context=getContext(pluginFullPath)
        return context.once(event,listener)
    }
    // 添加插件到插件中
    const useMiddleware=(middleware:Middleware)=>{
        const zhin = zhinMap.get(Zhin.key)
        if (!zhin) throw new Error(`can't found zhin with context for key:${Zhin.key.toString()}`)
        const callSite = getCaller()
        const pluginFullPath = callSite.getFileName()
        const context=getContext(pluginFullPath)
        return context.middleware(middleware)
    }
    // 添加指令到插件中
    const useCommand=(name:string,command:Command)=>{
        const zhin = zhinMap.get(Zhin.key)
        if (!zhin) throw new Error(`can't found zhin with context for key:${Zhin.key.toString()}`)
        const callSite = getCaller()
        const pluginFullPath = callSite.getFileName()
        const context=getContext(pluginFullPath)
        const elements = name.split(/(?=[/])/g)
        let parent: Command, nameArr = []
        while (elements.length) {
            const segment = elements.shift()
            const code = segment.charCodeAt(0)
            const tempName = code === 47 ? segment.slice(1) : segment
            nameArr.push(tempName)
            if (elements.length) parent = zhin.commandList.find(cmd => cmd.name === tempName)
            if (!parent && elements.length) throw Error(`cannot find parent command:${nameArr.join('.')}`)
        }
        command.name=nameArr.pop()
        command.context=context
        if (parent) {
            command.parent = parent
            parent.children.push(command)
        }
        context.commands.set(name, command)
        zhin.emit('command-add', command, context)
        context.disposes.push(() => {
            context.commands.delete(name)
            zhin.emit('command-remove', command, context)
        })
    }
    // 读取指定path的配置文件
    function useOptions<K extends Zhin.Keys<Zhin.Options>>(path: K): Zhin.Value<Zhin.Options, K> {
        const zhin = zhinMap.get(Zhin.key)
        if (!zhin) throw new Error(`can't found zhin with context for key:${Zhin.key.toString()}`)
        const callSite = getCaller()
        const pluginFullPath = callSite.getFileName()
        const plugin = zhin.pluginList.find(plugin => plugin.options.fullPath === pluginFullPath)
        const pathArr = path.split('.').filter(Boolean)
        const result = getValue(zhin.options, pathArr)
        const backupData = deepClone(result)
        const unwatch = watch(zhin.options, (value) => {
            const newVal = getValue(value, pathArr)
            if (!deepEqual(backupData, newVal)) {
                plugin.reLoad()
            }
        })
        plugin.context.disposes.push(unwatch)
        return getValue(zhin.options, path.split('.').filter(Boolean)) as Zhin.Value<Zhin.Options, K>
    }

    type EffectReturn = () => void
    type EffectCallBack<T = any> = (value?: T, oldValue?: T) => void | EffectReturn

    /**
     * 添加插件副作用，类似react的useEffect使用方法
     * @param callback
     * @param effect
     */
    function useEffect<T extends object = object>(callback: EffectCallBack<T>, effect?: Proxied<T>) {
        const zhin = zhinMap.get(Zhin.key)
        if (!zhin) throw new Error(`can't found zhin with context for key:${Zhin.key.toString()}`)
        const callSite = getCaller()
        const pluginFullPath = callSite.getFileName()
        const plugin = zhin.pluginList.find(plugin => plugin.options.fullPath === pluginFullPath)
        if (!effect) {
            const dispose = callback()
            if (dispose) {
                plugin.context.on('dispose', dispose)
            }
        } else {
            const unWatch = watch(effect, callback)
            plugin.context.on('dispose', unWatch)
        }

    }

    /**
     * 添加插件卸载副作用
     * @param callback
     */
    function onDispose(callback: Dispose) {
        const zhin = zhinMap.get(Zhin.key)
        if (!zhin) throw new Error(`can't found zhin with context for key:${Zhin.key.toString()}`)
        const callSite = getCaller()
        const pluginFullPath = callSite.getFileName()
        const plugin = zhin.pluginList.find(plugin => plugin.options.fullPath === pluginFullPath)
        plugin.context.on('dispose', callback)
    }

    return {
        createZhin,
        useContext,
        useEffect,
        listen:on,
        listenOnce:once,
        useMiddleware,
        useCommand,
        useComponent,
        defineCommand,
        onDispose,
        useOptions
    }
}