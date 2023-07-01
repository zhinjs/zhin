import {deepEqual, Dict, isNullable} from "@zhinjs/shared";
import {Bot} from "./bot";
import {Zhin} from "./zhin";
import {Element} from '@/element'
import {Middleware} from "./middleware";
import {Prompt} from "./prompt";
import {Context} from "@/context";
import {Component} from "@/component";

export type FunctionPayloadWithSessionObj<E extends (...args: any[]) => any> = E extends (...args: infer R) => any ? ParametersToObj<R> : unknown
export type ParametersToObj<A extends any[]> = A extends [infer R, ...infer L] ? R extends object ? Partial<R> & { args: L } : { args: [R, ...L] } : Dict
export type NSession<P extends keyof Zhin.Adapters, E extends keyof Zhin.BotEventMaps[P] = keyof Zhin.BotEventMaps[P]> =
    Session<P>
    & (Zhin.BotEventMaps[P][E] extends (...args: any[]) => any ? FunctionPayloadWithSessionObj<Zhin.BotEventMaps[P][E]> : unknown)

export interface Session<P extends keyof Zhin.Adapters = keyof Zhin.Adapters, E extends keyof Zhin.BotEventMaps[P] = keyof Zhin.BotEventMaps[P]> {
    protocol: P,
    type?: string
    user_id?: string | number
    user_name?: string
    group_id?: string | number
    group_name?: string
    discuss_id?: string | number
    discuss_name?: string
    channel_id?: string
    channel_name?: string
    guild_id?: string
    guild_name?: string
    detail_type?: string
    zhin: Zhin
    context: Context
    adapter: Zhin.Adapters[P],
    prompt: Prompt
    content:string
    bot: Zhin.Bots[P]
    event: E
    quote?: QuoteMessage
    message_id?: string
}

export type QuoteMessage = {
    message_id: string
    user_id: string | number
    content: string
}

export class Session<P extends keyof Zhin.Adapters = keyof Zhin.Adapters, E extends keyof Zhin.BotEventMaps[P] = keyof Zhin.BotEventMaps[P]> {
    constructor(public adapter: Zhin.Adapters[P], self_id, public event: E, obj: object) {
        this.protocol = adapter.protocol as any
        this.zhin = adapter.zhin
        this.event = event
        this.bot = adapter.bots.get(self_id) as any
        Object.assign(this, obj)
        this.prompt = new Prompt(this.bot, this as any, this.zhin.options.delay.prompt)
    }

    get client() {
        return this.bot.internal
    }

    middleware(middleware: Middleware) {
        const fullId = Bot.getFullTargetId(this as any)
        return this.zhin.middleware(async (session, next) => {
            if (fullId && Bot.getFullTargetId(session) !== fullId) return next()
            return middleware(session, next)
        }, true)
    }

    match(context: Context) {
        return context.filter(this as any)
    }

    /**
     * 拦截接下来所有filter(默认当前发送消息的用户)筛选出来的session，执行传入的runFunc,直到满足free条件
     * @param tip  提示文本
     * @param runFunc {Function} 执行的函数
     * @param free {string|number|boolean|(session)=>boolean} 释放条件
     * @param filter {} 筛选哪些会话
     */
    intercept(tip: Element.Fragment, runFunc: (session: NSession<keyof Zhin.Adapters>) => Element.Fragment | void, free: Element.Fragment | ((session: NSession<keyof Zhin.Adapters>) => boolean), filter?: (session: NSession<keyof Zhin.Adapters>) => boolean) {
        if (!filter) filter = (session) => Bot.getFullTargetId(session) === Bot.getFullTargetId(this as any)
        this.reply(tip)
        const needFree = (session) => typeof free === "function" ? free(session) : deepEqual(session.content, Element.toElementArray(free).join(''))
        return new Promise<void>(resolve => {
            const dispose = this.zhin.middleware(async (session, next) => {
                if (!filter(session)) return next()
                if (needFree(session)) {
                    dispose()
                    cleanTimeout()
                    resolve()
                } else {
                    await runFunc(session)
                }
            })
            const cleanTimeout = this.context.setTimeout(() => {
                dispose()
                resolve()
            }, this.zhin.options.delay.prompt)
        })
    }
    get isMaster(){
        return this.bot.isMaster(this as NSession<P,E>)
    }
    get isAdmins(){
        return this.bot.isAdmins(this as NSession<P,E>)
    }
    get isAtMe(){
        return this.bot.isAtMe(this as NSession<P,E>)
    }
    get isGroup(){
        return !! this.group_id
    }
    get isPrivate(){
        return this.detail_type === 'private'
    }
    get isOwner(){
        return this.bot.isGroupOwner(this as NSession<P,E>)
    }
    get isAdmin(){
        return this.bot.isGroupAdmin(this as NSession<P,E>)
    }
    toString(){
        // 处理前缀
        let result=this.content||''
        // 有配置前缀，但是消息不是以前缀开头
        if(this.bot.options.prefix && !result.startsWith(this.bot.options.prefix)) return ''
        // 有配置前缀且消息以前缀开头，去掉前缀
        if(this.bot.options.prefix) result=result.slice(this.bot.options.prefix.length)
        return result
    }

    async execute(template=this.toString()): Promise<string|boolean|number> {
        const commands=this.zhin.getSupportCommands(this as NSession<P,E>)
        for(const command of commands){
            const result = await command.execute(this as any,template)
            if(result) return result
        }
        return template
    }

    async render<T extends Component.Runtime>(template: Element.Fragment = this.content, context?:T): Promise<Element[]> {
        if(!context) context=Zhin.createContext({
            session:this as any
        }) as T
        const components = this.zhin.getSupportComponents(this as NSession<P>)
        return await Element.renderAsync.apply(this,[template, components, context])
    }

    get [Symbol.unscopables]() {
        return {
            zhin: true,
            options: true,
            adapter: true,
            bot: true,
            plugin: true,
            context: true
        }
    }

    toJSON() {
        return Object.fromEntries(
            Object.keys(this).filter(key => {
                return !['zhin', 'adapter', 'bot'].includes(key) && typeof this[key] !== 'function'
            }).map(key => [key, this[key]])
        )
    }

    async reply(message: Element.Fragment) {
        return this.bot.reply(this as any, message, this.bot.options.quote_self)
    }
}

export namespace Session {
    export const checkProp = <K extends keyof Session>(key: K, ...values: Session[K][]) => {
        return ((session: Session) => values.length ? values.includes(session[key]) : !!session[key]) as Context.Filter
    }
}
