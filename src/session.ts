import { deepEqual, Dict, isNullable } from "@zhinjs/shared";
import { Bot } from "./bot";
import { Zhin } from "./zhin";
import { Element } from "@/element";
import { Middleware } from "./middleware";
import { Prompt } from "./prompt";
import { Context } from "@/context";
import { Component } from "@/component";

export type FunctionPayloadWithSessionObj<E extends (...args: any[]) => any> = E extends (
    ...args: infer R
) => any
    ? ParametersToObj<R>
    : unknown;
export type ParametersToObj<A extends any[]> = A extends [infer R, ...infer L]
    ? R extends object
        ? Partial<R> & {
              args: L;
          }
        : { args: [R, ...L] }
    : Dict;
export type NSession<
    P extends keyof Zhin.Adapters,
    E extends keyof Zhin.BotEventMaps[P] = keyof Zhin.BotEventMaps[P],
> = Session<P> &
    (Zhin.BotEventMaps[P][E] extends (...args: any[]) => any
        ? FunctionPayloadWithSessionObj<Zhin.BotEventMaps[P][E]>
        : unknown);

export interface Session<
    P extends keyof Zhin.Adapters = keyof Zhin.Adapters,
    E extends keyof Zhin.BotEventMaps[P] = keyof Zhin.BotEventMaps[P],
> {
    protocol: P;
    /** 会话类型 */
    type?: string;
    /** 用户id */
    user_id?: string | number;
    /** 会话发起者昵称 */
    user_name?: string;
    /** 群id(仅group) */
    group_id?: string | number;
    /** 群名称(仅group) */
    group_name?: string;
    /** 讨论组id(仅discuss) */
    discuss_id?: string | number;
    /** 讨论组名称(仅discuss) */
    discuss_name?: string;
    /** 是否群主(仅group) */
    is_owner?: boolean;
    /** 是否管理员(仅group) */
    is_admin?: boolean;
    /** 频道id(仅guild) */
    channel_id?: string;
    /** 频道名称(仅guild) */
    channel_name?: string;
    /** 服务器id(仅guild) */
    guild_id?: string;
    /** 服务器名称(仅guild) */
    guild_name?: string;
    /** 详细类型 */
    detail_type?: string;
    /** zhin实例 */
    zhin: Zhin;
    /** 当前上下文 */
    context: Context;
    /** 当前适配器 */
    adapter: Zhin.Adapters[P];
    /** 交互式输入辅助实例 */
    prompt: Prompt;
    /** 会话内容 */
    content: string;
    /** 当前bot */
    bot: Zhin.Bots[P];
    event: E;
    /** 引用内容 */
    quote?: QuoteMessage;
    message_id?: string;
}

export type QuoteMessage = {
    message_id: string;
    user_id: string | number;
    content: string;
};

export class Session<
    P extends keyof Zhin.Adapters = keyof Zhin.Adapters,
    E extends keyof Zhin.BotEventMaps[P] = keyof Zhin.BotEventMaps[P],
