import EventDeliver from "event-deliver";
import {Server} from "http";
import {join,resolve} from 'path'
import {fork,ChildProcess} from "child_process";
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
interface Message {
    type: 'start' | 'queue'
    body: any
}
export type TargetType = 'group' | 'private' | 'discuss'
export type ChannelId = `${TargetType}:${number}`
let cp:ChildProcess

let buffer = null
export function createWorker(options:Bot.Options|string='zhin.yaml'){
    if(typeof options!=='string') fs.writeFileSync(join(process.cwd(),'zhin.yaml'),Yaml.dump(options))
    cp=fork(join(__dirname,'worker'),[],{
        env:{
            configPath:resolve(process.cwd(),typeof options==='string'?options:'zhin.yaml')
        },
        execArgv:[
            '-r', 'esbuild-register',
            '-r', 'tsconfig-paths/register'
        ]
    })
    let config: { autoRestart: boolean }
    cp.on('message', (message: Message) => {
        if (message.type === 'start') {
            config = message.body
            if (buffer) {
                cp.send({type: 'send', body: buffer})
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
    master:number
    admins:number[]
    private readonly client:Client
    public logger:Logger
    constructor(public options:Bot.Options) {
        super();
        this.logger=getLogger('zhin')
        this.logger.level=options.log_level||'info'
        if(!options.uin) throw new Error('need client account')
        this.client=new Client(options.uin,options)
        this.master=options.master
        this.admins=[].concat(options.admins).filter(Boolean)
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
    isMaster(user_id:number){
        return this.master===user_id
    }
    isAdmin(user_id:number){
        return this.admins.includes(user_id)
    }
    middleware(middleware:Bot.Middleware):Bot.Dispose{
        this.middlewares.push(middleware)
        return ()=>EventDeliver.remove(this.middlewares,middleware)
    }
    get commandList(){
        return [...this.commands.values()].flat()
    }
    sendMsg(channelId:ChannelId,message:Sendable){
        const [targetType,targetId] = channelId.split(':') as [TargetType,`${number}`]
        switch (targetType){
            case "discuss":
                return this.sendDiscussMsg(Number(targetId),message)
            case "group":
                return this.sendGroupMsg(Number(targetId),message)
            case "private":
                return this.sendPrivateMsg(Number(targetId),message)
            default:
                throw new Error('无法识别的channelId:'+channelId)
        }
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
                const proxyEvents=['addListener','command']
                const result=Reflect.get(target,p,receiver)
                if(typeof result!=='function' || typeof p !=='string' || !proxyEvents.includes(p)) return result
                return new Proxy(result,{
                    apply(target: typeof _this, thisArg: any, argArray?: any): any {
                        let res=result.apply(thisArg,argArray)
                        if(res instanceof Command){
                            plugin.disposes.push(()=>{
                                _this.commands.delete(res.name)
                                _this.emit('command-remove',res)
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
        this.emit('plugin-add',plugin)
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
        command.bot=this
        if(parent){
            command.parent=parent
            parent.children.push(command)
        }
        this.commands.set(name,command)
        this.emit('command-add',command)
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
            this.emit('dispose');
            return process.exit()
        }
        if(typeof plugin==='string'){
            const plug=this.plugins.get(plugin)
            this.dispose(plug)
            this.plugins.delete(plugin)
            this.emit('plugin-remove',plug)
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
            result= await this.bailSync('before-command',argv)
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
            this.logger.info('已载入:'+pluginName)
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
        this.emit('ready')
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
    on<T extends keyof Bot.AllEventMap<this>>(event: T, listener: Bot.AllEventMap<this>[T]):EventDeliver.Dispose;
    on<S extends string | symbol>(event: S & Exclude<S, keyof Bot.AllEventMap<this>>, listener: (this: this, ...args: any[]) => void):EventDeliver.Dispose;
    before<T extends keyof Bot.BotEventMap<this>>(event: T, listener: Bot.BotEventMap<this>[T]):EventDeliver.Dispose;
    before<S extends string>(event: S & Exclude<S, keyof Bot.BotEventMap<this>>, listener: (this: this, ...args: any[]) => void):EventDeliver.Dispose;
    after<T extends keyof Bot.BotEventMap<this>>(event: T, listener: Bot.BotEventMap<this>[T]):EventDeliver.Dispose;
    after<S extends string>(event: S & Exclude<S, keyof Bot.BotEventMap<this>>, listener: (this: this, ...args: any[]) => void):EventDeliver.Dispose;
    once<T extends keyof Bot.AllEventMap<this>>(event: T, listener: Bot.AllEventMap<this>[T]):EventDeliver.Dispose;
    once<S extends string | symbol>(event: S & Exclude<S, keyof Bot.AllEventMap<this>>, listener: (this: this, ...args: any[]) => void):EventDeliver.Dispose;
    prependListener<T extends keyof Bot.AllEventMap<this>>(event: T, listener: Bot.AllEventMap<this>[T]):EventDeliver.Dispose;
    prependListener<S extends string | symbol>(event: S & Exclude<S, keyof Bot.AllEventMap<this>>, listener: (this: this, ...args: any[]) => void):EventDeliver.Dispose;
    emit<T extends keyof Bot.AllEventMap<this>>(event: T, ...args:Parameters<Bot.AllEventMap<this>[T]>):void;
    emit<S extends string | symbol>(event: S & Exclude<S, keyof Bot.AllEventMap<this>>, ...args:any[]):void;
    emitSync<T extends keyof Bot.AllEventMap<this>>(event: T, ...args:Parameters<Bot.AllEventMap<this>[T]>):Promise<void>;
    emitSync<S extends string | symbol>(event: S & Exclude<S, keyof Bot.AllEventMap<this>>, ...args:any[]):Promise<void>;
    bailSync<T extends keyof Bot.AllEventMap<this>>(event: T, ...args:Parameters<Bot.AllEventMap<this>[T]>):Promise<any>;
    bailSync<S extends string | symbol>(event: S & Exclude<S, keyof Bot.AllEventMap<this>>, ...args:any[]):Promise<any>;
    bail<T extends keyof Bot.AllEventMap<this>>(event: T, ...args:Parameters<Bot.AllEventMap<this>[T]>):any;
    bail<S extends string | symbol>(event: S & Exclude<S, keyof Bot.AllEventMap<this>>, ...args:any[]):any;
    off<T extends keyof Bot.AllEventMap<this>>(event: T, listener: Bot.AllEventMap<this>[T]);
    off<S extends string | symbol>(event: S & Exclude<S, keyof Bot.AllEventMap<this>>, listener: (this: this, ...args: any[]) => void);
}
export namespace Bot{
    export const defaultConfig:Partial<Options>={
        uin:1472558369,
        password: 'zhin.icu',
        plugins:{},
        delay:{},
        plugin_dir:path.join(process.cwd(),'plugins'),
        data_dir:path.join(process.cwd(),'data')
    }
    type BeforeEventMap<T>={
        [P in keyof EventMap<T> as `before-${P}`]:EventMap<T>[P]
    } & BeforeLifeCycle

    type AfterEventMap<T>={
        [P in keyof EventMap<T> as `after-${P}`]:EventMap<T>[P]
    } & AfterLifeCycle
    type BeforeLifeCycle={
        [P in keyof LifeCycle as `before-${P}`]:LifeCycle[P]
    }
    type AfterLifeCycle={
        [P in keyof LifeCycle as `after-${P}`]:LifeCycle[P]
    }
    export interface LifeCycle{
        'ready'():void
        'dispose'():void
        'command-add'(command:Command):void
        'command-remove'(command:Command):void
        'plugin-add'(plugin:Plugin):void
        'plugin-remove'(plugin:Plugin):void
    }
    export interface BotEventMap<T> extends EventMap<T>,LifeCycle{
    }
    export interface AllEventMap<T> extends BeforeEventMap<T>,AfterEventMap<T>,BotEventMap<T>{}
    export interface Options extends ClientConfig{
        uin:number
        password?:string
        master?:number
        admins?:number|number[]
        delay:Record<string, number>
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