"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.guildMsgListener = exports.GuildMessageEvent = void 0;
const core_1 = require("../core");
const common_1 = require("../common");
const message_1 = require("../message");
/** 频道消息事件 */
class GuildMessageEvent {
    constructor(proto) {
        this.post_type = 'message';
        this.detail_type = 'guild';
        const head1 = proto[1][1][1];
        const head2 = proto[1][1][2];
        if (head2[1] !== 3840)
            throw new Error("unsupport guild message type");
        const body = proto[1][3];
        const extra = proto[1][4];
        this.guild_id = String(head1[1]);
        this.channel_id = String(head1[2]);
        this.guild_name = String(extra[2]);
        this.channel_name = String(extra[3]);
        this.sender = {
            tiny_id: String(head1[4]),
            nickname: String(extra[1])
        };
        this.seq = head2[4];
        this.rand = head2[3];
        this.time = head2[6];
        const parsed = (0, message_1.parse)(body[1]);
        this.message = parsed.message;
        this.raw_message = parsed.brief;
        (0, common_1.lock)(this, "proto");
    }
}
exports.GuildMessageEvent = GuildMessageEvent;
function guildMsgListener(payload) {
    try {
        var msg = new GuildMessageEvent(core_1.pb.decode(payload));
    }
    catch {
        return;
    }
    if (msg.sender.tiny_id === this.tiny_id && this.config.ignore_self)
        return;
    this.stat.recv_msg_cnt++;
    this.logger.info(`recv from: [Guild: ${msg.guild_name}, Member: ${msg.sender.nickname}]` + msg.raw_message);
    msg.reply = (content) => {
        return this.sendGuildMsg(msg.guild_id, msg.channel_id, content);
    };
    this.em("message.guild", msg);
}
exports.guildMsgListener = guildMsgListener;
