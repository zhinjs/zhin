import path_1, {join, resolve} from 'path'
import {ref, watch} from 'obj-observer'
import {fork, ChildProcess} from "child_process";
import {getLogger, configure, Configuration} from "log4js";
import * as Yaml from 'js-yaml'
import * as path from 'path'
import * as fs from 'fs'
import {
    deepClone,
    deepMerge,
    wrapExport,
    getPackageInfo,
    deepEqual,
    getCaller,
    getIpAddress,
    Dict, pick
} from "@zhinjs/shared";
import {createServer, Server} from "http";
import KoaBodyParser from "koa-bodyparser";
import {Proxied} from 'obj-observer/lib/deepProxy'
import {Command} from "./command";
import {Argv} from "./argv";
import {Plugin} from './plugin'
import {Context} from "./context";
import Koa from "koa";
import {Adapter, AdapterOptionsType} from "./adapter";
import {IcqqAdapter, IcqqBot, IcqqEventMap} from './adapters/icqq'
import {NSession} from "./session";
import {Middleware} from "./middleware";
import {Dispose} from "./dispose";
import {Router} from "./router";
import {Component} from "./component";
import {Element} from "./element";

interface Message {
    type: 'start' | 'queue'
    body: any
}

export type TargetType = 'group' | 'private' | 'discuss'
export type ChannelId = `${keyof Zhin.Adapters}:${string | number}:${TargetType}:${number | string}`|`${TargetType}:${number | string}`
let cp: ChildProcess

export function isConstructor<R, T>(value: any): value is (new (...args: any[]) => any) {
    return typeof value === 'function' && value.prototype && value.prototype.constructor === value
}

let buffer = null, timeStart: number

