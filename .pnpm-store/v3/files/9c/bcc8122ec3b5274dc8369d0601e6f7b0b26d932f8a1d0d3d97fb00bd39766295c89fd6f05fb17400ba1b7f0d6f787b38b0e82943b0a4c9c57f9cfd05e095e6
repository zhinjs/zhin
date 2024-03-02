"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MessageEvent = exports.GuildMessageEvent = exports.GroupMessageEvent = exports.PrivateMessageEvent = void 0;
const message_1 = require("../message");
class PrivateMessageEvent extends message_1.Message {
    constructor(bot, sub_type, payload) {
        super(bot, payload);
        this.message_type = 'private';
        this.sub_type = sub_type;
    }
    async recall() {
        if (this.sub_type === 'direct')
            return this.bot.recallDirectMessage(this.guild_id, this.message_id);
    }
    async reply(message) {
        return this.sub_type === 'direct' ?
            this.bot.sendDirectMessage(this.guild_id, message, this) :
            this.bot.sendPrivateMessage(this.user_id, message, this);
    }
}
exports.PrivateMessageEvent = PrivateMessageEvent;
class GroupMessageEvent extends message_1.Message {
    constructor(bot, payload) {
        super(bot, payload);
        this.group_id = payload.group_id;
        this.message_type = 'group';
    }
    async reply(message) {
        return this.bot.sendGroupMessage(this.group_id, message, this);
    }
}
exports.GroupMessageEvent = GroupMessageEvent;
class GuildMessageEvent extends message_1.Message {
    constructor(bot, payload) {
        super(bot, payload);
        this.message_type = 'guild';
    }
    /**
     * 将该消息设置为公告
     */
    async asAnnounce() {
        return this.bot.setChannelAnnounce(this.guild_id, this.channel_id, this.id);
    }
    /**
     * 置顶消息
     */
    async pin() {
        return this.bot.pinChannelMessage(this.channel_id, this.id);
    }
    /**
     * 撤回消息
     * @param hidetip {boolean} 是否隐藏提示
     */
    recall(hidetip) {
        return this.bot.recallGuildMessage(this.channel_id, this.message_id, hidetip);
    }
    /**
     * 回复消息
     * @param message {Sendable} 回复内容
     */
    async reply(message) {
        return this.bot.sendGuildMessage(this.channel_id, message, this);
    }
    /**
     * 消息表态
     * @param type {1|2} 表情类型
     * @param id {`${number}`} 表态表情id
     */
    async reaction(type, id) {
        return this.bot.reactionGuildMessage(this.channel_id, this.message_id, type, id);
    }
    /**
     * 删除消息表态
     * @param type {1|2} 表情类型
     * @param id {`${number}`} 表态表情id
     */
    async deleteReaction(type, id) {
        return this.bot.deleteGuildMessageReaction(this.channel_id, this.message_id, type, id);
    }
    /**
     * 获取表态用户列表
     * @param type {1|2} 表情类型
     * @param id {`${number}`} 表态表情id
     */
    async getReactionMembers(type, id) {
        return this.bot.getGuildMessageReactionMembers(this.channel_id, this.message_id, type, id);
    }
}
exports.GuildMessageEvent = GuildMessageEvent;
var MessageEvent;
(function (MessageEvent) {
    MessageEvent.parse = function (event, payload) {
        this.removeAt(payload);
        const [message, brief] = message_1.Message.parse.call(this, payload);
        payload.message = message;
        const member = payload.member;
        const permissions = member?.roles || [];
        Object.assign(payload, {
            user_id: payload.author?.id,
            message_id: payload.id,
            raw_message: brief,
            sender: {
                user_id: payload.author?.id,
                user_name: payload.author?.username,
                permissions: ['normal'].concat(permissions),
                user_openid: payload.author?.user_openid || payload.author?.member_openid
            },
            timestamp: new Date(payload.timestamp).getTime() / 1000,
        });
        let messageEvent;
        switch (event) {
            case 'message.private.friend':
                messageEvent = new PrivateMessageEvent(this, 'friend', payload);
                this.logger.info(`recv from User(${payload.user_id}): ${payload.raw_message}`);
                break;
            case 'message.group':
                messageEvent = new GroupMessageEvent(this, payload);
                this.logger.info(`recv from Group(${payload.group_id}): ${payload.raw_message}`);
                break;
            case 'message.guild':
                messageEvent = new GuildMessageEvent(this, payload);
                this.logger.info(`recv from Guild(${payload.guild_id})Channel(${payload.channel_id}): ${payload.raw_message}`);
                break;
            case 'message.private.direct':
                messageEvent = new PrivateMessageEvent(this, 'direct', payload);
                this.logger.info(`recv from Direct(${payload.guild_id}): ${payload.raw_message}`);
                break;
        }
        return messageEvent;
    };
})(MessageEvent || (exports.MessageEvent = MessageEvent = {}));