> {
    constructor(
        public adapter: Zhin.Adapters[P],
        self_id,
        public event: E,
        obj: object,
    ) {
        this.protocol = adapter.protocol as any;
        this.zhin = adapter.zhin;
        this.event = event;
        this.bot = adapter.bots.get(self_id) as any;
        Object.assign(this, obj);
        this.prompt = new Prompt(this.bot, this as any, this.zhin.options.delay.prompt);
    }

    get client() {
        return this.bot.internal;
    }

    /**
     * 注册一个中间件
     * @param middleware
     */
    middleware(middleware: Middleware) {
        const fullId = Bot.getFullTargetId(this as any);
        return this.zhin.middleware(async (session, next) => {
            if (fullId && Bot.getFullTargetId(session) !== fullId) return next();
            return middleware(session, next);
        }, true);
    }

    /**
     * 指定上下文是否匹配当前会话
     * @param context
     */
    match(context: Context) {
        return context.filter(this as any);
    }

    /**
     * 拦截接下来所有filter(默认当前发送消息的用户)筛选出来的session，执行传入的runFunc,直到满足free条件
     * @param tip  提示文本
     * @param runFunc {Function} 执行的函数
     * @param free {string|number|boolean|(session)=>boolean} 释放条件
     * @param filter {} 筛选哪些会话
     */
    intercept(
        tip: Element.Fragment,
        runFunc: (session: NSession<keyof Zhin.Adapters>) => Element.Fragment | void,
        free: Element.Fragment | ((session: NSession<keyof Zhin.Adapters>) => boolean),
        filter?: (session: NSession<keyof Zhin.Adapters>) => boolean,
    ) {
        if (!filter)
            filter = session => Bot.getFullTargetId(session) === Bot.getFullTargetId(this as any);
        this.reply(tip);
        const needFree = session =>
            typeof free === "function"
                ? free(session)
                : deepEqual(session.content, Element.toElementArray(free).join(""));
        return new Promise<void>(resolve => {
            const dispose = this.zhin.middleware(async (session, next) => {
                if (!filter(session)) return next();
                if (needFree(session)) {
                    dispose();
                    cleanTimeout();
                    resolve();
                } else {
                    await runFunc(session);
                }
            });
            const cleanTimeout = this.context.setTimeout(() => {
                dispose();
                resolve();
            }, this.zhin.options.delay.prompt);
        });
    }

    /**
     * 发言者是否机器人主人
     */
    get isMaster() {
        return this.bot.isMaster(this as NSession<P, E>);
    }

    /**
     * 发言者是否机器人管理员(不代表群管理员)
     */
    get isAdmins() {
        return this.bot.isAdmins(this as NSession<P, E>);
    }

    /**
     * 是否at机器人
     */
    get isAtMe() {
        return this.bot.isAtMe(this as NSession<P, E>);
    }

    /**
     * 当前是否群聊
     */
    get isGroup() {
        return !!this.group_id;
    }

    /**
     * 当前是否私聊
     */
    get isPrivate() {
        return this.detail_type === "private";
    }

    /**
     * 当前是否群主
     */
    get isOwner() {
        return this.bot.isGroupOwner(this as NSession<P, E>);
    }

    /**
     * 当前是否群管理员
     */
    get isAdmin() {
        return this.bot.isGroupAdmin(this as NSession<P, E>);
    }

    toString() {
        // 处理前缀
        let result = this.content || "";
        // 有配置前缀，但是消息不是以前缀开头
        if (this.bot.options.prefix && !result.startsWith(this.bot.options.prefix)) return "";
        // 有配置前缀且消息以前缀开头，去掉前缀
        if (this.bot.options.prefix) result = result.slice(this.bot.options.prefix.length);
        return result;
    }

    /**
     * 根据模板执行命令
     * @param template {string} 模板
     * @returns {Promise<Element.Fragment>} 返回执行结果
     */
    async execute(template = this.toString()): Promise<Element.Fragment> {
        const commands = this.zhin.getSupportCommands(this as NSession<P, E>);
        for (const command of commands) {
            const result = await command.execute(this as any, template);
            if (result) return result;
        }
        return template;
    }

    async render<T extends Component.Runtime>(
        template: Element.Fragment = this.content,
        context?: T,
    ): Promise<Element[]> {
        if (!context)
            context = Zhin.createContext({
                session: this as any,
            }) as T;
        const components = this.zhin.getSupportComponents(this as NSession<P>);
        return await Element.renderAsync.apply(this, [template, components, context]);
    }

    get [Symbol.unscopables]() {
        return {
            zhin: true,
            options: true,
            adapter: true,
            friend: true,
            client: true,
            group: true,
            member: true,
            user: true,
            bot: true,
            plugin: true,
            context: true,
        };
    }

    toJSON() {
        return Object.fromEntries(
            Object.keys(this)
                .filter(key => {
                    return (
                        ![
                            "zhin",
                            "options",
                            "adapter",
                            "friend",
                            "client",
                            "group",
                            "member",
                            "user",
                            "bot",
                            "plugin",
                            "context",
                        ].includes(key) && typeof this[key] !== "function"
                    );
                })
                .map(key => [key, this[key]]),
        );
    }

    async reply(message: Element.Fragment) {
        return this.bot.reply(this as any, message, this.bot.options.quote_self);
    }
}

export namespace Session {
    export const checkProp = <K extends keyof Session>(key: K, ...values: Session[K][]) => {
        return ((session: Session) =>
            values.length ? values.includes(session[key]) : !!session[key]) as Context.Filter;
    };
}
