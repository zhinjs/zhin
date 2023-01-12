import {App, isConstructor} from "@/app";
import {Dispose} from "@/dispose";
import {Adapter, AdapterConstructs, AdapterOptions, AdapterOptionsType, Adapters} from "@/adapter";
import {Middleware} from "@/middleware";
import {Command} from "@/command";
import {Session} from "@/session";
import {EventEmitter} from "events";
import {remove} from "@/utils";
import {Argv} from "@/argv";
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
    platform:(keyof Adapters)[]
    using:string[]=[]
    functional:boolean=false
    fullPath:string
    plugins:Map<string,Plugin>=new Map<string, Plugin>()
    middlewares:Middleware<Session>[]=[]
    private disposes:Dispose[]=[]
    app:App
    commands:Map<string,Command>=new Map<string, Command>()
    constructor(public parent:Context,options:Plugin.Options<T>,public info:Plugin.Info={}) {
        super()
        if(!parent) return
        this.name=options.name
        this.platform=options.platform
        this.type=options.type||''
        this.using=options.using||[]
        this.fullName=options.fullName
        this.fullPath=options.fullPath
        this.functional=options.functional||false
        this.app=parent.app
        this.disposes.push(()=>{
            this.parent.plugins.delete(this.fullName)
            this.app.logger.info('已移除：',this.name)
            this.parent.emit('plugin-remove',this)
        })
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

    adapter<K extends keyof Adapters>(platform: K): Adapters[K]
    adapter<K extends keyof Adapters>(platform: K, options: AdapterOptionsType<Adapters[K]>): this
    adapter<K extends keyof Adapters>(platform: K, adapter: AdapterConstructs[K], options: AdapterOptionsType<Adapters[K]>): this
    adapter<K extends keyof Adapters>(platform: K, Construct?: AdapterConstructs[K] | AdapterOptions, options?: AdapterOptions) {
        if (!Construct && !options) return this.app.adapters.get(platform)
        if (typeof Construct !== "function") {
            const result=this.app.load<Plugin.Options>(platform, 'adapter')
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
        this.app.adapters.set(platform, new Construct(this.app, platform, options))
        return Dispose.from(this, () => {
            dispose()
            this.app.adapters.delete(platform)
        }) as any
    }
    service<K extends keyof App.Services>(key: K): App.Services[K]
    service<K extends keyof App.Services>(key: K, service: App.Services[K]): this
    service<K extends keyof App.Services, T>(key: K, constructor: App.ServiceConstructor<App.Services[K], T>, options?: T): this
    service<K extends keyof App.Services, T>(key: K, Service?: App.Services[K] | App.ServiceConstructor<App.Services[K], T>, options?: T): App.Services[K] | this {
        if (Service === undefined) {
            return this.app.services.get(key)
        }
        if (this.app[key]) throw new Error('服务key不能和bot已有属性重复')
        if (isConstructor(Service)) {
            this.app.services.set(key,new Service(this.app, options))
        } else {
            this.app.services.set(key,Service)
        }
        return Dispose.from(this, () => {
            this.app.services.delete(key)
        })
    }
    plugin<T>(name: string, options?: T): Context | this
    plugin<P extends Plugin.Install>(plugin: P, config?: Plugin.Config<P>): this
    plugin<P extends Plugin.Install>(entry: string | P, config?: Plugin.Config<P>) {
        let options: Plugin.Options
        if (typeof entry === 'string') {
            const result = this.plugins.get(entry)
            if (result) return result
            try {
                options = this.app.load<Plugin.Options>(entry, 'plugin')
            } catch (e) {
                this.app.logger.warn(e.message)
                return this
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
            if (segments.length) parent = this.app.commandList.find(cmd => cmd.name === tempName)
            if (!parent && segments.length) throw Error(`cannot find parent command:${nameArr.join('.')}`)
        }
        const name = nameArr.pop()
        const command = new Command(name + decl)
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
    middleware(middleware: Middleware<Session>, prepend?: boolean) {
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
        return
    }

    setInterval(callback: Function, ms: number, ...args) {
        const timer = setInterval(callback, ms, ...args)
        const dispose = Dispose.from(this, () => clearInterval(timer))
        this.disposes.push(dispose)
        return dispose
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
        while (this.disposes.length){
            const dispose=this.disposes.shift()
            dispose()
        }
    }
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
        platform?:(keyof Adapters)[]
        using?:(keyof App.Services)[]
        setup?:boolean
        anonymous?:boolean
        anonymousCount?:number
        functional?:boolean
        fullName?:string
        fullPath?:string
    }
}