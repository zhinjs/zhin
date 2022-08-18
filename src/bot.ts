import EventDeliver from "event-deliver";
import {Server} from "http";
import {Logger,getLogger} from "log4js";
import * as Yaml from 'js-yaml'
import * as path from 'path'
import * as fs from 'fs'
import 'oicq2-cq-enable'
import {Client, Config as ClientConfig, Sendable} from "oicq";
import {Command} from "@/command";
import {Argv} from "@/argv";
import {DiscussMessageEvent, EventMap, GroupMessageEvent, PrivateMessageEvent} from "oicq/lib/events";
import {deepClone, deepMerge, wrapExport} from "@/utils";
import {Awaitable} from "@/types";

export function createBot(options:Partial<Bot.Options>|string){
    if(typeof options==='string'){
        if(!fs.existsSync(options)) fs.writeFileSync(options,Yaml.dump(Bot.defaultConfig))
        options=Yaml.load(fs.readFileSync(options,{encoding:'utf8'}))
    }
    return new Bot(deepMerge(deepClone(Bot.defaultConfig),options))
}
export function defineConfig(options:Bot.Options){
    return options
}
export class Bot extends EventDeliver{
    plugins:Map<string,Bot.Plugin>=new Map<string, Bot.Plugin>()
    middlewares:Bot.Middleware[]=[]
    commands:Map<string,Command>=new Map<string, Command>()
    private readonly client:Client
    public logger:Logger
    constructor(public options:Bot.Options) {
        super();
        this.logger=getLogger('zhin')
        this.logger.level=options.log_level||'info'
        if(!options.uin) throw new Error('need client account')
        this.client=new Client(options.uin,options)
        const oldEmit=this.client.emit
        const _this=this
        this.client.emit=function (event:string|symbol,...args:any[]){
            _this.emit(event,...args)
            return oldEmit.apply(this,[event,...args])
        }
        return new Proxy(this,{
            get(target: typeof _this, p: string | symbol, receiver: any): any {
                let result=Reflect.get(target,p,receiver)
                if(result) return result
                result = Reflect.get(target.client,p,receiver)
                if(typeof result==='function') result.bind(target.client)
                return result
            }
        })
    }
    middleware(middleware:Bot.Middleware){
        this.middlewares.push(middleware)
        return this
    }
    get commandList(){
        return [...this.commands.values()].flat()
    }
    plugin<T>(name:string,plugin:Bot.Plugin<T>,options:T){
        const _this=this
        plugin.disposes=[]
        plugin.dispose=function (){
            while (this.disposes.length){
                const dispose=this.disposes.shift()
                dispose()
            }
            plugin.disposes=[]
            return true
        }
        const proxy=new Proxy(this,{
            get(target: typeof _this, p: PropertyKey, receiver: any): any {
                const proxyEvents=['on','once','addListener','addOnceListener','plugin','command']
                const result=Reflect.get(target,p,receiver)
                if(typeof result!=='function' || typeof p !=='string' || !proxyEvents.includes(p)) return result
                return new Proxy(result,{
                    apply(target: typeof _this, thisArg: any, argArray?: any): any {
                        let res=result.apply(thisArg,argArray) as Bot.Dispose
                        if(res instanceof Command){
                            plugin.disposes.push(()=>{
                                _this.commands.delete(res.name)
                                return true
                            })
                        }else{
                            plugin.disposes.push(res)
                        }
                        return res
                    }
                })
            }
        })
        const callback=(plugin['install']||plugin) as Bot.FunctionPlugin<T>
        callback.apply(plugin,[proxy,options])
        this.plugins.set(name,plugin)
        return plugin
    }
    command<D extends string>(def: D,triggerEvent:Command.TriggerEvent): Command<Argv.ArgumentType<D>>{
        const namePath = def.split(' ', 1)[0]
        const decl = def.slice(namePath.length)
        const segments = namePath.split(/(?=[/])/g)

        let parent: Command, nameArr=[]
        while (segments.length){
            const segment=segments.shift()
            const code = segment.charCodeAt(0)
            const tempName = code === 47 ? segment.slice(1) : segment
            nameArr.push(tempName)
            if(segments.length)parent=this.commandList.find(cmd=>cmd.name===tempName)
            if(!parent && segments.length) throw Error(`cannot find parent command:${nameArr.join('.')}`)
        }
        const name=nameArr.pop()
        const command = new Command(name+decl,triggerEvent)
        if(parent){
            command.parent=parent
            parent.children.push(command)
        }
        this.commands.set(name,command)
        return command as any
    }
    use<T>(plugin:Bot.Plugin<T>,options?:T):this{
        this.plugin(plugin.name,plugin,options)
        return this
    }
    dispose<T>(plugin?:Bot.Plugin<T>|string){
        if(!plugin) {
            this.plugins.forEach(plugin=>{
                this.dispose(plugin)
            })
            this.plugins.clear()
            return
        }
        if(typeof plugin==='string'){
            const plug=this.plugins.get(plugin)
            this.dispose(plug)
            this.plugins.delete(plugin)
            return
        }
        plugin.dispose()
    }
    private compose (middlewares:Bot.Middleware[]):Bot.ComposedMiddleware {
        if (!Array.isArray(middlewares)) throw new TypeError('Middleware stack must be an array!')
        for (const fn of middlewares) {
            if (typeof fn !== 'function') throw new TypeError('Middleware must be composed of functions!')
        }
        return function (message:Bot.MessageEvent, next?:Bot.Next) {
            // last called middleware #
            let index = -1
            return dispatch(0)
            function dispatch (i) {
                if (i <= index) return Promise.reject(new Error('next() called multiple times'))
                index = i
                let fn = middlewares[i]
                if (i === middlewares.length) fn = next
                if (!fn) return Promise.resolve()
                try {
                    return Promise.resolve(fn(message, dispatch.bind(null, i + 1)));
                } catch (err) {
                    return Promise.reject(err)
                }
            }
        }
    }
    public load(name: string) {
        function getListenDir(modulePath:string){
            if(modulePath.endsWith('/index')) return modulePath.replace('/index','')
            for(const extension of ['ts','js','cjs','mjs']){
                if (fs.existsSync(`${modulePath}.${extension}`)) return `${modulePath}.${extension}`
            }
            return modulePath
        }
        let resolved
        const orgModule = `@zhin/plugin-${name}`
        const comModule = `zhin-plugin-${name}`
        const builtModule = path.join(__dirname, `plugins`, name)
        let customModule
        if (this.options.plugin_dir) customModule = path.resolve(this.options.plugin_dir, name)
        if (customModule) {
            try {
                require.resolve(customModule)
                resolved = customModule
            } catch {
            }
        }
        if (!resolved) {
            try {
                require.resolve(builtModule)
                resolved = `${__dirname}/plugins/${name}`
            } catch {
            }
        }
        if (!resolved) {
            try {
                require.resolve(orgModule)
                resolved = path.resolve(process.cwd(),'node_modules',`@oitq/plugin-${name}`)
            } catch {
            }
        }
        if (!resolved) {
            try {
                require.resolve(comModule)
                resolved = path.resolve(process.cwd(),'node_modules',`oitq-plugin-${name}`)
            } catch {
            }
        }

        if (!resolved) throw new Error(`未找到plugin(${name})`)
        const result=wrapExport(resolved)
        return {
            install:result.install||result,
            name:result.name||name,
            fullPath:getListenDir(resolved)
        }
    }
    findCommand(argv: Argv) {
        return this.commandList.find(cmd => {
            return cmd.name === argv.name
                || cmd.aliasNames.includes(argv.name)
                || cmd.shortcuts.some(({name}) => typeof name === 'string' ? name === argv.name : name.test(argv.cqCode))
        })
    }
    async executeCommand(message:Bot.MessageEvent):Promise<Sendable|boolean|void>{
        const argv=Argv.parse(message.cqCode)
        argv.client=this.client
        argv.event=message
        const command=this.findCommand(argv)
        if(command){
            let result:Sendable|void|boolean
            if (result) return result
            try{
                return await command.execute(argv)
            }catch (e){
                this.logger.warn(e.message)
            }
        }
    }
    start(){
        for(const pluginName of Object.keys(this.options.plugins)){
            const plugin=this.load(pluginName)
            this.use(plugin,this.options.plugins[pluginName])
        }
        this.middleware(async (message)=>{
            const result=await this.executeCommand(message)
            if(result && typeof result!=='boolean') await message.reply(result)
        })
        this.on('message',(event)=>{
            const middleware=this.compose(this.middlewares)
            middleware(event)
        })
        this.client.login(this.options.password)
    }
    listen(port:number){
        const server:Server=new Server()
        this.start()
        server.listen(port,()=>{
            this.logger.info('server listening at http://localhost:'+port)
        })
        return server
    }
}
export interface Bot extends EventDeliver,Omit<Client, keyof EventDeliver>{
    on<T extends keyof EventMap>(event: T, listener: EventMap<this>[T]):EventDeliver.Dispose;
    on<S extends string | symbol>(event: S & Exclude<S, keyof EventMap>, listener: (this: this, ...args: any[]) => void):EventDeliver.Dispose;
    once<T extends keyof EventMap>(event: T, listener: EventMap<this>[T]):EventDeliver.Dispose;
    once<S extends string | symbol>(event: S & Exclude<S, keyof EventMap>, listener: (this: this, ...args: any[]) => void):EventDeliver.Dispose;
    prependListener<T extends keyof EventMap>(event: T, listener: EventMap<this>[T]):EventDeliver.Dispose;
    prependListener(event: string | symbol, listener: (this: this, ...args: any[]) => void):EventDeliver.Dispose;
    emit<T extends keyof EventMap>(event: T, ...args:Parameters<EventMap<this>[T]>):void;
    emit<S extends string | symbol>(event: S & Exclude<S, keyof EventMap>, ...args:any[]):void;
    emitSync<T extends keyof EventMap>(event: T, ...args:Parameters<EventMap<this>[T]>):Promise<void>;
    emitSync<S extends string | symbol>(event: S & Exclude<S, keyof EventMap>, ...args:any[]):Promise<void>;
    bailSync<T extends keyof EventMap>(event: T, ...args:Parameters<EventMap<this>[T]>):Promise<any>;
    bailSync<S extends string | symbol>(event: S & Exclude<S, keyof EventMap>, ...args:any[]):Promise<any>;
    bail<T extends keyof EventMap>(event: T, ...args:Parameters<EventMap<this>[T]>):any;
    bail<S extends string | symbol>(event: S & Exclude<S, keyof EventMap>, ...args:any[]):any;
    off<T extends keyof EventMap>(event: T, listener: EventMap<this>[T]);
    off<S extends string | symbol>(event: S & Exclude<S, keyof EventMap>, listener: (this: this, ...args: any[]) => void);
}
export namespace Bot{
    export const defaultConfig:Partial<Options>={
        uin:1472558369,
        password: 'zhin.icu',
        plugins:{},
        plugin_dir:path.join(process.cwd(),'plugins'),
        data_dir:path.join(process.cwd(),'data')
    }
    export interface Options extends ClientConfig{
        uin:number
        password?:string
        plugins?:Record<string, any>
        plugin_dir?:string
    }
    export type Dispose=()=>boolean
    export type FunctionPlugin<T>=((app:Bot,options:T)=>any) & {
        dispose?:Dispose
        disposes?:Dispose[]
    }
    export interface ObjectPlugin<T>{
        install:FunctionPlugin<T>
        name:string
        fullPath?:string
        dispose?:Dispose
        disposes?:Dispose[]
        [index:string]:any
    }
    export type Middleware = (event: MessageEvent, next: Next) => Awaitable<Sendable|boolean|void>;
    export type ComposedMiddleware = (event: MessageEvent, next?: Next) => Awaitable<Sendable|boolean|void>
    export type Next = () => Promise<any>;
    export type MessageEvent=PrivateMessageEvent|GroupMessageEvent|DiscussMessageEvent
    export type Plugin<T = any>= (FunctionPlugin<T> |ObjectPlugin<T>)
}