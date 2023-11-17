import { Adapter, AdapterOptions } from "@/adapter";
import { Config as IcqqConfig, Client, MessageRet, genGroupMessageId, genDmMessageId } from "icqq";
import { Bot, BotOptions } from "@/bot";
import { Element } from "@/element";
import { Zhin } from "@/zhin";
import { NSession, Session } from "@/session";
import { EventMap } from "icqq/lib/events";
import { processMessage, toString } from "@/adapters/icqq/utils";

async function sendMsg(
    this: Client,
    target_id: string,
    target_type: string,
    message: Element.Fragment,
) {
    let { element, quote, music, share } = await processMessage.call(this, message);
    let args: any[] = [];
    if (!element.length && !music && !share)
        throw new Error(`发送消息(${element.join("")})不受支持`);
    if (music || share) {
        const target =
            target_type === "group"
                ? this.pickGroup(Number(target_id))
                : this.pickFriend(Number(target_id));
        if (music) await target.shareMusic(music.attrs.type, music.attrs.id);
        if (share) await target.shareUrl(share.attrs as any);
        return {
            message_id: "",
            from_id: this.uin,
            to_id: target_id,
            type: target_type as Bot.MessageType,
            elements: message,
        };
    }
    let func: string = `send${target_type.replace(/[a-z]/, str => str.toUpperCase())}Msg`;
    switch (target_type) {
        case "private":
        case "discuss":
        case "group":
            args.push(target_id);
            break;
        case "guild":
            args.push(...String(target_id).split(":"));
            break;
        default:
            throw new Error("not support");
    }
    const messageRet = (await this[func](
        ...args,
        element,
        quote ? await this.getMsg(quote.attrs.message_id) : undefined,
    )) as MessageRet;
    return {
        message_id: messageRet.message_id,
        from_id: this.uin + "",
        to_id: target_id + "",
        user_id: this.uin + "",
        content: Element.stringify(message),
        type: target_type as Bot.MessageType,
    } as Bot.MessageRet;
}

type Params<T> = T extends (...args: infer R) => any ? R : never;
type Returns<T> = T extends (...args: any[]) => infer R ? R : T;
export class IcqqBot extends Bot<"icqq", IcqqBotOptions, {}, Client> {
    constructor(app: Zhin, adapter: IcqqAdapter, options: BotOptions<IcqqBotOptions>) {
        if (!options.data_dir) options.data_dir = app.options.data_dir;
        super(app, adapter, options);
        this.internal = new Client(options);
        this.self_id = options.self_id;
        const _this = this;
        const trip = this.internal.trip;
        this.internal.trip = function (this: Client, event, ...args) {
            _this.adapter.dispatch(event, _this.createSession(event, ...args));
            _this.emit(event, ...args);
            return trip.apply(this, [event, ...args]);
        };
        this.internal.on("system.online", () => {
            this.adapter.emit("bot.online", this.self_id);
        });
        this.internal.on("system.offline", () => {
            this.adapter.emit("bot.offline", this.self_id);
        });
        this.internal.on("system.login.error", msg => {
            this.adapter.emit("bot.error", this.self_id, msg);
        });
    }
    async getSelfInfo(): Promise<Bot.Info> {
        return {
            self_id: this.self_id + "",
            name: this.internal.nickname,
            avatar: `https://q1.qlogo.cn/g?b=qq&nk=${this.self_id}&s=640`,
        };
    }
    async getGuildList(): Promise<Bot.GuildInfo[]> {
        const guildList = await this.internal.getGuildList();
        return [...guildList.values()].map(guildInfo => {
            return {
                ...guildInfo,
                guild_id: guildInfo.guild_id + "",
            };
        });
    }
    async getGuildInfo(guild_id: string): Promise<Bot.GuildInfo> {
        const guildList = await this.getGuildList();
        return guildList.find(guildInfo => {
            return guildInfo.guild_id === guild_id;
        });
    }
    call<K extends keyof Client>(
        method: K,
        ...args: Params<Client[K]>
    ): Promise<Returns<Client[K]>> {
        if (typeof this.internal[method] === "function") {
            return (this.internal[method] as Function)(...args);
        }
        return this.internal[method] as any;
    }
    async getGroupInfo(group_id: string): Promise<Bot.GroupInfo> {
        const groupInfo = await this.internal.getGroupInfo(Number(group_id));
        return {
            ...groupInfo,
            group_id: groupInfo.group_id + "",
        };
    }
    async getGroupList(): Promise<Bot.GroupInfo[]> {
        const groupList = await this.internal.getGroupList();
        return [...groupList.values()].map(groupInfo => {
            return {
                ...groupInfo,
                group_id: groupInfo.group_id + "",
            };
        });
    }
    async getChannelList(guild_id: string): Promise<Bot.ChannelInfo[]> {
        const channelList = await this.internal.getChannelList(guild_id);
        return [...channelList.values()].map(channelInfo => {
            return {
                ...channelInfo,
                guild_id: channelInfo.guild_id + "",
            };
        });
    }
    async getChannelInfo(guild_id: string, channel_id: string): Promise<Bot.ChannelInfo> {
        const channelList = await this.getChannelList(guild_id);
        return channelList.find(channelInfo => {
            return channelInfo.channel_id === channel_id;
        });
    }
    async getDiscussList(): Promise<Bot.DiscussInfo[]> {
        return [];
    }
    async getDiscussInfo(discuss_id: string): Promise<Bot.DiscussInfo> {
        throw new Error("not support");
    }
    async getUserList(): Promise<Bot.UserInfo[]> {
        const userList = this.internal.getFriendList();
        return [...userList.values()].map(userInfo => {
            return {
                ...userInfo,
                user_name: userInfo.nickname,
                user_id: userInfo.user_id + "",
            };
        });
    }
    async getUserInfo(user_id: string): Promise<Bot.UserInfo> {
        const userInfo = this.internal.fl.get(Number(user_id));
        return {
            ...userInfo,
            user_name: userInfo.nickname,
            user_id: userInfo.user_id + "",
        };
    }

