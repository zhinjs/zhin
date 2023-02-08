import {Zhin, isConstructor, ChannelId} from "./zhin";
import {Dispose} from "./dispose";
import {Adapter, AdapterConstructs, AdapterOptions, AdapterOptionsType} from "./adapter";
import {Middleware} from "./middleware";
import {Command, TriggerSessionMap} from "./command";
import {PayloadWithSession, Session} from "./session";
import Element from './element'
import {EventEmitter} from "events";
import {isBailed, remove} from "./utils";
import {Argv} from "./argv";
import {Plugin} from "@/plugin";
import { Dict} from "./types";
import {Component} from "./component";
import {Logger} from "log4js";
import {Bot} from "./bot";

export class Context<T=any> extends EventEmitter{
    plugins:Map<string,Plugin>=new Map<string, Plugin>()
    public components: Dict<Component> = Object.create(null)
    middlewares:Middleware<PayloadWithSession<keyof Zhin.Adapters,'message'>>[]=[]
    public readonly disposes:Dispose[]=[]
    app:Zhin
    commands:Map<string,Command>=new Map<string, Command>()
    constructor(public parent:Context) {
        super()
        if(!parent) return
        this.app=parent.app
        this.logger=parent.logger
        return new Proxy(this,{
            get(target: Context<T>, p: string | symbol, receiver: any): any {
                if(Zhin.Services.includes(p as keyof Zhin.Services)) return target.app.services.get(p as keyof Zhin.Services)
                return Reflect.get(target,p,receiver)
            }
        })
    }
    public logger: Logger
    component(name: string, component: Component|Component['render'],options?:Omit<Component, 'render'>) {
        if(typeof component==='function') component={
            ...(options||{}),
            render:component
        }
        this.components[name] = component as Component
        return Dispose.from(this,()=>{
            delete this.components[name]
        })
    }
    get middlewareList(){
        return [...this.plugins.values()].reduce((result,plugin)=>{
            result.push(...plugin.context.middlewareList)
            return result
        },[...this.middlewares])
    }
    get componentList(){
        return [...this.plugins.values()].reduce((result,plugin)=>{
            Object.assign(result,plugin.context.componentList)
            return result
        },this.components)
    }
    get commandList():Command[] {
        return [...this.plugins.values()].reduce((result,plugin)=>{
            result.push(...plugin.context.commandList)
            return result
        },[...this.commands.values()])
    }

    get pluginList():Plugin[] {
        return [...this.plugins.values()].reduce((result,plugin)=>{
            result.push(...plugin.context.pluginList)
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
    // 往下级插件抛事件
    dispatch<P extends keyof Zhin.Adapters, E extends keyof Zhin.BotEventMaps[P]>(protocol:P,eventName:E, session: Session<P, E>){
        this.emit(`${protocol}.${String(eventName)}`,session)
        for(const plugin of this.getSupportPlugins(session.protocol)){
            plugin.context.dispatch(protocol,eventName,session)
        }
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
        const dispose = this.app.on(`${adapter}.message`, (session) => {
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
    plugin<T>(name: string, options?: T): Plugin | this
    plugin<T>(name: string,setup?:boolean, options?: T): Plugin | this
    plugin<P extends Plugin.Install>(plugin: P, config?: Plugin.Config<P>): this
    plugin<P extends Plugin.Install>(entry: string | P, ...args:[boolean?,Plugin.Config<P>?]) {
        let options: Plugin.Options<T>
        const setup:boolean=typeof args[0]==='boolean'?args.shift():false
        const config:Plugin.Config<P>=args.shift() as any
        if (typeof entry === 'string') {
            const result = this.plugins.get(entry)
            if (result) return result
            try {
                options = this.app.load<Plugin.Options>(entry, 'plugin',setup)
            } catch (e) {
                this.app.logger.warn(e.message)
                return this
            }
        } else {
            options = Plugin.defineOptions<T>(entry)
        }
        const info:Plugin.Info=Plugin.getInfo(options.fullPath)
        const installPlugin = () => {
            const context=new Context(this)
            const plugin=new Plugin(options,info)
            if (this.plugins.get(options.fullName)) {
                this.app.logger.warn('重复载入:' + options.name)
                return
            }
            if (options.setup) {
                this.plugins.set(options.fullName, plugin)
                plugin.install(context,config)
            } else {
                plugin.install(context,config)
                this.plugins.set(options.fullName, plugin)
            }
            this.app.logger.info('已载入:' + options.name)
            this.app.emit('plugin-add', plugin)
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
        command.context = this
        if (parent) {
            command.parent = parent
            parent.children.push(command)
        }
        this.commands.set(name, command)
        this.app.emit('command-add', command,this)
        this.disposes.push(()=>{
            this.commands.delete(name)
            this.app.emit('command-remove', command,this)
        })
        return command as Command<Argv.ArgumentType<D>,{},T>
    }
    middleware(middleware: Middleware<PayloadWithSession<keyof Zhin.Adapters,'message'>>, prepend?: boolean) {
        const method: 'push' | 'unshift' = prepend ? 'unshift' : "push"
        this.app.middlewares[method](middleware)
        return Dispose.from(this, () => {
            return remove(this.app.middlewares, middleware);
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

    getSupportPlugins<P extends keyof Zhin.Adapters>(protocol:P){
        return this.pluginList.filter(plugin=>{
            return plugin.options.scopes===undefined || plugin.options.scopes.length===0 || plugin.options.scopes.includes(protocol)
        })
    }
    setInterval(callback: Function, ms: number, ...args) {
        const timer = setInterval(callback, ms, ...args)
        const dispose = Dispose.from(this, () => clearInterval(timer))
        this.disposes.push(dispose)
        return dispose
    }
    broadcast(channelId:ChannelId,content:Element.Fragment){
        const [platform,self_id,target_type=platform,target_id=self_id]=channelId.split(':')
        const bots=[...this.app.adapters.values()].reduce((result,adapter)=>{
           if(platform===target_type) result.push(...(adapter.bots as Bot[]))
           else if(platform===adapter.protocol) result.push(...(adapter.bots.filter(bot=>bot.self_id===self_id) as Bot[]))
            return result
        },[] as Bot[])
        return Promise.all(bots.map(bot=>bot.sendMsg(Number(target_id),<"private" | "group" | "discuss" | "guild">target_type,content)))
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
                this.plugins.delete(plugin.options.fullName)
            }
            return
        }
        [...this.plugins.values()].forEach(plugin=>{
            plugin.dispose()
            this.plugins.delete(plugin.options.fullName)
        })
        this.emit('dispose')
        while (this.disposes.length){
            const dispose=this.disposes.shift()
            dispose()
        }
    }
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

    component(name: string, render: Component['render'],options?:Omit<Component, 'render'>):this
    component(name: string, component: Component):this
    component(name: string, component: Component|Component['render'],options?:Omit<Component, 'render'>):this
}