import {join, resolve} from 'path'
import {ref, watch} from 'obj-observer'
import {fork, ChildProcess} from "child_process";
import {Logger, getLogger, configure, Configuration} from "log4js";
import * as Yaml from 'js-yaml'
import * as path from 'path'
import * as fs from 'fs'
import {createServer, Server} from "http";
import KoaBodyParser from "koa-bodyparser";
import {Proxied} from 'obj-observer/lib/deepProxy'
import {Command} from "@/command";
import {Argv} from "@/argv";
import {
    deepClone,
    deepMerge,
    wrapExport,
    remove,
    isBailed,
    getPackageInfo,
    deepEqual,
    getCaller,
    getIpAddress
} from "@/utils";
import {Dict} from "@/types";
import {Context, Plugin, Plugins} from "@/context";
import Koa from "koa";
import {Adapter, AdapterOptionsType, Adapters} from "@/adapter";
import {Bots, Segment, Sendable} from "@/bot";
import {OicqEventMap} from './adapters/oicq'
import {Session} from "@/session";
import {Middleware} from "@/middleware";
import {Dispose} from "@/dispose";
import {Router} from "@/router";
import {Component} from "@/component";
import Element from "@/element";

interface Message {
    type: 'start' | 'queue'
    body: any
}

export type TargetType = 'group' | 'private' | 'discuss'
export type ChannelId = `${keyof Adapters}:${string | number}:${TargetType}:${number | string}`
let cp: ChildProcess

export function isConstructor<R, T>(value: any): value is (new (...args: any[]) => any) {
    return typeof value === 'function' && value.prototype && value.prototype.constructor === value
}

let buffer = null, timeStart: number

export function createWorker(options: App.Options | string = 'zhin.yaml') {
    if (typeof options !== 'string') fs.writeFileSync(join(process.cwd(), 'zhin.yaml'), Yaml.dump(options))
    cp = fork(join(__dirname, 'worker'), [], {
        env: {
            configPath: resolve(process.cwd(), typeof options === 'string' ? options : 'zhin.yaml')
        },
        execArgv: [
            '-r', 'esbuild-register',
            '-r', 'tsconfig-paths/register'
        ]
    })
    let config: { autoRestart: boolean }
    cp.on('message', (message: Message) => {
        if (message.type === 'start') {
            config = message.body
            if (buffer) {
                cp.send({type: 'send', body: buffer, times: timeStart})
                buffer = null
            }
        } else if (message.type === 'queue') {
            buffer = message.body
        }
    })
    const closingCode = [0, 130, 137]
    cp.on('exit', (code) => {
        if (!config || closingCode.includes(code) || code !== 51 && !config.autoRestart) {
            process.exit(code)
        }
        timeStart = new Date().getTime()
        createWorker(options)
    })
    return cp
}

process.on('SIGINT', () => {
    if (cp) {
        cp.emit('SIGINT')
    } else {
        process.exit()
    }
})

export function defineConfig(options: App.Options) {
    return options
}


export class App extends Context {
    isReady: boolean = false
    options: App.Options
    adapters: Map<keyof Adapters, Adapter> = new Map<keyof Adapters, Adapter>()
    services: Map<keyof App.Services, any> = new Map<keyof App.Services, any>()
    public logger: Logger
    public app: App = this

