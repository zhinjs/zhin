import {Zhin} from "./zhin";
import {Adapter} from "./adapter";
import {Plugin} from "./plugin";
import {NSession} from "./session";
import {deepMerge, remove, sleep} from '@zhinjs/shared'
import {EventEmitter} from "events";
import {Element} from "./element";
import {ref, watch} from "obj-observer";

export type BotOptions<O = {}> = {
    quote_self?: boolean
    self_id?: string | number
    prefix?: string
    enable?: boolean
    text_limit?: number
    rate_limit?: number
    master?: string | number
    disable_plugins?: string[]
    admins?: (string | number)[]
} & O

export class Bot<K extends keyof Zhin.Adapters = keyof Zhin.Adapters, BO = {}, AO = {}, I = object> extends EventEmitter {
    public internal: I
    private task: {
        isRunning: boolean
        queue: Function[]
    } = {isRunning: false, queue: []}
    public options: BotOptions<BO>

    constructor(public zhin: Zhin, public adapter: Adapter<K, BO, AO>, options: BotOptions<BO>) {
        super();
        this.options = ref(deepMerge(Bot.defaultOptions, options))
        this.on('message', (message: Bot.MessageRet) => {
            this.adapter.emit('message.receive', this.self_id, message)
        })
        watch(this.options, (value: BotOptions<BO>) => {
            this.adapter.changeOptions(this.self_id, value)
        })
    }

    get status() {
        return this.adapter.botStatus(this.self_id)
    }

    isOnline() {
        return this.status.online === true
    }

    private async runQueue() {
        if (this.task.isRunning) return
        this.task.isRunning = true
        while (this.task.queue.length) {
            const task = this.task.queue.shift()
            await task()
            if (this.options.rate_limit) {
                await sleep(this.options.rate_limit)
            }
        }
        this.task.isRunning = false
    }

    sendQueueMsg(target_id: string | number, target_type: Bot.MessageType, message: Element.Fragment) {
        return new Promise<Bot.MessageRet|null>((resolve) => {
            this.task.queue.push(async () => {
                try{
                    resolve(await this.sendMsg(target_id, target_type, message))
                }catch {
                    this.zhin.logger.error(`Bot(${this.self_id})消息发送失败`)
                    resolve(null)
                }
            })
            this.runQueue()
        })
    }

    enable(): boolean
    enable(plugin: Plugin): this
    enable(plugin?: Plugin): this | boolean {
        if (!plugin) return this.options.enable = true
        if (!this.options.disable_plugins.includes(plugin.options.fullName)) {
            this.zhin.logger.warn(`Bot(${this.self_id})插件未被禁用:${plugin.name}`)
            return this
        }
        remove(this.options.disable_plugins, plugin.options.fullName)
        return this
    }

    disable(): boolean
    disable(plugin: Plugin): this
    disable(plugin?: Plugin): this | boolean {
        if (!plugin) return this.options.enable = false
        if (!this.options.disable_plugins.includes(plugin.options.fullName)) {
            this.zhin.logger.warn(`Bot(${this.self_id})重复禁用插件:${plugin.name}`)
            return this
        }
        this.options.disable_plugins.push(plugin.options.fullName)
        return this
    }

    // 机器人是否启用指定插件
    match(plugin: Plugin) {
        return !this.options.disable_plugins.includes(plugin.options.fullName)
    }

    // 会话发起者是否为zhin主人
    isMaster<P extends keyof Zhin.Adapters, E extends keyof Zhin.BotEventMaps[P] = keyof Zhin.BotEventMaps[P]>(session: NSession<P, E>) {
        return this.options.master === session.user_id
    }

    // 会话发起者是否为zhin管理员
    isAdmins<P extends keyof Zhin.Adapters, E extends keyof Zhin.BotEventMaps[P] = keyof Zhin.BotEventMaps[P]>(session: NSession<P, E>) {
        return this.options.admins && this.options.admins.includes(session.user_id)
    }