    async sendMsg(
        target_id: string,
        target_type: Bot.MessageType,
        message: Element.Fragment,
    ): Promise<Bot.MessageRet> {
        const { message_id } = await sendMsg.apply(this.internal, [
            target_id,
            target_type,
            message,
        ]);
        const messageRet: Bot.MessageRet = {
            message_id,
            from_id: this.self_id + "",
            user_id: this.self_id + "",
            to_id: target_id,
            type: target_type,
            content: Element.stringify(message),
        };
        this.adapter.emit(`message.send`, this.self_id + "", messageRet);
        return messageRet;
    }

    async getMsg(message_id: string): Promise<Bot.Message> {
        const messageRet = await this.internal.getMsg(message_id);
        return {
            user_id: messageRet.user_id + "",
            from_id: messageRet.sender.user_id + "",
            type: messageRet.message_type,
            to_id: this.self_id + "",
            content: toString(messageRet.message),
        };
    }

    async deleteMsg(message_id: string) {
        return this.internal.deleteMsg(message_id);
    }

    callApi<T extends keyof Client>(apiName: T, ...args: Params<Client[T]>) {
        const fn = this.internal[apiName];
        return typeof fn === "function" ? (fn as Function).apply(this.internal, args) : fn;
    }

    start() {
        this.internal.login(Number(this.options.self_id), this.options.password);
    }

    stop() {
        this.internal.offTrap(/^(notice|request|message).+/);
        this.internal.logout();
    }

    isChannelAdmin(session) {
        return false;
    }

    isGroupAdmin(session: NSession): boolean {
        return session.detail_type === "group" && !!session.is_admin;
    }

    isGroupCreator(session: NSession): boolean {
        return session.detail_type === "group" && !!session.is_owner;
    }

    isAtMe(session): boolean {
        return !!session.atme;
    }

    createSession<E extends keyof EventMap>(
        event: E,
        ...args: Parameters<EventMap[E]>
    ): NSession<"icqq", E> {
        let obj: Record<string, any> = typeof args[0] === "object" ? args.shift() : {};
        if (!obj) obj = {};
        Object.assign(
            obj,
            {
                bot: this,
                protocol: "icqq",
                adapter: this.adapter,
                event,
                group: obj.group?.info || {},
                guild: obj.guild?.info || {},
                member: obj.member?.info || {},
                friend: obj.friend?.info || {},
                is_owner: obj.sender?.role === "owner",
                is_admin: obj.sender?.role === "admin",
                user: obj.user?.info || {},
                discuss: obj.discuss?.info || {},
                user_id: obj.user_id || obj.sender?.user_id || obj.sender?.tiny_id,
                user_name:
                    obj.nickname || obj.sender?.nickname || obj.sender?.card || obj.sender?.title,
                type: obj.post_type || event,
                detail_type:
                    obj.message_type ||
                    obj.request_type ||
                    obj.system_type ||
                    obj.notice_type ||
                    "guild",
            },
            { args },
        );
        delete obj.reply;
        let msg = [...(obj.message || "")];
        if (obj.source) {
            obj.quote = {
                message_id:
                    obj.detail_type === "group"
                        ? genGroupMessageId(
                              obj.group_id,
                              obj.source.user_id,
                              obj.source.seq,
                              obj.source.rand,
                              obj.source.time,
                          )
                        : genDmMessageId(
                              obj.user_id,
                              obj.source.seq,
                              obj.source.rand,
                              obj.source.time,
                          ),
                user_id: obj.source.user_id,
                content: obj.source.message,
            };
            // oicq bug:引用消息会在message里产生一个AtElem
            msg.shift();
            if (msg[0]?.type === "text") {
                msg[0].text = msg[0].text.trim();
            }
            obj.content = toString(obj.message || "");
            delete obj.source;
        } else {
            obj.content = toString(obj.message || "");
        }
        return new Session<"icqq">(this.adapter, this.self_id, event, obj) as any;
    }
}

export class IcqqAdapter extends Adapter<"icqq", IcqqBotOptions, {}> {
    constructor(app: Zhin, protocol, options: AdapterOptions<IcqqBotOptions>) {
        super(app, protocol, options);
    }
}

export interface IcqqBotOptions extends IcqqConfig {
    self_id: string;
    password?: string;
}

export type IcqqEventMap = {
    [P in keyof EventMap]: (...args: Parameters<EventMap[P]>) => void;
};
Adapter.define("icqq", IcqqAdapter, IcqqBot);