    constructor(options: App.Options) {
        super(null, null);
        if (options.logConfig) {
            configure(options.logConfig as Configuration)
        }
        this.logger = getLogger('[zhin]')
        this.logger.level = options.log_level || 'info'
        const _this = this
        const koa = new Koa()
        const server = createServer(koa.callback())
        const router = new Router(server, {prefix: ''})
        this.service('server', server)
            .service('koa', koa)
            .service('router', router)
        koa.use(KoaBodyParser())
            .use(router.routes())
            .use(router.allowedMethods())
        server.listen(options.port ||= 8086)
        this.logger.info(`server listen at ${getIpAddress().map(ip => `http://${ip}:${options.port}`).join(' and ')}`)
        this.options = ref(options)
        this.on('dispose',()=>{
            server.close()
        })
        this.middleware(async (session,next) => {
            const elements= await session.transform(Element.parse(Segment.stringify(session.segments)))
            session.segments=Segment.parse(elements.map((element)=>{
                if(Segment.isSegment(element)){
                    return Segment.stringify([element])
                }else{
                    return element.type==='text'?Segment.stringify([{
                        type:'text',
                        data:{
                            text:element.toString()
                        }
                    }]):element.toString()
                }
            }).join(''));
            const result=await session.execute()
            if(!result) return next()
            return session.reply(result)

        })
        return new Proxy(this, {
            get(target: typeof _this, p: string | symbol, receiver: any): any {
                let result = Reflect.get(target, p, receiver)
                if (result !== undefined) return result
                result = Reflect.get(target.services, p, receiver)
                return result
            }
        })
    }

    changeOptions(options: App.Options) {
        const changeValue = (source, key, value) => {
            if (source[key] && typeof source[key] === 'object') {
                Object.keys(source[key]).forEach(k => {
                    if (value[k] && typeof value[k] === 'object') {
                        changeValue(source[key], k, value[k])
                    } else if (value[k] === undefined) {
                        // 无则删除
                        delete source[key][k]
                        if(key==='plugins') this.dispose(k)
                    } else if(!deepEqual(source[key][k],value[k])){
                        // 有则更新
                        source[key][k] = value[k]
                        if(key==='plugins') {
                            this.dispose(k)
                            this.plugin(k)
                        }
                    }
                })
                Object.keys(value).forEach(k => {
                    if (source[key][k] === undefined) {
                        // 无则添加
                        source[key][k] = value[k]
                        if(key==='plugins') this.plugin(k)
                    }
                })
            } else {
                source[key] = value
            }
        }
        Object.keys(options).forEach(key => {
            if (!deepEqual(this.options[key], options[key])) {
                changeValue(this.options, key, options[key])
            }
        })
    }


    pickBot<K extends keyof Bots>(protocol: K, self_id: string | number): Bots[K] {
        return this.adapters.get(protocol).bots.get(self_id) as Bots[K]
    }

    emit(event, ...args) {
        const listeners = this.listeners(event)
        if (typeof event === "string" && !event.startsWith('before-') && !event.startsWith('after-')) {
            listeners.unshift(...this.listeners(`before-${event}`))
            listeners.push(...this.listeners(`after-${event}`))
        }
        for (const listener of listeners) {
            listener.apply(this, args)
        }
        return true
    }


    getLogger<K extends keyof Adapters>(protocol: K, self_id?: string | number) {
        return getLogger(`[zhin:protocol-${[protocol, self_id].filter(Boolean).join(':')}]`)
    }


    static getChannelId(event: Dict) {
        return [event.message_type, event.group_id || event.discuss_id || event.sender.user_id].join(':') as ChannelId
    }

    getCachedPluginList() {
        const result: Plugin[] = []
        if (fs.existsSync(resolve(process.cwd(), 'node_modules', '@zhinjs'))) {
            result.push(...fs.readdirSync(resolve(process.cwd(), 'node_modules', '@zhinjs')).map((str) => {
                if (/^plugin-/.test(str)) return `@zhinjs/${str}`
                return false
            }).filter(Boolean)
                .map((name) => this.load<Plugin>(name as string, 'plugin')))
        }
        if (fs.existsSync(resolve(process.cwd(), 'node_modules'))) {
            result.push(...fs.readdirSync(resolve(process.cwd(), 'node_modules')).map((str) => {
                if (/^zhinjs-plugin-/.test(str)) return str
                return false
            }).filter(Boolean)
                .map((name) => this.load<Plugin>(name as string, 'plugin')))
        }
        if (fs.existsSync(resolve(process.cwd(), this.options.plugin_dir))) {
            result.push(
                ...fs.readdirSync(resolve(process.cwd(), this.options.plugin_dir))
                    .map((name) => this.load<Plugin>(name.replace(/\.(d\.)?[d|j]s$/, ''), 'plugin'))
            )
        }
        if (fs.existsSync(resolve(__dirname, 'plugins'))) {
            result.push(...fs.readdirSync(resolve(__dirname, 'plugins'))
                .map((name) => this.load<Plugin>(name.replace(/\.(d\.)?[d|j]s$/, ''), 'plugin')))
        }
        return result
    }

    hasInstall(pluginName: string) {
        return !!this.pluginList.find(plugin => plugin.fullName === pluginName)
    }


    sendMsg(channelId: ChannelId, message: Sendable) {
        const [protocol, self_id, targetType, targetId] = channelId.split(':') as [keyof Adapters, `${string | number}`, TargetType, `${string | number}`]
        const adapter = this.adapters.get(protocol)
        const bot = adapter.bots.get(self_id)
        return bot.sendMsg(targetId, targetType, message)
    }


    use<P extends Plugin.Install>(plugin: P, options?: Plugin.Config<P>): this {
        this.plugin(plugin, options)
        return this
    }
    broadcast<P extends keyof Adapters, E extends keyof App.BotEventMaps[P]>(event: string, session: Session<P, E>){
        this.emit(event,session)
        for(const plugin of this.getSupportPlugins(session.protocol)){
            plugin.emit(event,session)
        }
    }
    public load<R = object>(name: string, type: string,setup?:boolean): R {
        function getListenDir(modulePath: string) {
            if (modulePath.endsWith('/index')) return modulePath.replace('/index', '')
            for (const extension of ['ts', 'js', 'cjs', 'mjs']) {
                if (fs.existsSync(`${modulePath}.${extension}`)) return `${modulePath}.${extension}`
            }
            return modulePath
        }

        function getResolvePath(moduleName: string) {
            try {
                return require.resolve(moduleName)
            } catch {
                return ''
            }
        }

        function getModulesPath(modules: string[]) {
            for (const moduleName of modules) {
                const result = getResolvePath(moduleName)
                if (result) return result
            }
            return ''
        }

        const getType = (resolvePath: string) => {
            if (resolvePath.includes(`@zhinjs/${type || 'plugin'}-`)) return 'official'
            if (resolvePath.includes(`zhin-${type || 'plugin'}-`)) return 'community'
            if (resolvePath.startsWith(path.resolve(__dirname, 'plugins'))) return 'built'
            return 'custom'
        }
        const resolved = getModulesPath([
            this.options[`${type || 'plugin'}_dir`] ? path.resolve(this.options[`${type || 'plugin'}_dir`], name) : null,// 用户自定义插件/服务/游戏目录
            path.join(__dirname, `${type || 'plugin'}s`, name), // 内置插件/服务/游戏目录
            `@zhinjs/${type || 'plugin'}-${name}`,// 官方插件/服务/游戏模块
            `zhin-${type || 'plugin'}-${name}`,// 社区插件/服务/游戏模块
        ].filter(Boolean))
        if (!resolved) throw new Error(`未找到${type || 'plugin'}(${name})`)
        const packageInfo = getPackageInfo(resolved)
        let result: Record<string, any> = {}
        if (packageInfo) {
            Object.assign(result, packageInfo)
            if (packageInfo.setup || setup) {
                result.install = () => {
                    wrapExport(resolved)
                }
            } else {
                Object.assign(result, wrapExport(resolved))
            }
        } else {
            Object.assign(result, wrapExport(resolved))
        }
        let fullName = resolved.replace(path.join(__dirname, `${type || 'plugin'}s`), '')
        if (this.options[`${type || 'plugin'}_dir`]) {
            fullName = fullName.replace(path.resolve(this.options[`${type || 'plugin'}_dir`]), '')
        }
        fullName = fullName.split('/')
            .filter(Boolean).join(':')
            .replace(/\.(d\.)?[t|j]s$/, '')
            .replace(/:index$/,'')
        return {
            ...result,
            author: JSON.stringify(result.author),
            desc: result.desc,
            using: result.using ||= [],
            type: getType(resolved),
            fullName: result.fullName || fullName,
            name: result.name || fullName,
            fullPath: getListenDir(resolved)
        } as any
    }
    getSupportPlugins(protocol:keyof Adapters){
        return this.pluginList.filter(plugin=>{
            return plugin.protocol===undefined || plugin.protocol.length===0 || plugin.protocol.includes(protocol)
        })
    }
    getSupportComponents(session:Session<keyof Adapters>){
        return this.getSupportPlugins(session.protocol).reduce((result:Dict<Component>,plugin)=>{
            Object.assign(result,plugin.componentList)
            return result
        },this.components)
    }
    getSupportMiddlewares(session:Session<keyof Adapters>){
        return this.getSupportPlugins(session.protocol).reduce((result:Middleware<Session>[],plugin)=>{
            result.push(...plugin.middlewareList)
            return result
        },[...this.middlewares])
    }
    getSupportCommands(argv:Argv){
        return this.getSupportPlugins(argv.session.protocol).reduce((result:Command[],plugin)=>{
            for(const command of plugin.commandList){
                if(command.match(argv.session)){
                    result.push(command)
                }
            }
            return result
        },[])
    }
    findCommand(argv: Argv) {
        return this.getSupportCommands(argv).find(cmd => {
            return cmd.name === argv.name
                || cmd.aliasNames.includes(argv.name)
                || cmd.shortcuts.some(({name}) => typeof name === 'string' ? name === argv.name : name.test(argv.name))
        })
    }

    async start() {
        for (const adapter of Object.keys(this.options.adapters || {})) {
            try {
                this.adapter(adapter as keyof Adapters, this.options.adapters[adapter])
            } catch (e) {
                this.logger.warn(e.message, e.stack)
            }
        }
        for (const pluginName of Object.keys(this.options.plugins)) {
            try {
                this.plugin(pluginName, this.options.plugins[pluginName])
            } catch (e) {
                this.logger.warn(e.message, e.stack)
            }
        }
        await this.emitSync('ready')
        this.isReady = true
        await this.emitSync('start')
    }

    async emitSync(event, ...args) {
        const listeners = this.listeners(event)
        if (typeof event === "string") {
            listeners.unshift(...this.listeners(`before-${event}`))
            listeners.push(...this.listeners(`after-${event}`))
        }
        for (const listener of listeners) {
            await listener.apply(this, args)
        }
    }

    bail(event, ...args) {
        let result
        const listeners = this.listeners(event)
        if (typeof event === "string") {
            listeners.unshift(...this.listeners(`before-${event}`))
            listeners.push(...this.listeners(`after-${event}`))
        }
        for (const listener of listeners) {
            result = listener.apply(this, args)
            if (isBailed(result)) return result
        }
    }

    async bailSync(event, ...args) {
        let result
        const listeners = this.listeners(event)
        if (typeof event === "string") {
            listeners.unshift(...this.listeners(`before-${event}`))
            listeners.push(...this.listeners(`after-${event}`))
        }
        for (const listener of listeners) {
            result = await listener.apply(this, args)
            if (isBailed(result)) return result
        }
    }

    stop() {
        this.dispose()
        process.exit()
    }
}


export namespace App {
    export const key = Symbol('Zhin')
    export const Services:(keyof Services)[]=[]
    export interface Services {
        koa: Koa
        router: Router
        server: Server
    }

