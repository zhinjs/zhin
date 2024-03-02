"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Guild = exports.GuildRole = void 0;
const core_1 = require("./core");
const constants_1 = require("./core/constants");
const channel_1 = require("./channel");
/** 频道权限 */
var GuildRole;
(function (GuildRole) {
    /** 成员 */
    GuildRole[GuildRole["Member"] = 1] = "Member";
    /** 频道管理员 */
    GuildRole[GuildRole["GuildAdmin"] = 2] = "GuildAdmin";
    /** 频道主 */
    GuildRole[GuildRole["Owner"] = 4] = "Owner";
    /** 子频道管理员 */
    GuildRole[GuildRole["ChannelAdmin"] = 5] = "ChannelAdmin";
})(GuildRole || (exports.GuildRole = GuildRole = {}));
const members4buf = core_1.pb.encode({
    1: 1,
    2: 1,
    3: 1,
    4: 1,
    5: 1,
    6: 1,
    7: 1,
    8: 1,
});
const weakmap = new WeakMap();
/** 频道 */
class Guild {
    constructor(c, guild_id) {
        this.c = c;
        this.guild_id = guild_id;
        /** 频道名 */
        this.guild_name = "";
        /** 子频道字典 */
        this.channels = new Map();
        (0, constants_1.lock)(this, "guild_id");
    }
    static as(guild_id) {
        const guild = this.guilds.get(guild_id);
        if (!guild)
            throw new Error(`尚未加入Guild(${guild_id})`);
        return guild;
    }
    /**
     * 发送消息
     * @param channel_id 子频道id
     * @param message 消息内容
     */
    async sendMsg(channel_id, message) {
        let channel = this.channels.get(channel_id);
        if (!channel)
            throw new Error(`你尚未加入频道：` + channel_id);
        return channel.sendMsg(message);
    }
    _renew(guild_name, proto) {
        this.guild_name = guild_name;
        if (!Array.isArray(proto))
            proto = [proto];
        const tmp = new Set();
        for (const p of proto) {
            const id = String(p[1]), name = String(p[8]), notify_type = p[7], channel_type = p[9];
            tmp.add(id);
            if (!this.channels.has(id))
                this.channels.set(id, new channel_1.Channel(this, id));
            const channel = this.channels.get(id);
            channel._renew(name, notify_type, channel_type);
        }
        for (let [id, _] of this.channels) {
            if (!tmp.has(id))
                this.channels.delete(id);
        }
    }
    /** 获取频道成员列表 */
    async getMemberList() {
        let index = 0; // todo member count over 500
        const body = core_1.pb.encode({
            1: BigInt(this.guild_id),
            2: 3,
            3: 0,
            4: members4buf,
            6: index,
            8: 500,
            14: 2,
        });
        const rsp = await this.c.sendOidbSvcTrpcTcp("OidbSvcTrpcTcp.0xf5b_1", body);
        const list = [];
        const members = Array.isArray(rsp[5]) ? rsp[5] : [rsp[5]];
        const admins = Array.isArray(rsp[25]) ? rsp[25] : [rsp[25]];
        for (const p of admins) {
            const role = p[1];
            if (!p[2])
                continue;
            const m = Array.isArray(p[2]) ? p[2] : [p[2]];
            for (const p2 of m) {
                list.push({
                    tiny_id: String(p2[8]),
                    card: String(p2[2]),
                    nickname: String(p2[3]),
                    role,
                    join_time: p2[4],
                });
            }
        }
        for (const p of members) {
            list.push({
                tiny_id: String(p[8]),
                card: String(p[2]),
                nickname: String(p[3]),
                role: GuildRole.Member,
                join_time: p[4],
            });
        }
        return list;
    }
}
exports.Guild = Guild;
