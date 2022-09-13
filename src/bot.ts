import EventDeliver from "event-deliver";
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
import {deepClone, deepMerge, wrapExport,remove} from "@/utils";
import {Awaitable, Dict} from "@/types";
import {Prompt} from "@/prompt";
import {Plugin} from "@/plugin";
import Koa from "koa";

interface Message {
    type: 'start' | 'queue'
    body: any
}
export type TargetType = 'group' | 'private' | 'discuss'
export type ChannelId = `${TargetType}:${number}`
let cp:ChildProcess
export function isConstructor<R,T>(value:any):value is (new (...args:any[])=>any){
    return typeof value==='function' && value.prototype && value.prototype.constructor===value
}
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
    isReady:boolean=false
    plugins:Map<string,Plugin>=new Map<string, Plugin>()
    private services:Record<string, any>={}
    disposes:Bot.Dispose[]=[]
    middlewares:Bot.Middleware[]=[]
    commands:Map<string,Command>=new Map<string, Command>()
    master:number
    admins:number[]
    private readonly client:Client
    public logger:Logger
    constructor(public options:Bot.Options) {
        super();
        this.service('koa',new Koa())
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
        this.on('dispose',()=>{
            while (this.disposes.length){
                const dispose=this.disposes.shift()
                dispose()
            }
        })
        return new Proxy(this,{
            get(target: typeof _this, p: string | symbol, receiver: any): any {
                let result=Reflect.get(target,p,receiver)
                if(result) return result
                result=Reflect.get(target.services,p,receiver)
                if(result) return result
                result = Reflect.get(target.client,p,receiver)
                if(typeof result==='function') result.bind(target.client)
                return result
            }
        })
    }
    service<K extends keyof Bot.Services>(key:K):Bot.Services[K]
    service<K extends keyof Bot.Services>(key:K,service:Bot.Services[K]):this
    service<K extends keyof Bot.Services,T>(key:K,constructor:Bot.ServiceConstructor<Bot.Services[K],T>,options?:T):this
    service<K extends keyof Bot.Services,T>(key:K,Service?:Bot.Services[K]|Bot.ServiceConstructor<Bot.Services[K],T>,options?:T):Bot.Services[K]|this{
        if(Service===undefined){
            return this.services[key]
        }
        if(isConstructor(Service)){
            this.services[key]=new Service(this,options)
        }else{
            this.services[key]=Service
        }
        return this
    }
    isMaster(user_id:number){
        return this.master===user_id
    }
    isAdmin(user_id:number){
        return this.admins.includes(user_id)
    }
    middleware(middleware:Bot.Middleware,prepend?:boolean):Bot.Dispose{
        const method:'push'|'unshift'=prepend?"unshift":"push"
        if(this.middlewares.indexOf(middleware)!==-1) return ()=>EventDeliver.remove(this.middlewares,middleware)
        this.middlewares[method](middleware)
        const dispose=()=>remove(this.middlewares,middleware)
        this.disposes.push(dispose)
        return dispose
    }
    get commandList(){
        return [...this.commands.values()].flat()
    }
    private promptReal<T extends keyof Prompt.TypeKV>(prev: any, answer: Dict, options: Prompt.Options<T>,event): Promise<Prompt.ValueType<T> | void> {
        if (typeof options.type === 'function') options.type = options.type(prev, answer, options)
        if (!options.type) return
        if (['select', 'multipleSelect'].includes(options.type as keyof Prompt.TypeKV) && !options.choices) throw new Error('choices is required')
        return new Promise<Prompt.ValueType<T> | void>(resolve => {
            event.reply(Prompt.formatOutput(prev, answer, options))
            const dispose = this.middleware((session,next) => {
                const cb = () => {
                    let result = Prompt.formatValue(prev, answer, options, session.cqCode)
                    dispose()
                    resolve(result)
                    timeoutDispose()
                }
                if (!options.validate) {
                    cb()
                } else {
                    if (typeof options.validate !== "function") {
                        options.validate = (str: string) => (options.validate as RegExp).test(str)
                    }
                    try {
                        let result = options.validate(session.cqCode)
                        if (result && typeof result === "boolean") cb()
                        else event.reply(options.errorMsg)
                    } catch (e) {
                        event.reply(e.message)
                    }
                }
                next()
            })
            const timeoutDispose = this.setTimeout(() => {
                dispose()
                resolve()
            }, options.timeout || this.options.delay.prompt)
        })
    }

    async prompt<T extends keyof Prompt.TypeKV>(options: Prompt.Options<T> | Array<Prompt.Options<T>>,event:Bot.MessageEvent) {
        options = [].concat(options)
        let answer: Dict = {}
        let prev: any = undefined
        try {
            if (options.length === 0) return
            for (const option of options) {
                if (typeof option.type === 'function') option.type = option.type(prev, answer, option)
                if (!option.type) continue
                if (!option.name) throw new Error('name is required')
                prev = await this.promptReal(prev, answer, option,event)
                answer[option.name] = prev
            }
        } catch (e) {
            event.reply(e.message)
        }
        return answer as Prompt.Answers<Prompt.ValueType<T>>
    }
    plugin(name:string):Plugin
    plugin<T>(plugin:Plugin<T>,options?:T):this
    plugin<T>(plugin:string|Plugin<T>,options?:T){
        if(typeof plugin==='string') return this.plugins.get(plugin)
        const _this=this
        const proxy=new Proxy(this,{
            get(target: typeof _this, p: PropertyKey, receiver: any): any {
                const proxyEvents=['addListener','command','middleware']
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
        const installPlugin=()=>{
            plugin.disposes=[]
            plugin.dispose=()=>{
                while (this.disposes.length){
                    const dispose=plugin.disposes.shift()
                    dispose()
                }
                plugin.disposes=[]
                return true
            }
            const installFunction= typeof plugin==="function"?plugin:plugin.install
            installFunction.apply(plugin,[proxy,options])
            this.plugins.set(plugin.name,plugin)
            this.logger.info('已载入:'+plugin.name)
            this.emit('plugin-add',plugin)
        }
        const using=plugin.using||=[]
        if(!using.length){
            installPlugin()
        }else{
            if(!using.every(name=>this.plugins.has(name))){
                this.logger.info(`插件(${plugin.name})将在所需插件(${using.join()})加载完毕后加载`)
                const dispose=this.on('plugin-add',()=>{
                    if(using.every(name=>this.plugins.has(name))){
                        dispose()
                        installPlugin()
                    }
                })
            }else{
                installPlugin()
            }
        }
        return this
    }
    command<D extends string>(def: D,triggerEvent:Command.TriggerEvent='all'): Command<Argv.ArgumentType<D>>{
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
    sendMsg(channelId: ChannelId, message: string) {
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

    setTimeout(callback:Function,ms:number,...args):Bot.Dispose{
        const timer=setTimeout(()=>{
            callback()
            dispose()
            remove(this.disposes,dispose)
        },ms,...args)
        const dispose=()=>{clearTimeout(timer);return true}
        this.disposes.push(dispose)
        return dispose
    }
    setInterval(callback:Function,ms:number,...args):Bot.Dispose{
        const timer=setInterval(callback,ms,...args)
        const dispose=()=>{clearInterval(timer);return true}
        this.disposes.push(dispose)
        return dispose
    }
    use(middleware:Bot.Middleware):this{
        this.middleware(middleware)
        return this
    }
    dispose<T>(plugin?:Plugin<T>|string){
        if(!plugin) {
            this.plugins.forEach(plugin=>{
                this.dispose(plugin)
            })
            this.emit('dispose');
            return this
        }
        if(typeof plugin==='string'){
            plugin=this.plugins.get(plugin)
        }
        plugin.dispose()
        this.plugins.delete(plugin.name)
        this.logger.info('已移除:'+plugin.name)
        this.emit('plugin-remove',plugin)
        return this
    }
    private compose (middlewares:Bot.Middleware[]=this.middlewares):Bot.ComposedMiddleware {
        if (!Array.isArray(middlewares)) throw new TypeError('Middleware stack must be an array!')
        for (const fn of middlewares) {
            if (typeof fn !== 'function') throw new TypeError('Middleware must be composed of functions!')
        }
        return (message:Bot.MessageEvent, next?:Bot.Next)=> {
            let index = -1
            const dispatch= (i)=>{
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
            return dispatch(0)
        }
    }
    public load(name: string,type:string='plugin') {
        function getListenDir(modulePath:string){
            if(modulePath.endsWith('/index')) return modulePath.replace('/index','')
            for(const extension of ['ts','js','cjs','mjs']){
                if (fs.existsSync(`${modulePath}.${extension}`)) return `${modulePath}.${extension}`
            }
            return modulePath
        }
        function getResolvePath(moduleName:string){
            try {
                return require.resolve(moduleName)
            } catch {
                return ''
            }
        }
        function getModulesPath(modules:string[]){
            for(const moduleName of modules){
                const result=getResolvePath(moduleName)
                if(result) return result
            }
            return ''
        }
        const resolved=getModulesPath([
            this.options[`${type}_dir`] ? path.resolve(this.options[`${type}_dir`], name):null,// 用户自定义插件/服务/游戏目录
            path.join(__dirname, `${type}s`, name), // 内置插件/服务/游戏目录
            `@zhinjs/${type}-${name}`,// 官方插件/服务/游戏模块
            `zhin-${type}-${name}`,// 社区插件/服务/游戏模块
        ].filter(Boolean))
        if (!resolved) throw new Error(`未找到${type}(${name})`)
        const result=wrapExport(resolved)
        const plugin:Plugin={
            install:result.install||result,
            using:result.using ||= [],
            name:result.name||name,
            fullPath:getListenDir(resolved)
        }
        return plugin
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
        for(const serviceName of Object.keys(this.options.services)){
            this.plugin(this.load(serviceName,this.options.services[serviceName]))
        }
        for(const pluginName of Object.keys(this.options.plugins)){
            this.plugin(this.load(pluginName),this.options.plugins[pluginName])
        }
        this.middleware(async (message,next)=>{
            const result=await this.executeCommand(message)
            if(result && typeof result!=='boolean') await message.reply(result)
            else next()
        })
        this.on('message',(event)=>{
            const middleware=this.compose()
            middleware(event)
        })
        this.client.login(this.options.password)
        this.emit('ready')
        this.isReady=true
    }
    stop(){
        this.dispose()
        process.exit()
    }
}
export interface Bot extends EventDeliver,Omit<Client, keyof EventDeliver>,Bot.Services{
    plugin(name:string):Plugin
    plugin<T>(plugin:Plugin,options?:T):this
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
    export interface Services{
        koa:Koa
    }
    export const defaultConfig:Partial<Options>={
        uin:1472558369,
        password: 'zhin.icu',
        plugins:{},
        services:{},
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
        services?:Record<string, any>
        plugin_dir?:string
    }
    export type ServiceConstructor<R,T=any>=new (bot:Bot,options?:T)=>R
    export type Dispose=()=>boolean
    export type Middleware = (event: MessageEvent, next: Next) => Awaitable<Sendable|boolean|void>;
    export type ComposedMiddleware = (event: MessageEvent, next?: Next) => Awaitable<Sendable|boolean|void>
    export type Next = () => Promise<any>;
    export type MessageEvent=PrivateMessageEvent|GroupMessageEvent|DiscussMessageEvent
}