    export const defaultConfig: Partial<Options> = {
        port: 8086,
        protocols: {
            oicq: {
                bots: []
            },
            onebot: {
                bots: []
            }
        },
        data_dir: path.join(process.cwd(), 'data'),
        plugin_dir: path.join(process.cwd(), 'plugins'),
        plugins: {},
        log_level: 'info',
        services: {},
        delay: {
            prompt: 60000
        },
        logConfig: {
            appenders: {
                consoleOut: {
                    type: 'console'
                },
                saveFile: {
                    type: 'file',
                    filename: path.join(process.cwd(), 'logs.log')
                }
            },
            categories: {
                default: {
                    appenders: ['consoleOut','saveFile'],
                    level: 'info'
                }
            }
        },
    }
    type BeforeEventMap<T> = {} & BeforeLifeCycle

    type AfterEventMap<T> = {} & AfterLifeCycle
    type BeforeLifeCycle = {
        [P in keyof LifeCycle as `before-${P}`]: LifeCycle[P]
    }
    type AfterLifeCycle = {
        [P in keyof LifeCycle as `after-${P}`]: LifeCycle[P]
    }


    export interface LifeCycle {
        start(): void

        'ready'(): void

        'dispose'(): void

        'command-add'(command: Command): void

        'command-remove'(command: Command): void