    async reply(session: NSession<K>, message: Element.Fragment, quote?: boolean) {
        if (session.type !== 'message') throw new Error(`property 'reply' is only available for message event`)
        message = await session.render(message)
        const replyElem: Element | undefined = quote ? Element('reply', {message_id: session.message_id}) : undefined
        if (replyElem) message.unshift(replyElem)
        const calcLen=(message:Element.Fragment)=>{
            return [].concat(message).filter(m => typeof m !== 'object' || m.type === 'text').reduce((r: number, c: Element<'text'>|string|number|boolean) =>{
                if(typeof c !=="object") r+=String(c).length
                else r+=(c.attrs.text?.length||0)
                return r
            }, 0) as number
        }
        const textLen = calcLen(message)
        if (textLen > this.options.text_limit) message = [
            Element('node', {user_id: this.self_id as string,children:message})
        ]
        return this.sendQueueMsg(session.group_id || session.discuss_id || session.user_id || `${session.guild_id}:${session.channel_id}`, session.detail_type as Bot.MessageType, message)
    }
}

export interface Bot<K extends keyof Zhin.Bots = keyof Zhin.Bots, BO = {}, AO = {}, I = object> {
    self_id: string | number
    options: BotOptions<BO>
    adapter: Adapter<K, BO, AO>
    zhin: Zhin

    sendMsg(target_id: string | number, target_type: Bot.MessageType, message: Element.Fragment): Promise<Bot.MessageRet>

    getMsg(message_id: string): Promise<Bot.Message>

    deleteMsg(message_id: string): Promise<boolean>

    createSession(event: string, ...args: any[]): NSession<K>

    // 会话发起者是否为群管理员
    isGroupAdmin?<P extends keyof Zhin.Adapters, E extends keyof Zhin.BotEventMaps[P] = keyof Zhin.BotEventMaps[P]>(session: NSession<P, E>): boolean

    // 会话发起者是否为频道管理员
    isChannelAdmin?<P extends keyof Zhin.Adapters, E extends keyof Zhin.BotEventMaps[P] = keyof Zhin.BotEventMaps[P]>(session: NSession<P, E>): boolean

    // 会话发起者是否为群主
    isGroupOwner?<P extends keyof Zhin.Adapters, E extends keyof Zhin.BotEventMaps[P] = keyof Zhin.BotEventMaps[P]>(session: NSession<P, E>): boolean

    start(): any
}

export type BotConstructs = {
    [P in keyof Zhin.Adapters]?: BotConstruct<P>
}
export namespace Bot {
    export type MessageType = 'private' | 'group' | 'discuss' | 'guild'

    export interface MessageRet extends Message {
        message_id: string
    }

    export type FullTargetId = `${keyof Zhin.Adapters}:${string | number}:${string}:${string | number | `${string | number}:${string | number}`}`

    export function getFullTargetId(session: NSession<keyof Zhin.Adapters>): FullTargetId {
        return [
            session.adapter.protocol,
            session.bot.self_id,
            session.detail_type,
            session.guild_id,
            session.channel_id,
            session.group_id,
            session.discuss_id,
            session.user_id
        ].filter(Boolean).join(':') as FullTargetId
    }

    export const botConstructors: BotConstructs = {}

    export function define<K extends keyof Zhin.Adapters>(key: K, botConstruct: BotConstruct<K>) {
        // @ts-ignore
        botConstructors[key] = botConstruct
    }
}

export class BotList<K extends keyof Zhin.Adapters> extends Array<Zhin.Bots[K]> {
    get(self_id: string | number) {
        return this.find(bot => bot.self_id === self_id || bot.self_id === Number(self_id)) as Zhin.Bots[K]
    }
}

export type BotConstruct<K extends keyof Zhin.Bots = keyof Zhin.Bots, BO = {}, AO = {}> = {
    new(zhin: Zhin, protocol: Zhin.Adapters[K], options: BotOptions<BO>): Zhin.Bots[K]
}
export namespace Bot {
    export type Authority='master' | 'admins' | 'owner' | 'admin'
    export const defaultOptions: BotOptions = {
        quote_self: false,
        enable: true,
        rate_limit: 1000,
        text_limit: 200,
        disable_plugins: [],
        admins: []
    }

    export interface Message {
        from_id: string | number
        to_id: string | number
        user_id: string | number
        type: MessageType
        content: string
    }
}
