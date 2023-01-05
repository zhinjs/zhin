import {join, resolve, dirname} from 'path'
import {fork, ChildProcess} from "child_process";
import {Logger, getLogger, configure, Configuration} from "log4js";
import * as Yaml from 'js-yaml'
import * as path from 'path'
import * as fs from 'fs'
import {Command, TriggerEventMap} from "@/command";
import {Argv} from "@/argv";
import {deepClone, deepMerge, wrapExport, remove, isBailed} from "@/utils";
import {Dict} from "@/types";
import {Plugin} from "@/plugin";
import Koa from "koa";
import {Adapter, AdapterConstructs, AdapterOptions, AdapterOptionsType, Adapters} from "@/adapter";
import {Bots, Sendable} from "@/bot";
import {EventEmitter} from "events";
import {OicqEventMap} from './adapters/oicq'
import {FunctionToSessionObj, ParametersToObj, Session, ToSession} from "@/session";

interface Message {
    type: 'start' | 'queue'
    body: any
}

export type TargetType = 'group' | 'private' | 'discuss'
export type ChannelId = `${keyof Adapters}:${string|number}:${TargetType}:${number|string}`
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

export function createApp(options: Partial<App.Options> | string) {
    if (typeof options === 'string') {
        if (!fs.existsSync(options)) fs.writeFileSync(options, Yaml.dump(App.defaultConfig))
        options = Yaml.load(fs.readFileSync(options, {encoding: 'utf8'}))
    }
    return new App(deepMerge(deepClone(App.defaultConfig), options))
}

export function defineConfig(options: App.Options) {
    return options
}


export class App extends EventEmitter {
    isReady: boolean = false
    plugins: Map<string, Plugin> = new Map<string, Plugin>()
    adapters:Map<keyof Adapters,Adapter>=new Map<keyof Adapters, Adapter>()
    private services: Record<string, any> = {}
    disposes: App.Dispose<any>[] = []
    commands: Map<string, Command> = new Map<string, Command>()
    master: number
    admins: number[]
    public logger: Logger

