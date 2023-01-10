import {join, resolve, dirname} from 'path'
import {ref, watch} from 'obj-observer'
import {fork, ChildProcess} from "child_process";
import {Logger, getLogger, configure, Configuration} from "log4js";
import * as Yaml from 'js-yaml'
import * as path from 'path'
import * as fs from 'fs'
import {EventEmitter} from "events";
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
import {Plugin, PluginOptions, Plugins} from "@/plugin";
import Koa from "koa";
import {Adapter, AdapterConstructs, AdapterOptions, AdapterOptionsType, Adapters} from "@/adapter";
import {Bots, Sendable} from "@/bot";
import {OicqEventMap} from './adapters/oicq'
import {Session, ToSession} from "@/session";
import {Middleware} from "@/middleware";
import {Dispose} from "@/dispose";
import {Router} from "@/router";

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


export class App extends EventEmitter {
    isReady: boolean = false
    options: App.Options
    plugins: Map<string, Plugin> = new Map<string, Plugin>()
    adapters: Map<keyof Adapters, Adapter> = new Map<keyof Adapters, Adapter>()
    private services: Record<string, any> = {}
    disposes: Dispose[] = []
    middlewares: Middleware<Session>[] = []
    commands: Map<string, Command> = new Map<string, Command>()
    public logger: Logger

