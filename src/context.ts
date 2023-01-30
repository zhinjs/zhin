import {Zhin, isConstructor, ChannelId} from "./zhin";
import {Dispose} from "./dispose";
import {Adapter, AdapterConstructs, AdapterOptions, AdapterOptionsType} from "./adapter";
import {Middleware} from "./middleware";
import {Command, TriggerSessionMap} from "./command";
import {PayloadWithSession} from "./session";
import {EventEmitter} from "events";
import {isBailed, remove} from "./utils";
import {Argv} from "./argv";
import * as path from "path";
import {Dict} from "./types";
import {Component} from "./component";
import {Logger} from "log4js";
import {Bot, Segment, Sendable} from "./bot";
import exp from "constants";
export interface Plugins{
    help:Plugin<null>
    logs:Plugin<null>
    login:Plugin<null>
    plugin:Plugin<null>
    config:Plugin<null>
    daemon:Plugin<null>
    status:Plugin<null>
    watcher:Plugin<string>
    [key:string]:Plugin
}
export function definePlugin<T=any>(options:Plugin.Install<T>):Plugin.Options<T>{
    const baseOption:Omit<Plugin.Options<T>, 'install'>={
        setup:false,
        anonymous:false,
        functional:false,
        anonymousCount:0,
    }
    return typeof options==="function"?{
        ...baseOption,
        functional:true,
        anonymous:options.prototype===undefined,
        install:options,
    }:{
        ...baseOption,
        functional:false,
        ...options,
    }
}

export class Context<T=any> extends EventEmitter{
    name:string
    fullName:string
    type:string
    protocol:(keyof Zhin.Adapters)[]
    using:string[]=[]
    functional:boolean=false
    fullPath:string
    plugins:Map<string,Plugin>=new Map<string, Plugin>()
    public components: Dict<Component> = Object.create(null)
    middlewares:Middleware<PayloadWithSession<keyof Zhin.Adapters,'message'>>[]=[]
    public readonly disposes:Dispose[]=[]
    app:Zhin
    commands:Map<string,Command>=new Map<string, Command>()
    constructor(public parent:Context,options:Plugin.Options<T>,public info:Plugin.Info={}) {
        super()
        if(!parent) return
        this.name=options.name
        this.protocol=options.protocol||=[]
        this.type=options.type||''
        this.using=options.using||[]
        this.fullName=options.fullName
        this.fullPath=options.fullPath
        this.functional=options.functional||false
        this.app=parent.app
        this.logger=parent.logger
        this.on('dispose',()=>{
            this.parent.plugins.delete(this.fullName)
            this.app.logger.info('已移除：',this.name)
            this.parent.emit('plugin-remove',this)
        })
        return new Proxy(this,{
            get(target: Context<T>, p: string | symbol, receiver: any): any {
                if(Zhin.Services.includes(p as keyof Zhin.Services)) return target.app.services.get(p as keyof Zhin.Services)
                return Reflect.get(target,p,receiver)
            }
        })
    }
    public logger: Logger
    scope<K extends keyof Zhin.Adapters>(scope:K|K[]):Context{
        if(!Array.isArray(scope)) scope=[scope]
        this.protocol=Array.from(new Set<keyof Zhin.Adapters>([...this.protocol,...scope]))
        return this
    }
    component(name: string, component: Component, options: Component.Options = {}) {
        this.components[name] = async (attrs, children, session) => {
            if (options.session && session.type === 'send') {
                throw new Error('interactive components is not available outside sessions')
            }
            if (!options.passive) {
                children = await session.transform(children)
            }
            return component(attrs, children, session)
        }
        return Dispose.from(this,()=>{
            delete this.components[name]
        })
    }
    get middlewareList(){
        return [...this.plugins.values()].reduce((result,plugin)=>{
            result.push(...plugin.middlewareList)
            return result
        },[...this.middlewares])
    }
    get componentList(){
        return [...this.plugins.values()].reduce((result,plugin)=>{
            Object.assign(result,plugin.componentList)
            return result
        },this.components)
    }
    get commandList():Command[] {
        return [...this.plugins.values()].reduce((result,plugin)=>{
            result.push(...plugin.commandList)
            return result
        },[...this.commands.values()])
    }