        'plugin-add'(plugin: Plugin): void

        'plugin-remove'(plugin: Plugin): void
    }

    export type BaseEventMap = Record<string, (...args: any[]) => any>

    export interface BotEventMaps extends Record<keyof Adapters, BaseEventMap>{
        oicq: OicqEventMap
        onebot:BaseEventMap
    }

    export interface AllEventMap<T> extends LifeCycle, BeforeEventMap<T>, AfterEventMap<T> {
    }

    export type AdapterConfig = {
        [P in keyof Adapters]?: AdapterOptionsType<Adapters[P]>
    }
    type PluginConfig<P extends Plugin> = P extends Plugin<infer R> ? R : unknown
    export type PluginConfigs = {
        [P in keyof Plugins]?: PluginConfig<Plugins[P]>
    }
    export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal" | "mark" | "off"
    type KVMap<V = any, K extends string = string> = Record<K, V>

    export interface Options extends KVMap {
        port: number
        log_level: LogLevel
        logConfig?: Partial<Configuration>
        delay: Record<string, number>
        plugins?: PluginConfigs
        services?: Record<string, any>
        protocols?: Partial<AdapterConfig>
        protocol_dir?: string
        plugin_dir?: string
        data_dir?: string
    }

    export type Keys<O extends KVMap> = O extends KVMap<infer V, infer K> ? V extends object ? `${K}.${Keys<V>}` : `${K}` : never
    export type Value<O extends KVMap, K> = K extends `${infer L}.${infer R}` ? Value<O[L], R> : K extends keyof O ? O[K] : any

