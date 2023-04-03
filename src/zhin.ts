import {ref, watch} from 'obj-observer'
import {ChildProcess, fork} from "child_process";
import {Configuration, configure, getLogger} from "log4js";
import * as Yaml from 'js-yaml'
import * as path from 'path'
import * as fs from 'fs'
import {createZhinAPI} from "@/factory";
import {deepEqual, Dict, getIpAddress, getPackageInfo, pick, wrapExport,} from "@zhinjs/shared";
import {createServer, Server} from "http";
import KoaBodyParser from "koa-bodyparser";
import {Command} from "./command";
import {Argv} from "./argv";
import {Plugin} from './plugin'
import {Context} from "./context";
import Koa from "koa";
import {Adapter, AdapterOptionsType} from "./adapter";
import {IcqqAdapter, IcqqBot, IcqqEventMap} from './adapters/icqq'
import {NSession} from "./session";
import {Middleware} from "./middleware";
import {Router} from "./router";
import {Request} from "@/request";
import {Component} from "./component";
import {Element} from "./element";

export const version = require('../package.json').version

let cp: ChildProcess

interface Message {
    type: 'start' | 'queue'
    body: any
}

let buffer = null, timeStart: number

export type TargetType = 'group' | 'private' | 'discuss'
export type ChannelId =
    `${keyof Zhin.Adapters}:${string | number}:${TargetType}:${number | string}`
    | `${TargetType}:${number | string}`


export function isConstructor<R, T>(value: any): value is (new (...args: any[]) => any) {
    return typeof value === 'function' && value.prototype && value.prototype.constructor === value
}

process.on('SIGINT', () => {
    if (cp) {
        cp.emit('SIGINT')
    } else {
        process.exit()
    }
})

export function defineConfig(options: Zhin.Options) {
    return options
}

export interface Zhin {
    on<T extends keyof Zhin.EventMap<this>>(event: T, listener: Zhin.EventMap<this>[T]);

    on<S extends string | symbol>(event: S & Exclude<S, keyof Zhin.EventMap<this>>, listener: (...args: any[]) => any);

    emit<T extends keyof Zhin.EventMap<this>>(event: T, ...args: Parameters<Zhin.EventMap<this>[T]>): boolean;

    emit<S extends string | symbol>(event: S & Exclude<S, keyof Zhin.EventMap<this>>, ...args: any[]): boolean;

    emitSync<T extends keyof Zhin.EventMap<this>>(event: T, ...args: Parameters<Zhin.EventMap<this>[T]>): Promise<void>;

    emitSync<S extends string | symbol>(event: S & Exclude<S, keyof Zhin.EventMap<this>>, ...args: any[]): Promise<void>;

    bail<T extends keyof Zhin.EventMap<this>>(event: T, ...args: Parameters<Zhin.EventMap<this>[T]>): any;

    bail<S extends string | symbol>(event: S & Exclude<S, keyof Zhin.EventMap<this>>, ...args: any[]): any;

    bailSync<T extends keyof Zhin.EventMap<this>>(event: T, ...args: Parameters<Zhin.EventMap<this>[T]>): Promise<any>;

    bailSync<S extends string | symbol>(event: S & Exclude<S, keyof Zhin.EventMap<this>>, ...args: any[]): Promise<any>;
}

export class Zhin extends Context {
    isReady: boolean = false
    options: Zhin.Options
    adapters: Map<keyof Zhin.Adapters, Adapter> = new Map<keyof Zhin.Adapters, Adapter>()
    services: Map<keyof Zhin.Services, any> = new Map<keyof Zhin.Services, any>()