    constructor(options: App.Options) {
        super();
        if (options.logConfig) {
            configure(options.logConfig as Configuration)
        }
        this.logger = getLogger('[zhin]')
        this.logger.level = options.log_level || 'info'
        const _this = this
        const koa=new Koa()
        const server=createServer(koa.callback())
        const router=new Router(server,{prefix:''})
        this.service('server',server)
            .service('koa', koa)
            .service('router',router)
        koa.use(KoaBodyParser())
            .use(router.routes())
            .use(router.allowedMethods())
        server.listen(options.port||=8086)
        this.logger.info(`server listen at ${getIpAddress().map(ip=>`http://${ip}:${options.port}`).join(' and ')}`)
        this.options = ref(options)
        this.on('dispose', () => {
            server.close()
            while (this.disposes.length) {
                const dispose = this.disposes.shift()
                dispose()
            }
        })
        this.middleware((session) => session.execute())
        return new Proxy(this, {
            get(target: typeof _this, p: string | symbol, receiver: any): any {
                let result = Reflect.get(target, p, receiver)
                if (result !== undefined) return result
                result = Reflect.get(target.services, p, receiver)
                return result
            }
        })
    }

    on(event, listener) {
        super.on(event, listener)
        return Dispose.from(this, () => {
            super.off(event, listener)
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
                    } else {
                        // 有则更新
                        source[key][k] = value[k]
                    }
                })
                Object.keys(value).forEach(k => {
                    if (source[key][k] === undefined) {
                        // 无则添加
                        source[key][k] = value[k]
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

    adapter<K extends keyof Adapters>(platform: K): Adapters[K]
    adapter<K extends keyof Adapters>(platform: K, options: AdapterOptionsType<Adapters[K]>): this
    adapter<K extends keyof Adapters>(platform: K, adapter: AdapterConstructs[K], options: AdapterOptionsType<Adapters[K]>): this
    adapter<K extends keyof Adapters>(platform: K, Construct?: AdapterConstructs[K] | AdapterOptions, options?: AdapterOptions) {
        if (!Construct && !options) return this.adapters.get(platform)
        if (typeof Construct !== "function") {
            const result=this.load<Plugin>(platform, 'adapter')
            if(result && result.install){
                result.install(this,options)
            }
            options = Construct as AdapterOptions
            Construct = Adapter.get(platform).Adapter as unknown as AdapterConstructs[K]
        }
        if (!Construct) throw new Error(`can't find adapter fom platform:${platform}`)
        const dispose = this.on(`${platform}.message`, (session) => {
            const middleware = Middleware.compose(this.middlewares)
            middleware(session)
        })
        this.adapters.set(platform, new Construct(this, platform, options))
        return Dispose.from(this, () => {
            dispose()
            this.adapters.delete(platform)
        }) as any
    }

    pickBot<K extends keyof Bots>(platform: K, self_id: string | number): Bots[K] {
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

    middleware(middleware: Middleware<Session>, prepend?: boolean) {
        const method: 'push' | 'unshift' = prepend ? 'unshift' : "push"
        this.middlewares[method](middleware)
        return Dispose.from(this, () => {
            return remove(this.middlewares, middleware);
        })
    }

    getLogger<K extends keyof Adapters>(platform: K, self_id?: string | number) {
        return getLogger(`[zhin:adapter-${[platform, self_id].filter(Boolean).join(':')}]`)
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
        return Dispose.from(this, () => {
            delete this.services[key]
        })
    }


    static getChannelId(event: Dict) {
        return [event.message_type, event.group_id || event.discuss_id || event.sender.user_id].join(':') as ChannelId
    }

    get commandList() {
        return [...this.commands.values()].flat()
    }

    get pluginList() {
        return [...this.plugins.values()]
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
        return !![...this.plugins.values()].find(plugin => plugin.fullName === pluginName)
    }

    plugin<T>(name: string, options?: T): Plugin | this
    plugin<P extends Plugin>(plugin: P, options?: PluginOptions<P>): this
    plugin<P extends Plugin>(entry: string | P, options?: PluginOptions<P>) {
        let plugin: Plugin
        if (typeof entry === 'string') {
            const result = this.plugins.get(entry)
            if (result) return result
            try {
                plugin = this.load<P>(entry, 'plugin')
            } catch (e) {
                this.logger.warn(e.message)
                return this
            }
        } else {
            plugin = entry
        }
        plugin.anonymousCount = 0
        plugin.children = []
        const dispose = Dispose.from(this, () => {
            this.dispose(plugin)
        })
        const proxy = new Proxy(dispose, {
            get(target: typeof dispose, p: PropertyKey, receiver: any): any {
                const proxyEvents = ['on', 'plugin', 'command']
                const result = Reflect.get(target, p, receiver)
                if (typeof result !== 'function' || typeof p !== 'string' || !proxyEvents.includes(p)) return result
                return new Proxy(result, {
                    apply(target: Function, thisArg: any, argArray?: any): any {
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
                                    name: `${plugin.name}:${entry.replace('./', '').split('/').join(':')}`,
                                    install: dispose.load<Plugin>(resolve(dirname(plugin.fullPath), entry), 'plugin').install
                                }
                            }
                            return result.apply(thisArg, [entry, config])
                        }
                        let res = result.apply(thisArg, argArray)
                        if (res instanceof Command) {
                            plugin.disposes.push(() => {
                                dispose.commands.delete(res.name)
                                dispose.emit('command-remove', res)
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
                while (plugin.disposes.length) {
                    const dispose = plugin.disposes.shift()
                    dispose()
                }
                plugin.disposes = []
                return true
            }
            const installFunction = plugin.install ? plugin.install : plugin as Plugin.Function<any>
            if (this.plugins.get(plugin.name)) {
                this.logger.warn('重复载入:' + plugin.name)
                return
            }
            if (plugin.setup) {
                plugin.app = proxy
                this.plugins.set(plugin.name, plugin)
                const result = installFunction.apply(plugin, [proxy, options])
                if (typeof result === 'function') {
                    plugin.disposes.push(result)
                }
            } else {
                const result = installFunction.apply(plugin, [proxy, options])
                if (typeof result === 'function') {
                    plugin.disposes.push(result)
                }
                this.plugins.set(plugin.name, plugin)
            }
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

    command<D extends string>(def: D): Command<Argv.ArgumentType<D>> {
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
        const command = new Command(name + decl)
        command.app = this
        if (parent) {
            command.parent = parent
            parent.children.push(command)
        }
        this.commands.set(name, command)
        this.emit('command-add', command)
        return command as any
    }

    sendMsg(channelId: ChannelId, message: Sendable) {
        const [platform, self_id, targetType, targetId] = channelId.split(':') as [keyof Adapters, `${string | number}`, TargetType, `${string | number}`]
        const adapter = this.adapters.get(platform)
        const bot = adapter.bots.get(self_id)
        return bot.sendMsg(targetId, targetType, message)
    }

    setTimeout(callback: Function, ms: number, ...args) {
        const timer = setTimeout(() => {
            callback()
            dispose()
            remove(this.disposes, dispose)
        }, ms, ...args)
        const dispose = Dispose.from(this, () => clearTimeout(timer))
        this.disposes.push(dispose)
        return
    }

    setInterval(callback: Function, ms: number, ...args) {
        const timer = setInterval(callback, ms, ...args)
        const dispose = Dispose.from(this, () => clearInterval(timer))
        this.disposes.push(dispose)
        return dispose
    }

    use<P extends Plugin>(plugin: P, options?: PluginOptions<P>): this {
        this.plugin(plugin, options)
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

    public load<R = object>(name: string, type: string): R {
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
            if (packageInfo.setup) {
                result.install = () => {
                    wrapExport(resolved)
                }
            } else {
                Object.assign(result, wrapExport(resolved))
            }
        } else {
            Object.assign(result, wrapExport(resolved))
        }
        const dirs = resolved.split('/')
        return {
            ...result,
            author: JSON.stringify(result.author),
            desc: result.desc,
            using: result.using ||= [],
            type: getType(resolved),
            name: result.name || name,
            fullName: result.fullName || dirs[dirs.length - 1].replace(/\.(d\.)?[t|j]s$/, ''),
            fullPath: getListenDir(resolved)
        } as any
    }

    findCommand(argv: Argv) {
        return this.commandList.find(cmd => {
            return cmd.name === argv.name
                || cmd.aliasNames.includes(argv.name)
                || cmd.shortcuts.some(({name}) => typeof name === 'string' ? name === argv.name : name.test(argv.name))
        })
    }

    async start() {
        for (const platform of Object.keys(this.options.adapters || {})) {
            try {
                this.adapter(platform as keyof Adapters, this.options.adapters[platform])
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

export interface App extends App.Services {
    plugin(name: string): Plugin

    plugin<T>(plugin: Plugin, options?: T): this

    on<T extends keyof App.AllEventMap<this>>(event: T, listener: App.AllEventMap<this>[T]);

    // @ts-ignore
    on<P extends keyof Adapters, E extends keyof App.BotEventMaps[P]>(event: `${P}.${E}`, listener: (session: ToSession<P, App.BotEventMaps[P], E>) => any);

    on<S extends string | symbol>(event: S & Exclude<S, keyof App.AllEventMap<this>>, listener: (...args: any[]) => any);

    emitSync<T extends keyof App.AllEventMap<this>>(event: T, ...args: Parameters<App.AllEventMap<this>[T]>): Promise<void>;

    // @ts-ignore
    emitSync<P extends keyof Adapters, E extends keyof App.BotEventMaps[P]>(event: `${P}.${E}`, session: ToSession<P, App.BotEventMaps[P], E>): Promise<void>;

    emitSync<S extends string | symbol>(event: S & Exclude<S, keyof App.AllEventMap<this>>, ...args: any[]): Promise<void>;

    bail<T extends keyof App.AllEventMap<this>>(event: T, ...args: Parameters<App.AllEventMap<this>[T]>): any;

    // @ts-ignore
    emitSync<P extends keyof Adapters, E extends keyof App.BotEventMaps[P]>(event: `${P}.${E}`, session: ToSession<P, App.BotEventMaps[P], E>): any;

    bail<S extends string | symbol>(event: S & Exclude<S, keyof App.AllEventMap<this>>, ...args: any[]): any;

    bailSync<T extends keyof App.AllEventMap<this>>(event: T, ...args: Parameters<App.AllEventMap<this>[T]>): Promise<any>;

    // @ts-ignore
    emitSync<P extends keyof Adapters, E extends keyof App.BotEventMaps[P]>(event: `${P}.${E}`, session: ToSession<P, App.BotEventMaps[P], E>): Promise<any>;

    bailSync<S extends string | symbol>(event: S & Exclude<S, keyof App.AllEventMap<this>>, ...args: any[]): Promise<any>;
}

export namespace App {
    export const key = Symbol('Zhin')

    export interface Services {
        koa:Koa
        router:Router
        server:Server
    }

    export const defaultConfig: Partial<Options> = {
        port:8086,
        adapters: {
            oicq: {
                bots: []
            },
            onebot:{
                bots:[]
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
                zhin: {
                    appenders: ['saveFile', 'consoleOut'],
                    level: 'info'
                },
                default: {
                    appenders: ['consoleOut'],
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

    export interface LoadTypes {
        plugin: Plugin
        adapter: Adapter
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

    export interface BotEventMaps {
        oicq: OicqEventMap
    }

    export interface AllEventMap<T> extends LifeCycle, BeforeEventMap<T>, AfterEventMap<T> {
    }

    export type AdapterConfig = {
        [P in keyof Adapters]?: AdapterOptionsType<Adapters[P]>
    }
    export type PluginConfig = {
        [P in keyof Plugins]?: PluginOptions<Plugins[P]>
    }
    export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal" | "mark" | "off"
    type KVMap<V =any,K extends string=string>=Record<K, V>
    export interface Options extends KVMap{
        port:number
        log_level: LogLevel
        logConfig?: Partial<Configuration>
        delay: Record<string, number>
        plugins?: PluginConfig
        services?: Record<string, any>
        adapters?: Partial<AdapterConfig>
        adapter_dir?: string
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
                adapters: {
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
    const useApp = () => {
        const app = contextMap.get(App.key)
        if (!app) throw new Error(`can't found app with context for key:${App.key.toString()}`)
        const callSite = getCaller()
        const pluginFullPath = callSite.getFileName()
        const plugin = app.pluginList.find(plugin => plugin.fullPath === pluginFullPath)
        if (plugin && plugin.app) return plugin.app
        return app
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
                plugin.disposes.push(dispose)
            }
        } else {
            const unWatch = watch(effect, callback)
            plugin.disposes.push(unWatch)
        }

    }

    return {
        createApp,
        useApp,
        useEffect,
        useOptions
    }
}

const {createApp, useApp, useEffect, useOptions} = createAppAPI()
export {
    createApp,
    useApp,
    useEffect,
    useOptions
}
