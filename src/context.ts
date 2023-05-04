import {isBailed, remove, Dict} from "@zhinjs/shared";
import {Zhin, isConstructor, ChannelId} from "./zhin";
import {JobCallback, RecurrenceRule, RecurrenceSpecDateRange, RecurrenceSpecObjLit, scheduleJob} from 'node-schedule'
import {Dispose} from "./dispose";
import {Adapter, AdapterConstructs, AdapterOptions, AdapterOptionsType} from "./adapter";
import {Middleware} from "./middleware";
import {Command, TriggerSessionMap} from "./command";
import {NSession, Session} from "./session";
import {Element} from './element'
import {EventEmitter} from "events";
import {Argv} from "./argv";
import {Plugin} from "@/plugin";
import {Component} from "./component";
import {Logger} from "log4js";
import {Bot} from "./bot";
export class Context extends EventEmitter {
    /**
     * zhin实体
     */
    zhin: Zhin
    /**
     * 当前上下文产生的插件
     */
    plugins: Map<string, Plugin> = new Map<string, Plugin>()
    /**
     * 当前上下文产生的中间件
     */
    middlewares: Middleware[] = []
    /**
     * 当前上下文产生的组件
     */
    components: Dict<Component> = Object.create(null)
    /**
     * 当前上下文产生的指令
     */
    commands: Map<string, Command> = new Map<string, Command>();
    /**
     * 卸载当前上下文需要执行的函数集合
     */
    public readonly disposes: Dispose[] = []

    constructor(public parent: Context, public filter: Context.Filter = parent?.filter || Context.defaultFilter) {
        super()
        this[Context.childKey] = []
        this[Context.plugin] = null
        if (!parent) return
        parent[Context.childKey].push(this)
        this.on('dispose', () => {
            remove(this.parent[Context.childKey], this)
        })
        this.zhin = parent.zhin
        this.logger = parent.logger
        return new Proxy(this, {
            get(target: Context, p: string | symbol, receiver: any): any {
                if (target.zhin.services.has(p as keyof Zhin.Services)) return target.zhin.services.get(p as keyof Zhin.Services)
                return Reflect.get(target, p, receiver)
            }
        })
    }

    /**
     * 上下文继承
     * @param ctx
     */
    extend(ctx: Partial<Context>) {
        Object.assign(this, ctx)
        return this
    }

    /**
     * 选择values包含会话中指定key值的上下文
     * @param key session的key
     * @param values 对应key可以为哪些值
     */
    pick<K extends keyof Session>(key: K, ...values: Session[K][]) {
        return Context.from(this, Context.withFilter(this, Session.checkProp(key, ...values)))
    }

    /**
     * 联合某一条件的上下文
     * @param filter 过滤器
     */
    union(filter: Context.Filter) {
        return Context.from(this, Context.union(this, filter))
    }

    /**
     * 排除某一条件的上下文
     * @param filter 过滤器
     */
    except(filter: Context.Filter) {
        return Context.from(this, Context.except(this, filter))
    }

    /**
     * 筛选带用户id的上下文
     * @param user_ids 用户id数组
     */
    user(...user_ids: (string | number)[]) {
        return this.pick('user_id', ...user_ids)
    }

    /**
     * 筛选群聊上下文
     * @param group_ids 群id数组
     */
    group(...group_ids: (string | number)[]) {
        return this.pick('group_id', ...group_ids)
    }

    /**
     * 筛选讨论组上下文
     * @param discuss_ids 讨论组id数组
     */
    discuss(...discuss_ids: (string | number)[]) {
        return this.pick('discuss_id', ...discuss_ids)
    }

    /**
     * 筛选频道上下文
     * @param guild_ids 频道id数组
     */
    guild(...guild_ids: string[]) {
        return this.pick('guild_id', ...guild_ids)
    }

    /**
     * 筛选子频道上下文
     * @param channel_ids 自频道id数组
     */
    channel(...channel_ids: string[]) {
        return this.pick('channel_id', ...channel_ids)
    }

    /**
     * 筛选指定平台的上下文
     * @param platforms 平台类型数组
     */
    platform(...platforms: (keyof Zhin.Adapters)[]) {
        return this.pick('protocol', ...platforms)
    }