    constructor(options: Zhin.Options) {
        super(null);
        const result=this.zhin=new Proxy(this, {
            get(target: Zhin, p: string | symbol, receiver: any): any {
                if (target.services.has(p as keyof Zhin.Services)) return target.services.get(p as keyof Zhin.Services)
                return Reflect.get(target, p, receiver)
            }
        })
        if (options.logConfig) {
            configure(options.logConfig as Configuration)
        }
        this.logger = getLogger('[zhin]')
        this.logger.level = options.log_level || 'info'
        const koa = new Koa()
        const server = createServer(koa.callback())
        const router = new Router(server, {prefix: ''})
        this.service('server', server)
            .service('koa', koa)
            .service('router', router)
            .service('request', Request.create())
        koa.use(KoaBodyParser())
            .use(router.routes())
            .use(router.allowedMethods())
        server.listen(options.port ||= 8086)
        this.logger.info(`server listen at ${getIpAddress().map(ip => `http://${ip}:${options.port}`).join(' and ')}`)
        this.options = ref(options)
        watch(this.options, async (value: Zhin.Options) => {
            await fs.writeFileSync(process.env.configPath, Yaml.dump(value))
        })
        this.on('dispose', () => {
            server.close()
        })
        this.on('message', (session) => {
            const middleware = Middleware.compose(this.getSupportMiddlewares(session))
            middleware(session)
        })
        this.on('service-add', (addName) => {
            const plugins = this.pluginList.filter(p => p.options.using && p.options.using.includes(addName))
            plugins.forEach(plugin => {
                if (plugin.options.using.every(name => this.services.has(name))) {
                    this.logger.info(`所需服务已全部就绪，插件(${plugin.name})已启用`)
                    plugin.enable()
                }
            })
        })
        this.on('service-remove', (removeName) => {
            const plugins = this.pluginList.filter(p => p.options.using && p.options.using.includes(removeName))
            plugins.forEach(plugin => {
                if (plugin.options.using.some(name => !this.services.has(name))) {
                    this.logger.info(`所需服务(${removeName})未就绪，插件(${plugin.name})已停用`)
                    plugin.disable()
                }
            })
        })
        this.use(Component)
        this.middleware(async (session, next) => {
            let result = await session.execute()
            if (!result) return next()
            return session.reply(await session.render(result))
        })
        return result
    }

    // 更改zhin的配置
    changeOptions(options: Zhin.Options) {
        const changeValue = (source, key, value) => {
            if (source[key] && typeof source[key] === 'object') {
                Object.keys(source[key]).forEach(k => {
                    if (value[k] && typeof value[k] === 'object') {
                        changeValue(source[key], k, value[k])
                    } else if (value[k] === undefined) {
                        // 无则删除
                        delete source[key][k]
                        if (key === 'plugins') this.dispose(k)
                    } else if (!deepEqual(source[key][k], value[k])) {
                        // 有则更新
                        source[key][k] = value[k]
                        if (key === 'plugins') {
                            this.dispose(k)
                            this.plugin(k)
                        }
                    }
                })
                Object.keys(value).forEach(k => {
                    if (source[key][k] === undefined) {
                        // 无则添加
                        source[key][k] = value[k]
                        if (key === 'plugins') this.plugin(k)
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

    // 获取一个机器人实例
    pickBot<K extends keyof Zhin.Bots>(protocol: K, self_id: string | number): Zhin.Bots[K] {
        return this.adapters.get(protocol).bots.get(self_id) as Zhin.Bots[K]
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

    // 获取logger
    getLogger<K extends keyof Zhin.Adapters>(protocol: K, self_id?: string | number) {
        return getLogger(`[zhin:protocol-${[protocol, self_id].filter(Boolean).join(':')}]`)
    }

    static getChannelId(event: Dict) {
        return [event.message_type, event.group_id || event.discuss_id || event.sender.user_id].join(':') as ChannelId
    }

    async getMarketPackages(): Promise<Plugin.Package[]> {
        const {objects: modules} = (await this.services.get('request').get('https://registry.npmjs.org/-/v1/search?text=keywords:zhin%20zhin-plugin&size=250')) || {}
        return modules.map(packageModule => packageModule.package)
    }

    // 扫描项目依赖中的已安装的模块
    getInstalledModules<T extends Zhin.ModuleType>(moduleType: T): Zhin.Modules[T][] {
        const result: Zhin.Modules[T][] = []
        const loadManifest = (packageName) => {
            const filename = require.resolve(packageName + '/package.json')
            const meta = JSON.parse(fs.readFileSync(filename, 'utf8'))
            meta.dependencies ||= {}
            return meta
        }
        const parsePackage =(name) => {
            const data = loadManifest(name)
            const result = pick(data, [
                'name',
                'version',
                'setup',
                'author',
                'description',
            ])
            return {
                ...result,
                setup: !!result.setup,
                name: data.name.replace(/(zhin-|^@zhinjs\/)(plugin|service|adapter)-/, ''),
                fullName: data.name,
            }
        }
        const loadPackage = (name) => {
            try {
                result.push(this.load(parsePackage(name).fullName, moduleType))
            } catch (e) {
                let message=e.message||''
                message=message.split('\n')[0]
                if(/^Cannot find module '(\S+)'$/i.test(message)){
                    const needModeule=/^Cannot find module '(\S+)'$/i.exec(message)[1]
                    this.logger.warn(`获取模块${moduleType}(${name})详情失败:\n依赖 ${needModeule} 未安装，请使用 'npm install ${needModeule}' 后重试`);
                }else{
                    this.logger.warn(`获取模块${moduleType}(${name})详情失败:\n${message}`);
                }
            }
        }
        const loadDirectory = (baseDir) => {
            const base = path.resolve(baseDir, 'node_modules')
            const files = fs.existsSync(base) ? fs.readdirSync(base) : []
            for (const name of files) {
                const base2 = base + '/' + name
                if (name === '@zhinjs') {
                    const files = fs.readdirSync(base2)
                    for (const name2 of files) {
                        if (name2.startsWith(`${moduleType}-`)) {
                            loadPackage(name + '/' + name2)
                        }
                    }
                } else if (name.startsWith(`zhin-${moduleType}-`)) {
                    loadPackage(name)
                }
            }
            if (path.dirname(baseDir) !== baseDir) {
                loadDirectory(path.dirname(baseDir))
            }
        }
        const startDir = path.dirname(__dirname)
        loadDirectory(startDir)
        if (fs.existsSync(path.resolve(process.cwd(), this.options.plugin_dir))) {
            const dirs=fs.readdirSync(path.resolve(process.cwd(), this.options.plugin_dir))
            result.push(
                ...dirs.map((name) => this.load(name.replace(/\.(d\.)?[d|j]s$/, ''), moduleType))
            )
        }
        if (fs.existsSync(path.resolve(__dirname, `${moduleType}s`))) {
            const dirs=fs.readdirSync(path.resolve(__dirname, `${moduleType}s`))
            result.push(
                ...dirs.map((name) => this.load(name.replace(/\.(d\.)?[d|j]s$/, ''), moduleType, true)))
        }
        return result
    }

    // 检查知音是否安装指定插件
    hanMounted(pluginName: string) {
        return !!this.pluginList.find(plugin => plugin.options.fullName === pluginName)
    }

    sendMsg(channelId: ChannelId, message: Element.Fragment) {
        const [protocol, self_id, targetType, targetId] = channelId.split(':') as [keyof Zhin.Adapters, `${string | number}`, TargetType, `${string | number}`]
        const adapter = this.adapters.get(protocol)
        const bot = adapter.bots.get(self_id)
        return bot.sendMsg(targetId, targetType, message)
    }

    // 加载指定名称，指定类型的模块
    public load<T extends Zhin.ModuleType>(name: string, moduleType: T, setup?: boolean): Zhin.Modules[T] {
        function getListenDir(modulePath: string) {
            if (modulePath.endsWith(path.sep + 'index')) return modulePath.replace(path.sep + 'index', '')
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
            if (resolvePath.includes(`@zhinjs/${moduleType}-`)) return Plugin.PluginSource.official
            if (resolvePath.includes(`zhin-${moduleType}-`)) return Plugin.PluginSource.community
            if (resolvePath.startsWith(path.resolve(__dirname, 'plugins'))) return Plugin.PluginSource.built
            return Plugin.PluginSource.local
        }
        const resolved = getModulesPath([
            this.options[`${moduleType}_dir`] ? path.resolve(this.options[`${moduleType}_dir`], name) : null,// 用户自定义插件/服务/游戏目录
            path.join(__dirname, `${moduleType}s`, name), // 内置插件/服务/游戏目录
            `@zhinjs/${moduleType}-${name}`,// 官方插件/服务/游戏模块
            `zhin-${moduleType}-${name}`,// 社区插件/服务/游戏模块
            name
        ].filter(Boolean))
        if (!resolved) throw new Error(`未找到${moduleType}(${name})`)
        const packageInfo = getPackageInfo(resolved)
        if(packageInfo?.name){
            packageInfo.name=packageInfo.name.replace(/(zhin-|^@zhinjs\/)(plugin|service|adapter)-/, '')
        }
        let result: Record<string, any> = {setup}
        if (packageInfo?.setup || setup) {
            result.install = () => {
                wrapExport(resolved)
            }
        } else {
            Object.assign(result, wrapExport(resolved))
        }
        if (packageInfo) {
            Object.assign(result, packageInfo)
        }
        let fullName = resolved.replace(path.join(__dirname, `${moduleType}s`), '')
        if (this.options[`${moduleType}_dir`]) {
            fullName = fullName.replace(path.resolve(this.options[`${moduleType}_dir`]), '')
        }
        fullName = fullName
            .replace(path.sep, '')
            .replace(new RegExp(`${path.sep}index`), '')
            .replace(/\.(d\.)?[t|j]s$/, '')
        const pluginType = getType(resolved)
        return {
            ...result,
            author: JSON.stringify(result.author),
            desc: result.desc,
            using: result.using ||= [],
            type: pluginType,
            fullName: ["official", "community"].includes(pluginType) ? result.fullName || fullName : fullName,
            name: result.name || fullName,
            fullPath: getListenDir(resolved)
        } as any
    }

    // 获取匹配出来的指令
    findCommand(argv: Argv) {
        const commands = this.getSupportCommands(argv.session)
        return commands.find(cmd => {
            return cmd.name === argv.name
                || cmd.aliasNames.includes(argv.name)
                || cmd.shortcuts.some(({name}) => typeof name === 'string' ? name === argv.name : name.test((argv.elements ||= []).join('')))
        })
    }

    // 启动zhin
    async start(mode: 'dev' | 'devel' | 'develop' | string) {
        for (const adapter of Object.keys(this.options.adapters || {})) {
            try {
                this.adapter(adapter as keyof Zhin.Adapters, this.options.adapters[adapter])
            } catch (e) {
                this.logger.warn(e.message, e.stack)
            }
        }
        const installedPlugins = this.getInstalledModules('plugin')
        installedPlugins.forEach(plugin => {
            try {
                this.plugin(plugin.name, plugin.setup)
            } catch (e) {
                this.zhin.logger.warn(`自动载入插件(${plugin.name})失败：${e.message}`)
                this.plugins.delete(plugin.fullName)
            }
        })
        this.emitSync('ready')
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

    // 停止 zhin
    stop() {
        this.dispose()
        process.exit()
    }
}

export namespace Zhin {
    export interface WorkerOptions {
        entry?: string
        config?: string
        mode?: string
    }

    export interface Adapters {
        icqq: IcqqAdapter
    }

    export interface Bots {
        icqq: IcqqBot
    }

    export type Bot = Bots[keyof Bots]
    export const key = Symbol('Zhin')

    export interface Services {
        koa: Koa
        router: Router
        server: Server
        request: Request
    }

    export const defaultConfig: Partial<Options> = {
        port: 8086,
        adapters: {
            icqq: {
                bots: []
            }
        },
        self_url: 'localhost',
        data_dir: 'data',
        plugin_dir: 'plugins',
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
                    appenders: ['consoleOut', 'saveFile'],
                    level: 'info'
                }
            }
        },
    }
    type BeforeEventMap = {} & BeforeLifeCycle<LifeCycle> & BeforeLifeCycle<ServiceLifeCycle>
    type Prefix<P extends string, T extends string | symbol | number> = T extends string | number ? `${P}-${T}` : `${P}-${string}`
    type AfterEventMap = {} & AfterLifeCycle<LifeCycle>
    type BeforeLifeCycle<T extends Dict> = {
        [P in keyof T as Prefix<'before', P>]: T[P]
    }
    type AfterLifeCycle<T extends Dict> = {
        [P in keyof T as Prefix<'after', P>]: T[P]
    }
    type LifeType = 'created' | 'mounted' | 'ready' | 'disposed'
    export type ServiceLifeCycle = {
        [P in keyof Services as `${P}-${LifeType}`]: () => void
    }

    export interface LifeCycle {
        'start'(): void

        'ready'(): void

        'dispose'(): void

        'message'(session: NSession<keyof Adapters>): void

        'command-add'(command: Command): void

        'command-remove'(command: Command): void

        'plugin-add'(plugin: Plugin): void

        'plugin-remove'(plugin: Plugin): void

        'service-add'(serviceName: keyof Zhin.Services): void

        'service-remove'(serviceName: keyof Zhin.Services): void
    }

    export type BaseEventMap = Record<string, (...args: any[]) => any>

    export interface BotEventMaps extends Record<keyof Zhin.Adapters, BaseEventMap> {
        icqq: IcqqEventMap
    }

    type FlatBotEventMap<P = keyof BotEventMaps> = P extends keyof BotEventMaps ? {
        [E in keyof BotEventMaps[P] as MapKey<P, E>]: (session: NSession<P, E>) => void
    } : {}
    type MapKey<S extends string, K extends string | number | symbol> = K extends string | number ? `${S}.${K}` : K
    type MapValue<M extends BaseEventMap, E extends keyof M> = M[E] extends (...args: any[]) => any ? M[E] : (...args: any[]) => any

    export interface EventMap<T> extends LifeCycle, ServiceLifeCycle, BeforeEventMap, AfterEventMap, FlatBotEventMap {
    }

    export type AdapterConfig = {
        [P in keyof Zhin.Adapters]?: AdapterOptionsType<Adapters[P]>
    }
    export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal" | "mark" | "off"

    export interface Modules {
        plugin: Plugin.Options
        service: Services[keyof Services] | ServiceConstructor<Services[keyof Services]>
        adapter: Adapter.Install
    }

    export type ModuleType = keyof Modules
    type KVMap<V = any, K extends string = string> = Record<K, V>

    export interface Options extends KVMap {
        self_url: string
        port: number
        log_level: LogLevel
        logConfig?: Partial<Configuration>
        delay: Record<string, number>
        plugins?: Record<string, any>
        services?: Record<string, any>
        adapters?: Partial<AdapterConfig>
        plugin_dir?: string
        data_dir?: string
    }

    export type Keys<O extends KVMap> = O extends KVMap<infer V, infer K> ? V extends object ? `${K}.${Keys<V>}` : `${K}` : never
    export type Value<O extends KVMap, K> = K extends `${infer L}.${infer R}` ? Value<O[L], R> : K extends keyof O ? O[K] : any

    export type ServiceConstructor<R, T = any> = new (ctx: Context, options?: T) => R

    export function createContext<T extends object>(context: T): T {
        const whiteList = ['Math', 'Date', 'JSON']
        return new Proxy(context, {
            has(target, key) {
                // 由于代理对象作为`with`的参数成为当前作用域对象，因此若返回false则会继续往父作用域查找解析绑定
                if (typeof key === 'string' && whiteList.includes(key)) {
                    return target.hasOwnProperty(key)
                }

                // 返回true则不会往父作用域继续查找解析绑定，但实际上没有对应的绑定，则会返回undefined，而不是报错，因此需要手动抛出异常。
                if (!target.hasOwnProperty(key)) {
                    throw ReferenceError(`${key.toString()} is not defined`)
                }

                return true
            },
            get(target, key, receiver) {
                if (key === Symbol.unscopables) {
                    return undefined
                }
                return Reflect.get(target, key, receiver)
            }
        })
    }
}


export function createWorker(options: Zhin.WorkerOptions) {
    const {entry = 'lib', mode = 'production', config: configPath = 'zhin.yaml'} = options || {}
    if (!fs.existsSync(path.join(process.cwd(), configPath))) fs.writeFileSync(path.join(process.cwd(), configPath), Yaml.dump(options))
    cp = fork(path.join(__dirname, '../worker.js'), [], {
        env: {
            ...process.env,
            mode,
            entry,
            configPath,
        },
        execArgv: [
            '-r', 'esbuild-register',
            '-r', 'tsconfig-paths/register',
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

const {createZhin, useContext, onDispose, useEffect,useCommand,useComponent,listenOnce,listen,useMiddleware, useOptions} = createZhinAPI()
export {
    createZhin,
    useContext,
    listen,
    listenOnce,
    useEffect,
    useCommand,
    useMiddleware,
    useComponent,
    onDispose,
    useOptions
}