    export type ServiceConstructor<R, T = any> = new (bot: App, options?: T) => R
}

function createAppAPI() {
    const contextMap: Map<string | symbol, App> = new Map<string | symbol, App>()
    const createApp = (options: Partial<App.Options> | string) => {
        if (contextMap.get(App.key)) return contextMap.get(App.key)
        if (typeof options === 'string') {
            if (!fs.existsSync(options)) fs.writeFileSync(options, Yaml.dump({
                protocols: {
                    oicq: {
                        bots: []
                    }
                },
                plugins: {
                    config: null,
                    daemon: null,
                    help: null,
                    login: null,
                    logs: null,
                    plugin: null,
                    status: null,
                },
                log_level: 'info',
                delay: {
                    prompt: 60000
                },
            }))
            options = Yaml.load(fs.readFileSync(options, {encoding: 'utf8'}))
        }
        const app = new App(deepMerge(deepClone(App.defaultConfig), options))
        contextMap.set(App.key, app)
        return app
    }
    const useContext = () => {
        const app = contextMap.get(App.key)
        if (!app) throw new Error(`can't found app with context for key:${App.key.toString()}`)
        const callSite = getCaller()
        const pluginFullPath = callSite.getFileName()
        const context=app.pluginList.find(plugin => plugin.fullPath === pluginFullPath) as Context
        if(context) return context
        const pluginDir=path.dirname(pluginFullPath)
        const reg=new RegExp(`${pluginDir}/index\.[tj]s`)
        const parent=app.pluginList.find(plugin=>{
            return plugin.fullPath.match(reg)
        })
        if(parent){
            parent.plugin(pluginFullPath,true)
            return app.pluginList.find(plugin => plugin.fullPath === pluginFullPath) as Context
        }
        app.plugin(pluginFullPath,true)
        return app.pluginList.find(plugin => plugin.fullPath === pluginFullPath) as Context
    }

    function getValue<T>(obj: T, path: string[]) {
        if (!obj || typeof obj !== 'object') return obj
        let result = obj
        while (path.length) {
            const key = path.shift()
            result = result[key] || {}
        }
        return result
    }

    function useOptions<K extends App.Keys<App.Options>>(path: K): App.Value<App.Options, K> {
        const app = contextMap.get(App.key)
        if (!app) throw new Error(`can't found app with context for key:${App.key.toString()}`)
        return getValue(app.options, path.split('.').filter(Boolean)) as App.Value<App.Options, K>
    }

    type EffectReturn = () => void
    type EffectCallBack<T = any> = (value?: T, oldValue?: T) => void | EffectReturn

    function useEffect<T extends object = object>(callback: EffectCallBack<T>, effect?: Proxied<T>) {
        const app = contextMap.get(App.key)
        if (!app) throw new Error(`can't found app with context for key:${App.key.toString()}`)
        const callSite = getCaller()
        const pluginFullPath = callSite.getFileName()
        const plugin = app.pluginList.find(plugin => plugin.fullPath === pluginFullPath)
        if (!effect) {
            const dispose = callback()
            if (dispose) {
                plugin.on('dispose',dispose)
            }
        } else {
            const unWatch = watch(effect, callback)
            plugin.on('dispose',unWatch)
        }

    }
    function onDispose(callback:Dispose){
        const app = contextMap.get(App.key)
        if (!app) throw new Error(`can't found app with context for key:${App.key.toString()}`)
        const callSite = getCaller()
        const pluginFullPath = callSite.getFileName()
        const plugin = app.pluginList.find(plugin => plugin.fullPath === pluginFullPath)
        plugin.on('dispose',callback)
    }
    return {
        createApp,
        useContext,
        useEffect,
        onDispose,
        useOptions
    }
}

const {createApp, useContext,onDispose, useEffect, useOptions} = createAppAPI()
export {
    createApp,
    useContext,
    useEffect,
    onDispose,
    useOptions
}