    /**
     * 筛选私聊上下文
     * @param user_ids 用户id数组
     */
    private(...user_ids: (string | number)[]) {
        return this.pick('detail_type', 'private').pick('user_id', ...user_ids)
    }

    /**
     * zhin日志记录器
     */
    public logger: Logger

    /**
     * 获取当前上下文所有插件
     */
    get pluginList(): Plugin[] {
        const result = [...this.plugins.values()].reduce((result, plugin) => {
            if (plugin.context !== this) result.push(...plugin.context.pluginList)
            return result
        }, [...this.plugins.values()])
        return result
    }

    /**
     * 根据会话获取匹配的上下文
     * @param session 会话实体
     */
    getMatchedContextList<P extends keyof Zhin.Adapters>(session: NSession<P>): Context[] {
        return this[Context.childKey].reduce((result, ctx) => {
            if(session.match(ctx)) result.push(ctx,...ctx.getMatchedContextList(session))
            return result
        }, [...this.plugins.values()].map(p => p.context)).filter((ctx) => {
            if (!ctx[Context.plugin]) return session.match(ctx)
            const plugin = ctx[Context.plugin]
            return session.match(ctx) && plugin.status && session.bot.match(plugin) && plugin.match(session)
        })
    }

    /**
     * 为当前上下文添加插件
     * @param name 插件名
     * @param setup 是否setup插件
     */
    plugin(name: string, setup?: boolean): Plugin | this
    /**
     * 为当前上下文添加插件
     * @param plugin 插件安装配置对象
     */
    plugin<P extends Plugin.Install>(plugin: P): this
    plugin<P extends Plugin.Install>(entry: string | P, setup?: boolean) {
        let options: Plugin.Options
        if (typeof entry === 'string') {
            const result = this.plugins.get(entry)
            if (result) return result
            options = this.zhin.load(entry, 'plugin', setup)
        } else {
            options = Plugin.defineOptions(entry)
        }
        const info: Plugin.Info = Plugin.getInfo(options.fullPath)
        const installPlugin = () => {
            const context = new Context(this)
            const plugin = new Plugin(options, info)
            if (this.plugins.get(options.fullName)) {
                this.zhin.logger.warn('重复载入:' + options.name)
                return
            }
            this.plugins.set(options.fullName, plugin)
            plugin.mount(context)
            this.zhin.logger.info(`已载入插件:${options.name}`)
            this.zhin.emit('plugin-add', plugin)
        }
        const using = options.using ||= []
        installPlugin()
        if (!using.length) {
            if (using.some(name => !this.zhin.services.has(name))) {
                this.zhin.logger.info(`插件(${options.name})所需服务(${using.join()})未就绪，已停用`);
                (this.plugin(options.fullName) as Plugin).disable()
            }
        }
        return this
    }

    /**
     * 为当前上下文添加插件
     * @param plugin 插件安装配置对象
     */
    use<P extends Plugin.Install>(plugin: P): this {
        this.plugin(plugin)
        return this
    }

    // 获取当前上下文所有中间件
    get middlewareList() {
        const result = [...this.plugins.values()].reduce((result, plugin) => {
            if (plugin.context !== this) result.push(...plugin.context.middlewareList)
            return result
        }, [...this.middlewares])
        if (this[Context.childKey]) {
            result.push(...this[Context.childKey].map(ctx => ctx.middlewareList).flat())
        }
        return result
    }

    /**
     * 为当前上下文添加中间件
     * @param middleware 中间件
     * @param prepend 是否插入到最前端
     */
    middleware(middleware: Middleware, prepend?: boolean) {
        const method: 'push' | 'unshift' = prepend ? 'unshift' : "push"
        this.middlewares[method](middleware)
        return Dispose.from(this, () => {
            return remove(this.middlewares, middleware);
        })
    }

    /**
     * 获取当前上下文所有组件
     */
    get componentList(): Dict<Component> {
        const result = [...this.plugins.values()].reduce((result, plugin) => {
            if (plugin.context !== this) Object.assign(result, plugin.context.componentList)
            return result
        }, {...this.components})
        if (this[Context.childKey]) {
            this[Context.childKey].map(ctx => {
                Object.assign(result, ctx.componentList)
            })
        }
        return result
    }