    get pluginList():Plugin[] {
        return [...this.plugins.values()].reduce((result,plugin)=>{
            result.push(...plugin.pluginList)
            return result
        },[...this.plugins.values()])
    }

    on(event, listener) {
        super.on(event, listener)
        const dispose= Dispose.from(this, () => {
            super.off(event, listener)
            remove(this.disposes,dispose)
        })
        this.disposes.push(dispose)
        return dispose
    }

    adapter<K extends keyof Zhin.Adapters>(adapter: K): Zhin.Adapters[K]
    adapter<K extends keyof Zhin.Adapters>(adapter: K, options: AdapterOptionsType<Zhin.Adapters[K]>): this
    adapter<K extends keyof Zhin.Adapters>(adapter: K, protocol: AdapterConstructs[K], options: AdapterOptionsType<Zhin.Adapters[K]>): this
    adapter<K extends keyof Zhin.Adapters>(adapter: K, Construct?: AdapterConstructs[K] | AdapterOptions, options?: AdapterOptions) {
        if (!Construct && !options) return this.app.adapters.get(adapter)
        if (typeof Construct !== "function") {
            const result=this.app.load<Plugin.Options>(adapter, 'adapter')
            if(result && result.install){
                result.install(this,options)
            }
            options = Construct as AdapterOptions
            Construct = Adapter.get(adapter).Adapter as unknown as AdapterConstructs[K]
        }
        if (!Construct) throw new Error(`can't find protocol from protocol:${adapter}`)
        const dispose = this.on(`${adapter}.message`, (session) => {
            const middleware = Middleware.compose(this.app.getSupportMiddlewares(session))
            middleware(session)
        })
        this.app.adapters.set(adapter, new Construct(this.app, adapter, options))
        return Dispose.from(this, () => {
            dispose()
            this.app.adapters.delete(adapter)
        }) as any
    }
    service<K extends keyof Zhin.Services>(key: K): Zhin.Services[K]
    service<K extends keyof Zhin.Services>(key: K, service: Zhin.Services[K]): this
    service<K extends keyof Zhin.Services, T>(key: K, constructor: Zhin.ServiceConstructor<Zhin.Services[K], T>, options?: T): this
    service<K extends keyof Zhin.Services, T>(key: K, Service?: Zhin.Services[K] | Zhin.ServiceConstructor<Zhin.Services[K], T>, options?: T): Zhin.Services[K] | this {
        if (Service === undefined) {
            return this.app.services.get(key)
        }
        if (this.app[key]) throw new Error('服务key不能和bot已有属性重复')
        if (isConstructor(Service)) {
            this.app.services.set(key,new Service(this.app, options))
        } else {
            this.app.services.set(key,Service)
        }
        Zhin.Services.push(key)
        return Dispose.from(this, () => {
            this.app.services.delete(key)
            remove(Zhin.Services,key)
        })
    }
    plugin<T>(name: string, options?: T): Context | this
    plugin<T>(name: string,setup?:boolean, options?: T): Context | this
    plugin<P extends Plugin.Install>(plugin: P, config?: Plugin.Config<P>): this
    plugin<P extends Plugin.Install>(entry: string | P, ...args:[boolean?,Plugin.Config<P>?]) {
        let options: Plugin.Options
        const setup:boolean=typeof args[0]==='boolean'?args.shift():false
        const config:Plugin.Config<P>=args.shift() as any
        if (typeof entry === 'string') {
            const result = this.plugins.get(entry)
            if (result) return result
            try {
                options = this.app.load<Plugin.Options>(entry, 'plugin',setup)
            } catch (e) {
                if(this.fullPath){
                    try{
                        const dir=path.dirname(this.fullPath)
                        options=this.app.load<Plugin.Options>(path.resolve(dir,entry),'plugin')
                    }catch {
                        this.app.logger.warn(e.message)
                        return this
                    }
                }else{
                    this.app.logger.warn(e.message)
                    return this
                }
            }
        } else {
            options = definePlugin(entry)
        }
        const installPlugin = () => {
            const context=new Context(this,options)
            const installFunction = typeof options==="function"?options:options.install
            if (this.plugins.get(options.fullName)) {
                this.app.logger.warn('重复载入:' + options.name)
                return
            }
            if (options.setup) {
                this.plugins.set(options.fullName, context)
                const result = installFunction.apply(this, [context, config])
                if (typeof result === 'function') {
                    context.disposes.push(result)
                }
            } else {
                const result = installFunction.apply(this, [context, config])
                if (typeof result === 'function') {
                    context.disposes.push(result)
                }
                this.plugins.set(options.fullName, context)
            }
            this.app.logger.info('已载入:' + options.name)
            this.app.emit('plugin-add', context)
        }
        const using = options.using ||= []
        if (!using.length) {
            installPlugin()
        } else {
            if (!using.every(name => this.app.pluginList.find(p=>p.name===name))) {
                this.app.logger.info(`插件(${options.name})将在所需插件(${using.join()})加载完毕后加载`)
                const dispose = this.app.on('plugin-add', () => {
                    if (using.every(name => this.app.pluginList.find(p=>p.name===name))) {
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
    command<D extends string,T extends keyof TriggerSessionMap>(def: D,trigger?:T): Command<Argv.ArgumentType<D>,{},T> {
        const namePath = def.split(' ', 1)[0]
        const decl = def.slice(namePath.length)
        const segments = namePath.split(/(?=[/])/g)

        let parent: Command, nameArr = []
        while (segments.length) {
            const segment = segments.shift()
            const code = segment.charCodeAt(0)
            const tempName = code === 47 ? segment.slice(1) : segment
            nameArr.push(tempName)
            if (segments.length) parent = this.app.commandList.find(cmd => cmd.name === tempName)
            if (!parent && segments.length) throw Error(`cannot find parent command:${nameArr.join('.')}`)
        }
        const name = nameArr.pop()
        const command = new Command(name + decl)
        command.trigger=trigger
        command.app = this.app
        if (parent) {
            command.parent = parent
            parent.children.push(command)
        }
        this.commands.set(name, command)
        this.emit('command-add', command)
        this.disposes.push(()=>{
            this.commands.delete(name)
            this.emit('command-remove', command)
        })
        return Object.create(command)
    }
    middleware(middleware: Middleware<PayloadWithSession<keyof Zhin.Adapters,'message'>>, prepend?: boolean) {
        const method: 'push' | 'unshift' = prepend ? 'unshift' : "push"
        this.middlewares[method](middleware)
        return Dispose.from(this, () => {
            return remove(this.middlewares, middleware);
        })
    }
    setTimeout(callback: Function, ms: number, ...args) {
        const timer = setTimeout(() => {
            callback()
            dispose()
            remove(this.disposes, dispose)
        }, ms, ...args)
        const dispose = Dispose.from(this, () => clearTimeout(timer))
        this.disposes.push(dispose)
        return dispose
    }

    setInterval(callback: Function, ms: number, ...args) {
        const timer = setInterval(callback, ms, ...args)
        const dispose = Dispose.from(this, () => clearInterval(timer))
        this.disposes.push(dispose)
        return dispose
    }
    broadcast(channelId:ChannelId,content:Sendable){
        const [platform,self_id,target_type=platform,target_id=self_id]=channelId.split(':')
        const bots=[...this.app.adapters.values()].reduce((result,adapter)=>{
           if(platform===target_type) result.push(...(adapter.bots as Bot[]))
           else if(platform===adapter.protocol) result.push(...(adapter.bots.filter(bot=>bot.self_id===self_id) as Bot[]))
            return result
        },[] as Bot[])
        return Promise.all(bots.map(bot=>bot.sendMsg(Number(target_id),target_type,content)))
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
    dispose(plugin?:Plugin|string){
        if(plugin){
            if(typeof plugin==='string') plugin=this.pluginList.find(p=>p.name===plugin)
            if(plugin) {
                plugin.dispose()
                this.plugins.delete(plugin.fullName)
            }
            return
        }

        [...this.plugins.values()].forEach(plugin=>plugin.dispose())
        this.emit('dispose')
        while (this.disposes.length){
            const dispose=this.disposes.shift()
            dispose()
        }
    }
}
export class Plugin<T=any>{

}
export interface Context extends Zhin.Services {
    on<T extends keyof Zhin.AllEventMap<this>>(event: T, listener: Zhin.AllEventMap<this>[T]);
    // @ts-ignore
    on<P extends keyof Zhin.Adapters, E extends keyof Zhin.BotEventMaps[P]>(event: `${P}.${E}`, listener: (session: PayloadWithSession<P, E>) => any);

    on<S extends string | symbol>(event: S & Exclude<S, keyof Zhin.AllEventMap<this>>, listener: (...args: any[]) => any);

    emitSync<T extends keyof Zhin.AllEventMap<this>>(event: T, ...args: Parameters<Zhin.AllEventMap<this>[T]>): Promise<void>;

    // @ts-ignore
    emitSync<P extends keyof Zhin.Adapters, E extends keyof Zhin.BotEventMaps[P]>(event: `${P}.${E}`, session: PayloadWithSession<P,  E>): Promise<void>;

    emitSync<S extends string | symbol>(event: S & Exclude<S, keyof Zhin.AllEventMap<this>>, ...args: any[]): Promise<void>;

    bail<T extends keyof Zhin.AllEventMap<this>>(event: T, ...args: Parameters<Zhin.AllEventMap<this>[T]>): any;

    // @ts-ignore
    bail<P extends keyof Zhin.Adapters, E extends keyof Zhin.BotEventMaps[P]>(event: `${P}.${E}`, session: PayloadWithSession<P, E>): any;

    bail<S extends string | symbol>(event: S & Exclude<S, keyof Zhin.AllEventMap<this>>, ...args: any[]): any;

    bailSync<T extends keyof Zhin.AllEventMap<this>>(event: T, ...args: Parameters<Zhin.AllEventMap<this>[T]>): Promise<any>;

    // @ts-ignore
    bailSync<P extends keyof Zhin.Adapters, E extends keyof Zhin.BotEventMaps[P]>(event: `${P}.${E}`, session: PayloadWithSession<P,  E>): Promise<any>;

    bailSync<S extends string | symbol>(event: S & Exclude<S, keyof Zhin.AllEventMap<this>>, ...args: any[]): Promise<any>;
}
export interface Plugin<T=any> extends Context<T>{}
export namespace Plugin{
    export type InstallFunction<T>=(parent:Context, config:T)=>void|Dispose
    export interface InstallObject<T>{
        name?:string
        install:InstallFunction<T>
    }
    export type Install<T=any>=InstallFunction<T>|InstallObject<T>
    export type Config<P extends Install>=P extends Install<infer R>?R:unknown
    export interface Info{
        version?:string
        type?:string
        desc?:string
        author?:string|{name:string,email?:string}
    }
    export type Options<T = any>=InstallObject<T> &{
        type?:string
        protocol?:(keyof Zhin.Adapters)[]
        using?:(keyof Zhin.Services)[]
        setup?:boolean
        anonymous?:boolean
        anonymousCount?:number
        functional?:boolean
        fullName?:string
        fullPath?:string
    }
}