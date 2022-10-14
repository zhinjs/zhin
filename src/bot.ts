import EventDeliver from "event-deliver";
import {join,resolve} from 'path'
import {fork,ChildProcess} from "child_process";
import {Logger,getLogger,configure,Configuration} from "log4js";
import * as Yaml from 'js-yaml'
import * as path from 'path'
import * as fs from 'fs'
import {Client, Config as ClientConfig, Sendable} from "icqq";
import {Command, TriggerEventMap} from "@/command";
import {Argv} from "@/argv";
import {DiscussMessageEvent, EventMap, GroupMessageEvent, PrivateMessageEvent} from "icqq/lib/events";
import {deepClone, deepMerge, wrapExport,remove} from "@/utils";
import {Awaitable, Dict} from "@/types";
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
    startTime:number
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
        if(options.logConfig){
            configure(options.logConfig as Configuration)
        }
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
    static getChannelId(event:Dict){
        return [event.message_type,event.group_id||event.discuss_id||event.sender.user_id].join(':') as ChannelId
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
    get pluginList(){
        return [...this.plugins.values()].flat()
    }
    static getFullChannelId(event:Bot.MessageEvent):string{
        return [event.message_type,event['group_id'],event['discuss_id'],event['sub_type'],event.user_id]
            .filter(Boolean)
            .join(':')
    }
    plugin(name:string):Plugin|this
    plugin<T>(plugin:Plugin<T>,options?:T):this
    plugin<T>(entry:string|Plugin<T>,options?:T){
        let plugin:Plugin
        if(typeof entry==='string'){
            const result=this.plugins.get(entry)
            if(result) return result
            plugin=this.load(entry)
        }else{
            plugin=entry
        }
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
                            (plugin).disposes.push(()=>{
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
            plugin.dispose=function (){
                while (this.disposes.length){
                    const dispose=this.disposes.shift()
                    dispose()
                }
                plugin.disposes=[]
                return true
            }
            const installFunction= typeof plugin==="function"?plugin:plugin.install
            if(this.plugins.get(plugin.name)) {
                this.logger.warn('重复载入:'+plugin.name)
                return
            }
            const result=installFunction.apply(plugin,[proxy,options])
            if(typeof result==='function'){
                plugin.disposes.push(result)
            }
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
    command<T extends keyof TriggerEventMap,D extends string>(def: D,triggerEvent?:T): Command<T,Argv.ArgumentType<D>>{
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
    sendMsg(channelId: ChannelId, message: Sendable) {
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
            const dispatch= (i,event=message)=>{
                if (i <= index) return Promise.reject(new Error('next() called multiple times'))
                index = i
                let fn = middlewares[i]
                if (i === middlewares.length) fn = next
                if (!fn) return Promise.resolve()
                try {
                    return Promise.resolve(fn(event, dispatch.bind(null, i + 1)));
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
            author:JSON.stringify(result.author),
            version:result.version,
            desc:result.desc,
            using:result.using ||= [],
            name:result.name||name,
            fullName:result.fullName,
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
    async execute(argv:Partial<Argv>){
        if(!argv.client)argv.client=this.client
        if(!argv.args)argv.args=[]
        if(!argv.argv)argv.argv=[]
        if(!argv.cqCode) argv.cqCode=argv.event.toCqcode()
        if(!argv.options) argv.options={}
        const command=this.findCommand(argv as Argv)
        if(command && command.match(argv.event)){
            let result:Sendable|void|boolean
            result= await this.bailSync('before-command',argv)
            if (result) return result
            try{
                return await command.execute(argv as Argv)
            }catch (e){
                this.logger.warn(e.message)
            }
        }
    }
    async executeCommand(message:Bot.MessageEvent,cqCode=message.toCqcode()):Promise<Sendable|boolean|void>{
        const argv=Argv.parse(cqCode)
        argv.event=message
        return this.execute(argv)
    }
    async start(){
        for(const serviceName of Object.keys(this.options.services)){
            this.plugin(this.load(serviceName,this.options.services[serviceName]))
        }
        for(const pluginName of Object.keys(this.options.plugins)){
            this.plugin(this.load(pluginName),this.options.plugins[pluginName])
        }
        this.middleware(async (message,next)=>{
            const result=await this.executeCommand(message).catch(e=>e.message as string)
            if(result && typeof result!=='boolean') await message.reply(result)
            else next()
        })
        this.on('message',(event)=>{
            const middleware=this.compose()
            middleware(event)
        })
        await this.client.login(this.options.password)
        await this.emitAsync('ready')
        this.isReady=true
        await this.emitAsync('start')
        this.startTime=new Date().getTime()
    }
    private getAllChannels():ChannelId[]{
        return [...this.gl.keys()].map(gid=>`group:${gid}`)
            .concat(...[...this.fl.keys()].map(uid=>`private:${uid}`)) as ChannelId[]
    }
    broadcast(channelIds:ChannelId[],content:string)
    broadcast(content:string)
    broadcast(...args:[ChannelId[],string]|[string]){
        const channelIds=args.length===1?this.getAllChannels():args[0]
        const content=args.length===1?args[0]:args[1]
        return Promise.all(channelIds.map(async (channelId)=>{
            const {message_id}=await this.sendMsg(channelId,content)
            return message_id
        }))
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
    emitAsync<T extends keyof Bot.AllEventMap<this>>(event: T, ...args:Parameters<Bot.AllEventMap<this>[T]>):Promise<void>;
    emitAsync<S extends string | symbol>(event: S & Exclude<S, keyof Bot.AllEventMap<this>>, ...args:any[]):Promise<void>;
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
        log_level:'info',
        services:{},
        delay:{},
        logConfig:{
            appenders: {
                console:{type:'console'},
                zhin: {
                    type:'file',
                    filename:path.join(process.cwd(),'logs.log')
                }
            },
            categories:{
                default:{
                    appenders:['console'],
                    level:'error'
                },
                zhin:{
                    appenders:['console','zhin'],
                    level:'info'
                }
            }
        },
        plugin_dir:path.join(process.cwd(),'plugins'),
        data_dir:path.join(process.cwd(),'data')
    }
    type BeforeEventMap<T>={
        [P in keyof EventMap as `before-${P}`]:EventMap[P]
    } & BeforeLifeCycle

    type AfterEventMap<T>={
        [P in keyof EventMap as `after-${P}`]:EventMap[P]
    } & AfterLifeCycle
    type BeforeLifeCycle={
        [P in keyof LifeCycle as `before-${P}`]:LifeCycle[P]
    }
    type AfterLifeCycle={
        [P in keyof LifeCycle as `after-${P}`]:LifeCycle[P]
    }
    export interface LifeCycle{
        start():void
        'ready'():void
        'dispose'():void
        'command-add'(command:Command):void
        'command-remove'(command:Command):void
        'plugin-add'(plugin:Plugin):void
        'plugin-remove'(plugin:Plugin):void
    }
    export interface BotEventMap<T> extends EventMap,LifeCycle{
    }
    export interface AllEventMap<T> extends BeforeEventMap<T>,AfterEventMap<T>,BotEventMap<T>{}
    export interface Options extends ClientConfig{
        uin:number
        password?:string
        master?:number
        admins?:number|number[]
        logConfig?:Partial<Configuration>
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