    /**
     * 为当前上下文添加组件
     * @param name 组件名(需确保唯一性)
     * @param component 添加的组件
     * @param options 组件配置项，仅在组件为纯函数时有效
     */
    component(name: string, component: Component) {
        this.components[name] = component
        return Dispose.from(this, () => {
            delete this.components[name]
        })
    }

    /**
     * 添加定时任务
     */
    schedule(rule:RecurrenceRule | RecurrenceSpecDateRange | RecurrenceSpecObjLit | Date | string | number,callback:JobCallback){
        const job=scheduleJob(rule,callback)
        const dispose=Dispose.from(this,()=>{
            job.cancel()
            remove(this.disposes,dispose)
        })
        this.disposes.push(dispose)
        return dispose
    }
    /**
     * 获取当前上下文所有指令
     */
    get commandList(): Command[] {
        const result = [...this.plugins.values()].reduce((result, plugin) => {
            if (plugin.context !== this) result.push(...plugin.context.commandList)
            return result
        }, [...this.commands.values()])
        if (this[Context.childKey]) {
            result.push(...this[Context.childKey].map(ctx => ctx.commandList).flat())
        }
        return result
    }

    /**
     * 为当前上下文添加指令
     * @param def 组件创建字面量
     * @param trigger 触发环境（group:群聊 private:私聊 discuss:讨论组 guild:频道）不传则所有会话
     */
    command<D extends string, T extends keyof TriggerSessionMap>(def: D, trigger?: T): Command<Argv.ArgumentType<D>, {},any, T> {
        const namePath = def.split(' ', 1)[0]
        const decl = def.slice(namePath.length)
        const elements = namePath.split(/(?=[/])/g)

        let parent: Command, nameArr = []
        while (elements.length) {
            const segment = elements.shift()
            const code = segment.charCodeAt(0)
            const tempName = code === 47 ? segment.slice(1) : segment
            nameArr.push(tempName)
            if (elements.length) parent = this.zhin.commandList.find(cmd => cmd.name === tempName)
            if (!parent && elements.length) throw Error(`cannot find parent command:${nameArr.join('.')}`)
        }
        const name = nameArr.pop()
        const command = new Command(name + decl)
        command.fullName=namePath
        command.trigger = trigger
        command.context = this
        if (parent) {
            command.parent = parent
            parent.children.push(command)
        }
        this.commands.set(name, command)
        this.zhin.emit('command-add', command, this)
        this.disposes.push(() => {
            this.commands.delete(name)
            this.zhin.emit('command-remove', command, this)
        })
        return command as Command<Argv.ArgumentType<D>, {},any, T>
    }

    /**
     * 监听事件
     * @param event 事件名
     * @param listener 回调函数
     */
    on(event, listener) {
        super.on(event, listener)
        const dispose = Dispose.from(this, () => {
            super.off(event, listener)
            remove(this.disposes, dispose)
        })
        this.disposes.push(dispose)
        return dispose
    }

    /**
     * 往下级插件抛会话，普通开发者用不上
     */
    dispatch<P extends keyof Zhin.Adapters, E extends keyof Zhin.BotEventMaps[P]>(protocol: P, eventName: E, session: NSession<P, E>) {
        session.context = this
        if (session.match(this)) {
            this.emit(`${protocol}.${String(eventName)}`, session)
            for (const context of this[Context.childKey]) {
                context.dispatch(protocol, eventName, session)
            }
        }
    }

