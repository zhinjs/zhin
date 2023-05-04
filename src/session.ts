import {deepEqual, Dict, isNullable} from "@zhinjs/shared";
import {Bot} from "./bot";
import {Zhin} from "./zhin";
import {Argv} from "./argv";
import {Element} from '@/element'
import {Middleware} from "./middleware";
import {Prompt} from "./prompt";
import {Context} from "@/context";
import {TriggerSessionMap} from "@/command";

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
    elements: Element[]
    bot: Zhin.Bots[P]
    event: E
    quote?: QuoteMessage
    message_id?: string
}

export type QuoteMessage = {
    message_id: string
    user_id: string | number
    element: Element[]
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

    waitReply<K extends keyof Zhin.Adapters, E extends keyof Zhin.BotEventMaps[K]>(message_id: string, timeout?: number) {
        return new Promise<NSession<K, E>>(resolve => {
            const timer = timeout && setTimeout(() => {
                resolve(null)
                dispose()
            })
            const dispose = this.zhin.middleware(async (session, next) => {
                if (!session.quote || session.quote.message_id !== message_id) return next()
                dispose()
                timer && clearTimeout(timeout)
                resolve(session as NSession<K, E>)
            })
        })
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
        const needFree = (session) => typeof free === "function" ? free(session) : deepEqual(session.elements?.join(''), Element.toElementArray(free).join(''))
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

    isAtMe() {
        return this.elements?.length && this.elements[0].type === 'mention' && String(this.elements[0].attrs['user_id']) === String(this.bot.self_id)
    }

    async nextArgv() {
        return new Promise<void | Argv<any,any,P,keyof TriggerSessionMap<P>>>(resolve => {
            const dispose = this.middleware(async (session, next) => {
                clearTimeout(timer)
                dispose()
                const value = Argv.parse(session.elements, this)
                resolve(value)
                if (isNullable(value)) return next()
            })
            const timer = setTimeout(() => {
                dispose()
                resolve()
            }, this.zhin.options.delay.prompt)
        })
    }

    async execute(argv: Element[] | Argv = this.elements): Promise<Element.Fragment> {
        if (Array.isArray(argv)) {
            let data = Argv.parse<P, E>(argv, this)
            if (!data) return
            argv = data
        }
        if (argv.atMe && !argv.name) {
            await this.reply('嗯哼？')
            const data = await this.nextArgv()
            if (!data) return
            argv = data
        }
        const command = this.zhin.findCommand(argv)
        if (!command) return false
        const result = await command.execute(argv)
        if (!result || typeof result === 'boolean') return false
        if (Array.isArray(result) && !result.length) return false
        return result
    }

    async render(elements: Element.Fragment = this.elements, context = Zhin.createContext(this)): Promise<Element[]> {
        const components = this.zhin.getSupportComponents(this as NSession<P>)
        return await Element.renderAsync(elements, components, context)
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
