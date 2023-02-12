import {Dict,isNullable} from "@zhinjs/shared";
import {Bot} from "./bot";
import {Zhin} from "./zhin";
import {Argv} from "./argv";
import {Element} from '@/element'
import {Middleware} from "./middleware";
import {Prompt} from "./prompt";

export type FunctionPayloadWithSessionObj<E extends (...args: any[]) => any> = E extends (...args: infer R) => any ? ParametersToObj<R> : unknown
export type ParametersToObj<A extends any[]> = A extends [infer R, ...infer L] ? R & R extends object ? R & { args: L } : { args: [R, ...L] } : Dict
export type NSession<P extends keyof Zhin.Adapters,E extends keyof Zhin.BotEventMaps[P]=keyof Zhin.BotEventMaps[P]>=Session<P> & (Zhin.BotEventMaps[P][E] extends (...args: any[]) => any?FunctionPayloadWithSessionObj<Zhin.BotEventMaps[P][E]>:unknown)
export interface Session<P extends keyof Zhin.Adapters = keyof Zhin.Adapters,E extends keyof Zhin.BotEventMaps[P]=keyof Zhin.BotEventMaps[P]> {
    protocol: P,
    type?: string
    user_id?: string | number
    group_id?: string | number
    discuss_id?: string | number
    channel_id?: string | number
    guild_id?: string | number
    detail_type?: string
    app: Zhin
    prompt: Prompt
    elements: Element[]
    adapter: Zhin.Adapters[P],
    bot: Zhin.Bots[P]
    event: E
    quote?:QuoteMessage
    message_id?: string
}
export type QuoteMessage={
    message_id:string
    element:Element[]
}

export class Session<P extends keyof Zhin.Adapters = keyof Zhin.Adapters,E extends keyof Zhin.BotEventMaps[P]=keyof Zhin.BotEventMaps[P]> {
    constructor(public adapter: Zhin.Adapters[P], self_id, public event: E, obj: object) {
        this.protocol = adapter.protocol as any
        this.app = adapter.app
        this.event = event
        this.bot = adapter.bots.get(self_id) as any
        Object.assign(this, obj)
        this.prompt = new Prompt(this.bot, this as any, this.app.options.delay.prompt)
    }

    middleware(middleware: Middleware) {
        const fullId = Bot.getFullTargetId(this as any)
        return this.app.middleware(async (session, next) => {
            if (fullId && Bot.getFullTargetId(session) !== fullId) return next()
            return middleware(session, next)
        }, true)
    }

    isAtMe() {
        return this.elements.length && this.elements[0].type === 'mention' && String(this.elements[0].attrs['user_id']) === String(this.bot.self_id)
    }

    async nextArgv() {
        return new Promise<void | Argv>(resolve => {
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
            }, this.app.options.delay.prompt)
        })
    }

    async execute(argv: Element[] | Argv = this.elements) {
        if (Array.isArray(argv)) {
            let data = Argv.parse<P,E>(argv, this)
            if (!data) return
            argv = data
        }
        if (argv.atMe && !argv.name) {
            await this.reply('嗯哼？')
            const data = await this.nextArgv()
            if (!data) return
            argv = data
        }
        const command = this.app.findCommand(argv)
        if (!command) return
        const result = await command.execute(argv)
        if (!result || typeof result === 'boolean') return
        if (Array.isArray(result) && !result.length) return
        return result
    }

    async render(elements: Element[] = this.elements): Promise<Element[]> {
        const components=this.app.getSupportComponents(this as NSession<P>)
        return await Element.transformAsync(elements, components, Zhin.createContext(this))
    }

    get [Symbol.unscopables]() {
        return {
            app: true,
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
                return !['app', 'adapter', 'bot'].includes(key) && typeof this[key] !== 'function'
            }).map(key => [key, this[key]])
        )
    }

    async reply(message: Element.Fragment) {
        return this.bot.reply(this as any, message, this.bot.options.quote_self)
    }
}