    constructor(public options: App.Options) {
        super();
        if (options.logConfig) {
            configure(options.logConfig as Configuration)
        }
        this.service('koa', new Koa())
        this.logger = getLogger('zhin')
        this.logger.level = options.log_level || 'info'
        if (!options.uin) throw new Error('need client account')
        this.master = options.master
        this.admins = [].concat(options.admins).filter(Boolean)
        const _this = this
        this.on('dispose', () => {
            while (this.disposes.length) {
                const dispose = this.disposes.shift()
                dispose()
            }
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

    on(event, listener): App.Dispose<this> {
        super.on(event, listener)
        const dispose: App.Dispose<this> = (() => {
            super.off(event, listener)
        }) as App.Dispose<this>
        const _this = this
        return new Proxy(dispose, {
            get(target: App.Dispose<typeof _this>, p: string | symbol, receiver: any): any {
                return Reflect.get(_this, p, receiver)
            }
        })
    }
    adapter<K extends keyof Adapters>(platform:K):Adapters[K]
    adapter<K extends keyof Adapters>(platform:K,options:AdapterOptionsType<Adapters[K]>):this
    adapter<K extends keyof Adapters>(platform:K,adapter:AdapterConstructs[K],options:AdapterOptionsType<Adapters[K]>):this
    adapter<K extends keyof Adapters>(platform:K,Construct?:AdapterConstructs[K]|AdapterOptions,options?:AdapterOptions){
        if(!Construct && ! options) return this.adapters.get(platform)
        if(typeof Construct!=="function") {
            this.load(platform,'adapter')
            options=Construct as AdapterOptions
            Construct=Adapter.get(platform).Adapter as unknown as AdapterConstructs[K]
        }
        if(!Construct) throw new Error(`can't find adapter fom platform:${platform}`)
        this.adapters.set(platform,new Construct(this,platform,options))
        return this
    }
    pickBot<K extends keyof Bots>(platform:K,self_id:string|number):Bots[K]{
        return this.adapters.get(platform).bots.get(self_id) as Bots[K]
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

    service<K extends keyof App.Services>(key: K): App.Services[K]
    service<K extends keyof App.Services>(key: K, service: App.Services[K]): this
    service<K extends keyof App.Services, T>(key: K, constructor: App.ServiceConstructor<App.Services[K], T>, options?: T): this
    service<K extends keyof App.Services, T>(key: K, Service?: App.Services[K] | App.ServiceConstructor<App.Services[K], T>, options?: T): App.Services[K] | this {
        if (Service === undefined) {
            return this.services[key]
        }
        if (this[key]) throw new Error('服务key不能和bot已有属性重复')
        if (isConstructor(Service)) {
            this.services[key] = new Service(this, options)
        } else {
            this.services[key] = Service
        }
        return this
    }

    isMaster(user_id: number) {
        return this.master === user_id
    }

    isAdmin(user_id: number) {
        return this.admins.includes(user_id)
    }

    static getChannelId(event: Dict) {
        return [event.message_type, event.group_id || event.discuss_id || event.sender.user_id].join(':') as ChannelId
    }

    get commandList() {
        return [...this.commands.values()].flat()
    }

    get pluginList() {
        const result: Plugin[] = []
        if (fs.existsSync(resolve(process.cwd(), 'node_modules', '@zhinjs'))) {
            result.push(...fs.readdirSync(resolve(process.cwd(), 'node_modules', '@zhinjs')).map((str) => {
                if (/^plugin-/.test(str)) return `@zhinjs/${str}`
                return false
            }).filter(Boolean)
                .map((name) => this.load(name as string)))
        }
        if (fs.existsSync(resolve(process.cwd(), 'node_modules'))) {
            result.push(...fs.readdirSync(resolve(process.cwd(), 'node_modules')).map((str) => {
                if (/^zhinjs-plugin-/.test(str)) return str
                return false
            }).filter(Boolean)
                .map((name) => this.load(name as string)))
        }
        if (fs.existsSync(resolve(process.cwd(), this.options.plugin_dir))) {
            result.push(
                ...fs.readdirSync(resolve(process.cwd(), this.options.plugin_dir))
                    .map((name) => this.load(name.replace(/\.(d\.)?[d|j]s$/, '')))
            )
        }
        if (fs.existsSync(resolve(__dirname, 'plugins'))) {
            result.push(...fs.readdirSync(resolve(__dirname, 'plugins'))
                .map((name) => this.load(name.replace(/\.(d\.)?[d|j]s$/, ''))))
        }
        return result
    }

    hasInstall(pluginName: string) {
        return !![...this.plugins.values()].find(plugin => plugin.fullName === pluginName)
    }

    plugin<T>(name: string, options?: T): Plugin | this
    plugin<T>(plugin: Plugin<T>, options?: T): this
    plugin<T>(entry: string | Plugin<T>, options?: T) {
        let plugin: Plugin
        if (typeof entry === 'string') {
            const result = this.plugins.get(entry)
            if (result) return result
            try {
                plugin = this.load(entry)
            } catch (e) {
                this.logger.warn(e.message)
                return this
            }
        } else {
            plugin = entry
        }
        plugin.anonymousCount = 0
        plugin.children = []
        const _this = this
        const proxy = new Proxy(this, {
            get(target: typeof _this, p: PropertyKey, receiver: any): any {
                const proxyEvents = ['on', 'plugin', 'command']
                const result = Reflect.get(target, p, receiver)
                if (typeof result !== 'function' || typeof p !== 'string' || !proxyEvents.includes(p)) return result
                // @ts-ignore
                return new Proxy(result, {apply(target: typeof _this, thisArg: any, argArray?: any): any {
                        if (p === 'plugin') {
                            let [entry, config] = argArray
                            if (typeof entry !== 'string') {
                                if (typeof entry === "function") {
                                    entry = {
                                        name: `${plugin.name}:${entry.name}`,
                                        install: entry,
                                        functional: true
                                    }
                                    if (entry.install.prototype === undefined) {
                                        plugin.anonymousCount++
                                        entry.name = `${plugin.name}:anonymous${plugin.anonymousCount}`
                                    }
                                }
                                plugin.children.push(entry)
                            } else if (entry.startsWith('./')) {
                                entry = {
                                    name: `${plugin.name}:${entry.replace('./', '')}`,
                                    install: _this.load(resolve(dirname(plugin.fullPath), entry)).install
                                }
                            }
                            return result.apply(thisArg, [entry, config])
                        }
                        let res = result.apply(thisArg, argArray)
                        if (res instanceof Command) {
                            (plugin).disposes.push(() => {
                                _this.commands.delete(res.name)
                                _this.emit('command-remove', res)
                                return true
                            })
                        } else {
                            plugin.disposes.push(res)
                        }
                        return res
                    }
                })
            }
        })
        const installPlugin = () => {
            plugin.disposes = []
            plugin.dispose = function () {
                while (this.disposes.length) {
                    const dispose = this.disposes.shift()
                    dispose()
                }
                plugin.disposes = []
                return true
            }
            const installFunction = typeof plugin === "function" ? plugin : plugin.install
            if (this.plugins.get(plugin.name)) {
                this.logger.warn('重复载入:' + plugin.name)
                return
            }
            const result = installFunction.apply(plugin, [proxy, options])
            if (typeof result === 'function') {
                plugin.disposes.push(result)
            }
            this.plugins.set(plugin.name, plugin)
            this.logger.info('已载入:' + plugin.name)
            this.emit('plugin-add', plugin)
        }
        const using = plugin.using ||= []
        if (!using.length) {
            installPlugin()
        } else {
            if (!using.every(name => this.plugins.has(name))) {
                this.logger.info(`插件(${plugin.name})将在所需插件(${using.join()})加载完毕后加载`)
                const dispose = this.on('plugin-add', () => {
                    if (using.every(name => this.plugins.has(name))) {
                        dispose()
                        installPlugin()
                    }
                })
            } else {
                installPlugin()
            }
        }
        return this
    }

    command<T extends keyof TriggerEventMap, D extends string>(def: D, triggerEvent?: T): Command<T, Argv.ArgumentType<D>> {
        const namePath = def.split(' ', 1)[0]
        const decl = def.slice(namePath.length)
        const segments = namePath.split(/(?=[/])/g)

        let parent: Command, nameArr = []
        while (segments.length) {
            const segment = segments.shift()
            const code = segment.charCodeAt(0)
            const tempName = code === 47 ? segment.slice(1) : segment
            nameArr.push(tempName)
            if (segments.length) parent = this.commandList.find(cmd => cmd.name === tempName)
            if (!parent && segments.length) throw Error(`cannot find parent command:${nameArr.join('.')}`)
        }
        const name = nameArr.pop()
        const command = new Command(name + decl, triggerEvent)
        command.bot = this
        if (parent) {
            command.parent = parent
            parent.children.push(command)
        }
        this.commands.set(name, command)
        this.emit('command-add', command)
        return command as any
    }

    sendMsg(channelId: ChannelId, message: Sendable) {
        const [platform,self_id,targetType, targetId] = channelId.split(':') as [keyof Adapters,`${string|number}`,TargetType, `${string|number}`]
        const adapter=this.adapters.get(platform)
        const bot=adapter.bots.get(self_id)
        return bot.sendMsg(targetId,targetType,message)
    }

    setTimeout(callback: Function, ms: number, ...args): App.Dispose<this> {
        const timer = setTimeout(() => {
            callback()
            dispose()
            remove(this.disposes, dispose)
        }, ms, ...args)
        const dispose = (() => clearTimeout(timer)) as App.Dispose<this>
        this.disposes.push(dispose)
        const _this = this
        return new Proxy(dispose, {
            get(target: App.Dispose<typeof _this>, p: string | symbol, receiver: any): any {
                return Reflect.get(_this, p, receiver)
            }
        })
    }

    setInterval(callback: Function, ms: number, ...args): App.Dispose<this> {
        const timer = setInterval(callback, ms, ...args)
        const dispose = (() => clearInterval(timer)) as App.Dispose<this>
        this.disposes.push(dispose)
        const _this = this
        return new Proxy(dispose, {
            get(target: App.Dispose<typeof _this>, p: string | symbol, receiver: any): any {
                return Reflect.get(_this, p, receiver)
            }
        })
    }

    use<T=any>(plugin:Plugin.Object<T>,options?:T): this {
        this.plugin(plugin,options)
        return this
    }

    dispose<T>(plugin?: Plugin<T> | string) {
        if (!plugin) {
            this.plugins.forEach(plugin => {
                this.dispose(plugin)
            })
            this.emit('dispose');
            return this
        }
        if (typeof plugin === 'string') {
            plugin = this.plugins.get(plugin)
        }
        if (!plugin) return this
        plugin.dispose()
        this.plugins.delete(plugin.name)
        if (plugin.children) {
            plugin.children.forEach((p) => this.dispose(p))
        }
        this.logger.info('已移除:' + plugin.name)
        this.emit('plugin-remove', plugin)
        return this
    }

    public load<T extends keyof App.LoadTypes='plugin'>(name: string, type?:T):App.LoadTypes[T] {
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
            if (resolvePath.includes(`@zhinjs/${type||'plugin'}-`)) return 'official'
            if(resolvePath.includes(`zhin-${type||'plugin'}-`)) return 'community'
            if(resolvePath.startsWith(path.resolve(__dirname,'plugins'))) return 'built'
            return 'custom'
        }
        const resolved = getModulesPath([
            this.options[`${type||'plugin'}_dir`] ? path.resolve(this.options[`${type||'plugin'}_dir`], name) : null,// 用户自定义插件/服务/游戏目录
            path.join(__dirname, `${type||'plugin'}s`, name), // 内置插件/服务/游戏目录
            `@zhinjs/${type||'plugin'}-${name}`,// 官方插件/服务/游戏模块
            `zhin-${type||'plugin'}-${name}`,// 社区插件/服务/游戏模块
        ].filter(Boolean))
        if (!resolved) throw new Error(`未找到${type||'plugin'}(${name})`)
        const result = wrapExport(resolved)
        const dirs = resolved.split('/')

        const plugin = {
            anonymousCount: 0,
            install: result.install || result,
            author: JSON.stringify(result.author),
            version: result.version,
            desc: result.desc,
            using: result.using ||= [],
            type: getType(resolved),
            name: result.name || name,
            fullName: result.fullName || dirs[dirs.length - 1].replace(/\.(d\.)?[t|j]s$/, ''),
            fullPath: getListenDir(resolved)
        }
        return type==='adapter'?result:plugin
    }

    findCommand(argv: Argv) {
        return this.commandList.find(cmd => {
            return cmd.name === argv.name
                || cmd.aliasNames.includes(argv.name)
                || cmd.shortcuts.some(({name}) => typeof name === 'string' ? name === argv.name : name.test(argv.cqCode))
        })
    }

    async start() {
        for (const platform of Object.keys(this.options.adapters||{})) {
            try {
                this.adapter(platform as keyof Adapters, this.options.adapters[platform])
            } catch (e) {
                this.logger.warn(e.message)
            }
        }
        for (const pluginName of Object.keys(this.options.plugins)) {
            try {
                this.plugin(pluginName, this.options.plugins[pluginName])
            } catch (e) {
                this.logger.warn(e.message)
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

export interface App extends App.Services {
    plugin(name: string): Plugin

    plugin<T>(plugin: Plugin, options?: T): this

    on<T extends keyof App.AllEventMap<this>>(event: T, listener: App.AllEventMap<this>[T]): App.Dispose<this>;
    // @ts-ignore
    on<P extends keyof Adapters,E extends keyof App.BotEventMaps[P]>(event: `${P}.${E}`, listener: (session:ToSession<P,App.BotEventMaps[P],E>)=>any): App.Dispose<this>;

    on<S extends string | symbol>(event: S & Exclude<S, keyof App.AllEventMap<this>>, listener: (...args: any[]) => any): App.Dispose<this>;

    emitSync<T extends keyof App.AllEventMap<this>>(event: T, ...args: Parameters<App.AllEventMap<this>[T]>): Promise<void>;
    // @ts-ignore
    emitSync<P extends keyof Adapters,E extends keyof App.BotEventMaps[P]>(event: `${P}.${E}`, session:ToSession<P,App.BotEventMaps[P],E>): Promise<void>;
    emitSync<S extends string | symbol>(event: S & Exclude<S, keyof App.AllEventMap<this>>, ...args: any[]): Promise<void>;

    bail<T extends keyof App.AllEventMap<this>>(event: T, ...args: Parameters<App.AllEventMap<this>[T]>): any;

    // @ts-ignore
    emitSync<P extends keyof Adapters,E extends keyof App.BotEventMaps[P]>(event: `${P}.${E}`, session:ToSession<P,App.BotEventMaps[P],E>): any;
    bail<S extends string | symbol>(event: S & Exclude<S, keyof App.AllEventMap<this>>, ...args: any[]): any;

    bailSync<T extends keyof App.AllEventMap<this>>(event: T, ...args: Parameters<App.AllEventMap<this>[T]>): Promise<any>;

    // @ts-ignore
    emitSync<P extends keyof Adapters,E extends keyof App.BotEventMaps[P]>(event: `${P}.${E}`, session:ToSession<P,App.BotEventMaps[P],E>): Promise<any>;
    bailSync<S extends string | symbol>(event: S & Exclude<S, keyof App.AllEventMap<this>>, ...args: any[]): Promise<any>;
}

export namespace App {
    export type Dispose<T> = (() => void) & T

    export interface Services {
        koa: Koa
    }

    export const defaultConfig: Partial<Options> = {
        adapters:{
            oicq:{
                bots:[]
            }
        },
        data_dir:path.join(process.cwd(), 'data'),
        plugin_dir: path.join(process.cwd(), 'plugins'),
        plugins: {
            config:null,
            daemon: null,
            help: null,
            login:null,
            logs:null,
            plugin:null,
            status:null,
            watcher: process.cwd(),
        },
        log_level: 'info',
        services: {},
        delay: {},
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
                zhin: {
                    appenders: ['saveFile','consoleOut'],
                    level: 'info'
                },
                default: {
                    appenders: ['consoleOut'],
                    level: 'info'
                }
            }
        },
    }
    type BeforeEventMap<T> = {
    } & BeforeLifeCycle

    type AfterEventMap<T> = {
    } & AfterLifeCycle
    type BeforeLifeCycle = {
        [P in keyof LifeCycle as `before-${P}`]: LifeCycle[P]
    }
    type AfterLifeCycle = {
        [P in keyof LifeCycle as `after-${P}`]: LifeCycle[P]
    }
    export interface LoadTypes{
        plugin:Plugin
        adapter:Adapter
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
    export type BaseEventMap=Record<string, (...args:any[])=>any>
    export interface BotEventMaps{
        oicq:OicqEventMap
    }
    export interface AllEventMap<T> extends LifeCycle, BeforeEventMap<T>, AfterEventMap<T> {
    }
    export type AdapterConfig={
        [P in keyof Adapters]:AdapterOptionsType<Adapters[P]>
    }
    export type LogLevel="trace" | "debug" | "info" | "warn" | "error" | "fatal" | "mark" | "off"
    export interface Options {
        log_level:LogLevel
        uin: number
        password?: string
        master?: number
        admins?: number | number[]
        logConfig?: Partial<Configuration>
        delay: Record<string, number>
        plugins?: Record<string, any>
        services?: Record<string, any>
        adapters?: AdapterConfig
        adapter_dir?:string
        plugin_dir?: string
        data_dir?:string
    }
    export type ServiceConstructor<R, T = any> = new (bot: App, options?: T) => R
}