    /**
     * 为zhin添加适配器，若已安装，则直接返回该服务，若未安装，会自动查询本地模块中`@zhinjs/adapter-${adapter}`。
     * @param adapter 适配平台
     */
    adapter<K extends keyof Zhin.Adapters>(adapter: K): Zhin.Adapters[K]
    /**
     * 为zhin添加适配器，若已安装，则直接返回该服务，若未安装，会自动查询本地模块中`@zhinjs/adapter-${adapter}`。
     * @param adapter 适配平台
     * @param options 初始化适配器时的配置
     */
    adapter<K extends keyof Zhin.Adapters>(adapter: K, options: AdapterOptionsType<Zhin.Adapters[K]>): this
    /**
     * 为zhin添加适配器
     * @param adapter 适配平台
     * @param construct 适配器构造函数
     * @param options 初始化适配器时的配置
     */
    adapter<K extends keyof Zhin.Adapters>(adapter: K, construct: AdapterConstructs[K], options: AdapterOptionsType<Zhin.Adapters[K]>): this
    adapter<K extends keyof Zhin.Adapters>(adapter: K, Construct?: AdapterConstructs[K] | AdapterOptions, options?: AdapterOptions) {
        if (!Construct && !options) return this.zhin.adapters.get(adapter)
        if (typeof Construct !== "function") {
            const result = this.zhin.load(adapter, 'adapter', false)
            if (result && result.install) {
                result.install(this, options)
            }
            options = Construct as AdapterOptions
            Construct = Adapter.get(adapter).Adapter
        }
        if (!Construct) throw new Error(`can't find adapter for protocol:${adapter}`)
        const dispose = this.zhin.on(`${adapter}.message`, (session) => {
            this.zhin.emitSync('message', session)
        })
        this.zhin.adapters.set(adapter, new Construct(this.zhin, adapter, options) as any)
        return Dispose.from(this, () => {
            dispose()
            this.zhin.adapters.delete(adapter)
        }) as any
    }

    /**
     * 为zhin添加服务，若已安装，则直接返回该服务，若未安装，会自动查询本地模块中`@zhinjs/service-${key}`。
     * @param key 服务名
     */
    service<K extends keyof Zhin.Services>(key: K): Zhin.Services[K]
    /**
     * 为zhin添加服务
     * @param key 服务名
     * @param service 服务实体
     */
    service<K extends keyof Zhin.Services>(key: K, service: Zhin.Services[K]): this
    /**
     * 为zhin添加服务
     * @param key 服务名
     * @param constructor 服务构造函数
     * @param options 初始化服务时的配置
     */
    service<K extends keyof Zhin.Services, T>(key: K, constructor: Zhin.ServiceConstructor<Zhin.Services[K], T>, options?: T): this
    service<K extends keyof Zhin.Services, T>(key: K, Service?: Zhin.Services[K] | Zhin.ServiceConstructor<Zhin.Services[K], T>, options?: T): Zhin.Services[K] | this {
        if (Service === undefined) {
            if (this.zhin.services.get(key)) return this.zhin.services.get(key)
            Service = this.zhin.load(key, 'service', false) as Zhin.Services[K] | Zhin.ServiceConstructor<Zhin.Services[K], T>
        }
        if (this.zhin[key]) throw new Error('服务key不能和bot已有属性重复')
        if (this.zhin.services.has(key)) throw new Error('重复定义服务')
        if (isConstructor(Service)) {
            this.zhin.services.set(key, new Service(this, options))
        } else {
            this.zhin.services.set(key, Service)
        }
        this.zhin.logger.info(`已挂载服务(${key})`)
        this.zhin.emit('service-add', key)
        const dispose = Dispose.from(this, () => {
            this.zhin.logger.info(`已卸载服务(${key})`)
            this.zhin.services.delete(key)
            this.zhin.emit('service-remove', key)
            remove(this.disposes, dispose)
        })
        this.disposes.push(dispose)
        return dispose
    }

    /**
     * 定义原生setTimeout
     * @param callback 同原生setTimeout入参
     * @param ms 同原生setTimeout入参
     * @param args 同原生setTimeout入参
     */
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

    /**
     * 定义原生setInterval
     * @param callback 同原生setInterval入参
     * @param ms 同原生setInterval入参
     * @param args 同原生setInterval入参
     */
    setInterval(callback: Function, ms: number, ...args) {
        const timer = setInterval(callback, ms, ...args)
        const dispose = Dispose.from(this, () => clearInterval(timer))
        this.disposes.push(dispose)
        return dispose
    }