export function createWorker(options:Zhin.WorkerOptions) {
    const {entry='lib',mode='production',config:configPath='zhin.yaml'}=options||{}
    if (!fs.existsSync(join(process.cwd(),configPath))) fs.writeFileSync(join(process.cwd(), configPath), Yaml.dump(options))
    cp = fork(join(__dirname, '../worker.js'), [], {
        env: {
            mode,
            entry,
            configPath
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

export function defineConfig(options: Zhin.Options) {
    return options
}
export interface Zhin{
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
    public app: Zhin = this
    constructor(options: Zhin.Options) {
        super(null);
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
        watch(this.options,(value:Zhin.Options)=>{
            fs.writeFileSync(process.env.configPath,Yaml.dump(value))
        })
        this.on('dispose',()=>{
            server.close()
        })
        this.on('message',(session)=>{
            const middleware = Middleware.compose(this.getSupportMiddlewares(session))
            middleware(session)
        })
        this.on('service-add',(addName)=>{
            const plugins=this.pluginList.filter(p=>p.options.using && p.options.using.includes(addName))
            plugins.forEach(plugin=>{
                if(plugin.options.using.every(name=>this.services.has(name))){
                    this.logger.info(`所需服务已全部就绪，插件(${plugin.name})已启用`)
                    plugin.enable()
                }
            })
        })
        this.on('service-remove',(removeName)=>{
            const plugins=this.pluginList.filter(p=>p.options.using && p.options.using.includes(removeName))
            plugins.forEach(plugin=>{
                if(plugin.options.using.some(name=>!this.services.has(name))){
                    this.logger.info(`所需服务(${removeName})未就绪，插件(${plugin.name})已停用`)
                    plugin.disable()
                }
            })
        })
        this.use(Component)
        this.middleware(async (session,next) => {
            session.elements=await session.render()
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
    // 扫描项目依赖中的所有插件
    getInstalledPlugins() {
        const result: Plugin.Options[] = []
        const loadManifest=(name) => {
            const filename = require.resolve(name + '/package.json')
            const meta = JSON.parse(fs.readFileSync(filename, 'utf8'))
            meta.dependencies ||= {}
            return meta
        }
        const parsePackage=(name)=>{
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
                name:data.name.replace(/(zhin-|^@zhinjs\/)plugin-/, ''),
                fullName:data.name,
            }
        }
        const loadPackage=(name)=>{
            try {
                result.push(this.load(parsePackage(name).fullName,'plugin'))
            } catch (error) {
                this.logger.warn('failed to parse %c', name)
                this.logger.warn(error)
            }
        }
        const loadDirectory=(baseDir)=>{
            const base = path_1.resolve(baseDir,'node_modules')
            const files = fs.existsSync(base)?fs.readdirSync(base):[]
            for (const name of files) {
                const base2 = base + '/' + name
                if (name==='@zhinjs') {
                    const files = fs.readdirSync(base2)
                    for (const name2 of files) {
                        if (name2.startsWith('plugin-')) {
                            loadPackage(name + '/' + name2)
                        }
                    }
                } else if(name.startsWith('zhin-plugin-')){
                    loadPackage(name)
                }
            }
            if(path_1.dirname(baseDir) !==baseDir){
                loadDirectory(path_1.dirname(baseDir))
            }
        }
        const startDir=path_1.dirname(__dirname)
        loadDirectory(startDir)
        if (fs.existsSync(resolve(process.cwd(), this.options.plugin_dir))) {
            result.push(
                ...fs.readdirSync(resolve(process.cwd(), this.options.plugin_dir))
                    .map((name) => this.load<Plugin.Options>(name.replace(/\.(d\.)?[d|j]s$/, ''), 'plugin'))
            )
        }
        if (fs.existsSync(resolve(__dirname, 'plugins'))) {
            result.push(...fs.readdirSync(resolve(__dirname, 'plugins'))
                .map((name) => this.load<Plugin.Options>(name.replace(/\.(d\.)?[d|j]s$/, ''), 'plugin')))
        }
        return result
    }
    // 检查知音是否安装指定插件
    hasInstall(pluginName: string) {
        return !!this.pluginList.find(plugin => plugin.options.fullName === pluginName)
    }
    sendMsg(channelId: ChannelId, message: Element.Fragment) {
        const [protocol, self_id, targetType, targetId] = channelId.split(':') as [keyof Zhin.Adapters, `${string | number}`, TargetType, `${string | number}`]
        const adapter = this.adapters.get(protocol)
        const bot = adapter.bots.get(self_id)
        return bot.sendMsg(targetId, targetType, message)
    }
    // 安装插件
    use<P extends Plugin.Install>(plugin: P): this {
        this.plugin(plugin)
        return this
    }
    // 加载指定名称，指定类型的模块
    public load<R = object>(name: string, type: string,setup?:boolean): R {
        function getListenDir(modulePath: string) {
            if (modulePath.endsWith(path.sep+'index')) return modulePath.replace(path.sep+'index', '')
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
            name
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
        fullName = fullName.split(path.sep)
            .filter(Boolean).join(':')
            .replace(/\.(d\.)?[t|j]s$/, '')
            .replace(/:index$/,'')
        const pluginType=getType(resolved)
        return {
            ...result,
            author: JSON.stringify(result.author),
            desc: result.desc,
            using: result.using ||= [],
            type: pluginType,
            fullName: result.fullName || fullName,
            name: result.name || fullName,
            fullPath: getListenDir(resolved)
        } as any
    }
    // 获取匹配出来的指令
    findCommand(argv: Argv) {
        const commands=this.getSupportCommands(argv.session)
        return commands.find(cmd => {
            return cmd.name === argv.name
                || cmd.aliasNames.includes(argv.name)
                || cmd.shortcuts.some(({name}) => typeof name === 'string' ? name === argv.name : name.test(argv.name))
        })
    }
    // 启动zhin
    async start(mode:'dev'|'devel'|'develop'|string) {
        for (const adapter of Object.keys(this.options.adapters || {})) {
            try {
                this.adapter(adapter as keyof Zhin.Adapters, this.options.adapters[adapter])
            } catch (e) {
                this.logger.warn(e.message, e.stack)
            }
        }
        this.getInstalledPlugins().forEach(plugin=>{
            try {
                this.plugin(plugin.fullName)
            } catch (e) {
                this.logger.warn(e.message, e.stack)
            }
        })
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
    // 停止 zhin
    stop() {
        this.dispose()
        process.exit()
    }
}


export namespace Zhin {
    export interface WorkerOptions{
        entry?:string
        config?:string
        mode?:string
    }
    export interface Adapters{
        icqq:IcqqAdapter
    }
    export interface Bots{
        icqq:IcqqBot
    }
    export type Bot=Bots[keyof Bots]
    export const key = Symbol('Zhin')
    export interface Services {
        koa: Koa
        router: Router
        server: Server
    }

    export const defaultConfig: Partial<Options> = {
        port: 8086,
        adapters: {
            icqq: {
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
    type BeforeEventMap = {} & BeforeLifeCycle<LifeCycle> & BeforeLifeCycle<ServiceLifeCycle>
    type Prefix<P extends string,T extends string|symbol|number>=T extends string|number?`${P}-${T}`:`${P}-${string}`
    type AfterEventMap = {} & AfterLifeCycle<LifeCycle>
    type BeforeLifeCycle<T extends Dict> = {
        [P in keyof T as Prefix<'before', P>]: T[P]
    }
    type AfterLifeCycle<T extends Dict> = {
        [P in keyof T as Prefix<'after', P>]: T[P]
    }
    type LifeType='created'|'mounted'|'disposed'
    export type ServiceLifeCycle={
        [P in keyof Services as `${P}-${LifeType}`]:()=>void
    }
    export interface LifeCycle{
        'start'(): void
        'ready'(): void
        'dispose'(): void
        'message'(session:NSession<keyof Adapters>):void
        'command-add'(command: Command): void
        'command-remove'(command: Command): void
        'plugin-add'(plugin: Plugin): void
        'plugin-remove'(plugin: Plugin): void
        'service-add'(serviceName:keyof Zhin.Services):void
        'service-remove'(serviceName:keyof Zhin.Services):void
    }

    export type BaseEventMap = Record<string, (...args: any[]) => any>

    export interface BotEventMaps extends Record<keyof Zhin.Adapters, BaseEventMap>{
        icqq: IcqqEventMap
    }
    type FlatBotEventMap<P=keyof BotEventMaps>=P extends keyof BotEventMaps?{
        [E in keyof BotEventMaps[P] as MapKey<P,E>]:(session:NSession<P, E>)=>void
    }:{}
    type MapKey<S extends string,K extends string|number|symbol>=K extends string|number?`${S}.${K}`:K
    type MapValue<M extends BaseEventMap,E extends keyof M>=M[E] extends (...args:any[])=>any?M[E]:(...args:any[])=>any
    export interface EventMap<T> extends LifeCycle,ServiceLifeCycle, BeforeEventMap, AfterEventMap,FlatBotEventMap {
    }
    export type AdapterConfig = {
        [P in keyof Zhin.Adapters]?: AdapterOptionsType<Adapters[P]>
    }
    export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal" | "mark" | "off"
    type KVMap<V = any, K extends string = string> = Record<K, V>

    export interface Options extends KVMap {
        port: number
        log_level: LogLevel
        logConfig?: Partial<Configuration>
        delay: Record<string, number>
        plugins?: Record<string, any>
        services?: Record<string, any>
        protocols?: Partial<AdapterConfig>
        protocol_dir?: string
        plugin_dir?: string
        data_dir?: string
    }

    export type Keys<O extends KVMap> = O extends KVMap<infer V, infer K> ? V extends object ? `${K}.${Keys<V>}` : `${K}` : never
    export type Value<O extends KVMap, K> = K extends `${infer L}.${infer R}` ? Value<O[L], R> : K extends keyof O ? O[K] : any

    export type ServiceConstructor<R, T = any> = new (bot: Zhin, options?: T) => R
    export function createContext<T extends object>(context:T):T{
        const whiteList = ['Math', 'Date','JSON']
        return new Proxy(context,{
            has(target, key) {
                // 由于代理对象作为`with`的参数成为当前作用域对象，因此若返回false则会继续往父作用域查找解析绑定
                if (typeof key==='string' && whiteList.includes(key)) {
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

function createZhinAPI() {
    const contextMap: Map<string | symbol, Zhin> = new Map<string | symbol, Zhin>()
    const createZhin = (options: Partial<Zhin.Options> | string) => {
        if (contextMap.get(Zhin.key)) return contextMap.get(Zhin.key)
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
        const app = new Zhin(deepMerge(deepClone(Zhin.defaultConfig), options))
        contextMap.set(Zhin.key, app)
        return app
    }
    const useContext = () => {
        const app = contextMap.get(Zhin.key)
        if (!app) throw new Error(`can't found app with context for key:${Zhin.key.toString()}`)
        const callSite = getCaller()
        const pluginFullPath = callSite.getFileName()
        const context=app.pluginList.find(plugin => plugin.options.fullPath === pluginFullPath)?.context
        if(context) return context
        const pluginDir=path.dirname(pluginFullPath)
        const reg=new RegExp(`${pluginDir}/index\.[tj]s`)
        const parent=app.pluginList.find(plugin=>{
            return plugin.options.fullPath.match(reg)
        })
        if(parent){
            parent.context.plugin(pluginFullPath,true)
            return app.pluginList.find(plugin => plugin.options.fullPath === pluginFullPath).context
        }
        app.plugin(pluginFullPath,true)
        return app.pluginList.find(plugin => plugin.options.fullPath === pluginFullPath).context
    }

    function getValue<T>(obj: T, path: string[]) {
        if (!obj || typeof obj !== 'object') return obj
        let result = obj
        while (path.length>1) {
            const key = path.shift()
            result = result[key] || {}
        }
        if(path.length) return result[path.shift()]
        return
    }

    function useOptions<K extends Zhin.Keys<Zhin.Options>>(path: K): Zhin.Value<Zhin.Options, K> {
        const app = contextMap.get(Zhin.key)
        if (!app) throw new Error(`can't found app with context for key:${Zhin.key.toString()}`)
        const callSite = getCaller()
        const pluginFullPath = callSite.getFileName()
        const plugin = app.pluginList.find(plugin => plugin.options.fullPath === pluginFullPath)
        const parent=plugin.context.parent
        const pathArr=path.split('.').filter(Boolean)
        const result=getValue(app.options, pathArr) as Zhin.Value<Zhin.Options, K>
        const backupData=deepClone(result)
        const unwatch=watch(app.options,(value)=>{
            const newVal=getValue(value, pathArr)
            if(!deepEqual(backupData,newVal)){
                plugin.unmount()
                const newPlugin=app.load<Plugin.Install>(plugin.options.fullPath,'plugin')
                parent.plugin(newPlugin)
                app.logger.info(`已重载插件:${newPlugin.name}`)
            }
        })
        plugin.context.disposes.push(unwatch)
        return getValue(app.options, path.split('.').filter(Boolean)) as Zhin.Value<Zhin.Options, K>
    }

    type EffectReturn = () => void
    type EffectCallBack<T = any> = (value?: T, oldValue?: T) => void | EffectReturn

    function useEffect<T extends object = object>(callback: EffectCallBack<T>, effect?: Proxied<T>) {
        const app = contextMap.get(Zhin.key)
        if (!app) throw new Error(`can't found app with context for key:${Zhin.key.toString()}`)
        const callSite = getCaller()
        const pluginFullPath = callSite.getFileName()
        const plugin = app.pluginList.find(plugin => plugin.options.fullPath === pluginFullPath)
        if (!effect) {
            const dispose = callback()
            if (dispose) {
                plugin.context.on('dispose',dispose)
            }
        } else {
            const unWatch = watch(effect, callback)
            plugin.context.on('dispose',unWatch)
        }

    }
    function onDispose(callback:Dispose){
        const app = contextMap.get(Zhin.key)
        if (!app) throw new Error(`can't found app with context for key:${Zhin.key.toString()}`)
        const callSite = getCaller()
        const pluginFullPath = callSite.getFileName()
        const plugin = app.pluginList.find(plugin => plugin.options.fullPath === pluginFullPath)
        plugin.context.on('dispose',callback)
    }
    return {
        createZhin,
        useContext,
        useEffect,
        onDispose,
        useOptions
    }
}

const {createZhin, useContext,onDispose, useEffect, useOptions} = createZhinAPI()
export {
    createZhin,
    useContext,
    useEffect,
    onDispose,
    useOptions
}