    /**
     * 向指定通道发送消息
     * @param channel {import('zhin').Context.MsgChannel} 通道信息
     * @param msg {import('zhin').Element.Fragment} 消息内容
     */
    sendMsg(channel:Context.MsgChannel,msg:Element.Fragment){
        const {protocol,bot_id,target_id,target_type}=channel
        return this.zhin.pickBot(protocol,bot_id)
            .sendMsg(target_id,target_type,msg)
    }
    /**
     * 广播一条消息
     * @param channelIds 消息的通道id数组
     * @param content 群发的内容
     */
    broadcast(channelIds: ChannelId | ChannelId[], content: Element.Fragment) {
        channelIds = [].concat(channelIds)
        return Promise.all(channelIds.map(channelId => {
            const [protocol, self_id, target_type = protocol, target_id = self_id] = channelId.split(':')
            const bots:Bot[] = [...this.zhin.adapters.values()].reduce((result, adapter) => {
                if (protocol === target_type) result.push(...adapter.bots)
                else if (protocol === adapter.protocol) result.push(...(adapter.bots.filter(bot => bot.self_id === self_id)))
                return result
            }, [] as Bot[])
            return bots.map((bot) => bot.sendMsg(Number(target_id), <"private" | "group" | "discuss" | "guild">target_type, content))
        }).flat())
    }

    /**
     * 执行某一event的所有listener，并获取其返回值
     * @param event 事件名
     * @param args 传递给其listener的参数
     */
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

    /**
     * 同步执行某一event的所有listener，并获取其返回值
     * @param event 事件名
     * @param args 传递给其listener的参数
     */
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

    /**
     * 销毁指定上下文，如不传入插件，则销毁当前上下文，若传入插件，则销毁指定插件的上下文
     * @param plugin
     */
    dispose(plugin?: Plugin | string) {
        if (plugin) {
            if (typeof plugin === 'string') plugin = this.pluginList.find(p => p.name === plugin)
            if (plugin) {
                plugin.unmount()
                this.plugins.delete(plugin.options.fullName)
            }
            return
        }
        [...this.plugins.values()].forEach(plugin => {
            plugin.unmount()
            this.plugins.delete(plugin.options.fullName)
        })
        this.emit('dispose')
        while (this.disposes.length) {
            const dispose = this.disposes.shift()
            try {
                dispose()
            } catch {
            }
        }
    }

    /**
     * 获得会话匹配的所有可用的组件
     * @param session 会话
     */
    getSupportComponents<P extends keyof Zhin.Adapters>(session: NSession<P>) {
        return this.getMatchedContextList(session).reduce((result: Dict<Component>, context) => {
            Object.assign(result, {...context.components})
            return result
        }, {...this.components})
    }

    /**
     * 获得会话匹配的所有可用的中间件
     * @param session 会话
     */
    getSupportMiddlewares<P extends keyof Zhin.Adapters>(session: NSession<P>) {
        return this.getMatchedContextList(session).reduce((result: Middleware[], context) => {
            for(const middleware of context.middlewares){
                if(!result.includes(middleware)) result.push(middleware)
            }
            return result
        }, [...this.middlewares])
    }

    /**
     * 获得会话匹配的所有可用的指令
     * @param session 会话
     */
    getSupportCommands<P extends keyof Zhin.Adapters>(session: NSession<P>) {
        return this.getMatchedContextList(session).reduce((result: Command[], context) => {
            for (const command of context.commands.values()) {
                if (command.match(session as any) && !result.includes(command)) {
                    result.push(command)
                }
            }
            return result
        }, [...this.commands.values()]) as Command<any[],{},P,keyof TriggerSessionMap<P>>[]
    }
}

export interface Context extends Zhin.Services {
    [Context.childKey]: Context[]
    [Context.plugin]: Plugin

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

    component(name: string, component: Component): this
}

export namespace Context {
    export const plugin = Symbol('plugin')
    export const childKey = Symbol('children')

    export type MsgChannel={
        protocol:keyof Zhin.Adapters
        bot_id:string|number
        target_id:string|number
        target_type:'private'|'group'|'discuss'|'guild'
    }
    export function from(parent: Context, filter: Filter) {
        const ctx = new Context(parent, filter)
        ctx[plugin] = parent ? parent[plugin] : null
        return ctx
    }

    export type Filter = (session: Session) => boolean
    export const defaultFilter: Filter = () => true
    export const union = (ctx: Context, filter: Filter) => {
        return ((session: Session) => ctx.filter(session) || filter(session)) as Filter
    }
    export const except = (ctx: Context, filter: Filter) => {
        return ((session: Session) => ctx.filter(session) && !filter(session)) as Filter
    }
    export const withFilter = (ctx: Context, filter: Filter) => {
        return ((session: Session) => ctx.filter(session) && filter(session)) as Filter
    }
}