"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Member = void 0;
const core_1 = require("./core");
const errors_1 = require("./errors");
const common_1 = require("./common");
const friend_1 = require("./friend");
const weakmap = new WeakMap();
/** @ts-ignore ts(2417) 群员 */
class Member extends friend_1.User {
    static as(gid, uid, strict = false) {
        const info = this.gml.get(gid)?.get(uid);
        if (strict && !info)
            throw new Error(`群${gid}中找不到群员` + uid);
        let member = weakmap.get(info);
        if (member)
            return member;
        member = new Member(this, Number(gid), Number(uid), info);
        if (info)
            weakmap.set(info, member);
        return member;
    }
    /** 群员资料 */
    get info() {
        if (!this.c.config.cache_group_member)
            return this._info;
        if (!this._info || (0, common_1.timestamp)() - this._info?.update_time >= 900)
            this.renew().catch(common_1.NOOP);
        return this._info;
    }
    /** {@link gid} 的别名 */
    get group_id() {
        return this.gid;
    }
    /** 名片 */
    get card() {
        return this.info?.card || this.info?.nickname;
    }
    /** 头衔 */
    get title() {
        return this.info?.title;
    }
    /** 是否是我的好友 */
    get is_friend() {
        return this.c.fl.has(this.uid);
    }
    /** 是否是群主 */
    get is_owner() {
        return this.info?.role === "owner";
    }
    /** 是否是管理员 */
    get is_admin() {
        return this.info?.role === "admin" || this.is_owner;
    }
    /** 禁言剩余时间 */
    get mute_left() {
        const t = this.info?.shutup_time - (0, common_1.timestamp)();
        return t > 0 ? t : 0;
    }
    /** 返回所在群的实例 */
    get group() {
        return this.c.pickGroup(this.gid);
    }
    constructor(c, gid, uid, _info) {
        super(c, uid);
        this.gid = gid;
        this._info = _info;
        (0, common_1.lock)(this, "gid");
        (0, common_1.hide)(this, "_info");
    }
    /** 强制刷新群员资料 */
    async renew() {
        if (!this.c.gml.has(this.gid) && this.c.config.cache_group_member)
            this.group.getMemberMap();
        if (this._info)
            this._info.update_time = (0, common_1.timestamp)();
        const body = core_1.pb.encode({
            1: this.gid,
            2: this.uid,
            3: 1,
            4: 1,
            5: 1,
        });
        const payload = await this.c.sendUni("group_member_card.get_group_member_card_info", body);
        const proto = core_1.pb.decode(payload)[3];
        if (!proto[27]) {
            this.c.gml.get(this.gid)?.delete(this.uid);
            (0, errors_1.drop)(errors_1.ErrorCode.MemberNotExists);
        }
        const card = proto[8] ? (0, common_1.parseFunString)(proto[8].toBuffer()) : "";
        let info = {
            group_id: this.gid,
            user_id: this.uid,
            nickname: proto[11]?.toString() || "",
            card: card,
            sex: proto[9] === 0 ? "male" : proto[9] === 1 ? "female" : "unknown",
            age: proto[12] || 0,
            area: proto[10]?.toString() || "",
            join_time: proto[14],
            last_sent_time: proto[15],
            level: proto[39],
            rank: Reflect.has(proto, "13") ? String(proto[13]) : "",
            role: proto[27] === 3 ? "owner" : proto[27] === 2 ? "admin" : "member",
            title: Reflect.has(proto, "31") ? String(proto[31]) : "",
            title_expire_time: Reflect.has(proto, "32") ? proto[32] : 0xffffffff,
            shutup_time: this.c.gml.get(this.gid)?.get(this.uid)?.shutup_time || 0,
            update_time: (0, common_1.timestamp)(),
        };
        info = Object.assign(this.c.gml.get(this.gid)?.get(this.uid) || this._info || {}, info);
        this.c.gml.get(this.gid)?.set(this.uid, info);
        this._info = info;
        weakmap.set(info, this);
        return info;
    }
    /**
     * 设置/取消管理员
     * @param yes 是否设为管理员
     */
    async setAdmin(yes = true) {
        const buf = Buffer.allocUnsafe(9);
        buf.writeUInt32BE(this.gid);
        buf.writeUInt32BE(this.uid, 4);
        buf.writeUInt8(yes ? 1 : 0, 8);
        const payload = await this.c.sendOidb("OidbSvc.0x55c_1", buf);
        const ret = core_1.pb.decode(payload)[3] === 0;
        if (ret && this.info && !this.is_owner)
            this.info.role = yes ? "admin" : "member";
        return ret;
    }
    /**
     * 设置头衔
     * @param title 头衔名
     * @param duration 持续时间，默认`-1`，表示永久
     */
    async setTitle(title = "", duration = -1) {
        const body = core_1.pb.encode({
            1: this.gid,
            3: {
                1: this.uid,
                7: String(title),
                5: String(title),
                6: Number(duration) || -1,
            },
        });
        const payload = await this.c.sendOidb("OidbSvc.0x8fc_2", body);
        return core_1.pb.decode(payload)[3] === 0;
    }
    /**
     * 修改名片
     * @param card 名片
     */
    async setCard(card = "") {
        const MGCREQ = core_1.jce.encodeStruct([
            0,
            this.gid,
            0,
            [core_1.jce.encodeNested([this.uid, 31, String(card), 0, "", "", ""])],
        ]);
        const body = core_1.jce.encodeWrapper({ MGCREQ }, "mqq.IMService.FriendListServiceServantObj", "ModifyGroupCardReq");
        const payload = await this.c.sendUni("friendlist.ModifyGroupCardReq", body);
        const ret = core_1.jce.decodeWrapper(payload)[3].length > 0;
        ret && this.info && (this.info.card = String(card));
        return ret;
    }
    /**
     * 踢出群
     * @param msg @todo 未知参数
     * @param block 是否屏蔽群员
     */
    async kick(msg, block = false) {
        const body = core_1.pb.encode({
            "1": this.gid,
            "2": {
                "1": 5,
                "2": this.uid,
                "3": block ? 1 : 0,
            },
            "5": msg,
        });
        const payload = await this.c.sendOidb("OidbSvc.0x8a0_0", body);
        const ret = core_1.pb.decode(payload)[4][2][1] === 0;
        ret && this.c.gml.get(this.gid)?.delete(this.uid);
        return ret;
    }
    /**
     * 禁言
     * @param duration 禁言时长（秒），默认`1800`
     */
    async mute(duration = 1800) {
        if (duration > 2592000 || duration < 0)
            duration = 2592000;
        const buf = Buffer.allocUnsafe(15);
        buf.writeUInt32BE(this.gid);
        buf.writeUInt8(32, 4);
        buf.writeUInt16BE(1, 5);
        buf.writeUInt32BE(this.uid, 7);
        buf.writeUInt32BE(Number(duration) || 0, 11);
        await this.c.sendOidb("OidbSvc.0x570_8", buf);
    }
    /** 戳一戳 */
    async poke() {
        const body = core_1.pb.encode({
            1: this.uid,
            2: this.gid,
        });
        const payload = await this.c.sendOidb("OidbSvc.0xed3", body);
        return core_1.pb.decode(payload)[3] === 0;
    }
    /**
     * 是否屏蔽该群成员消息
     * @param isScreen
     */
    async setScreenMsg(isScreen = true) {
        const body = core_1.pb.encode({
            1: {
                1: {
                    1: this.gid,
                    [isScreen ? 5 : 6]: isScreen
                        ? {
                            1: this.uid,
                        }
                        : this.uid,
                },
            },
        });
        const payload = await this.c.sendOidb(isScreen ? "OidbSvc.0x8bb_7" : "OidbSvc.0x8bb_9", body);
        return core_1.pb.decode(payload)[3] === 0;
    }
    /**
     * 加为好友
     * @param comment 申请消息
     */
    async addFriend(comment = "") {
        const type = await this.getAddFriendSetting();
        if (![0, 1, 4].includes(type))
            return false;
        comment = String(comment);
        const AF = core_1.jce.encodeStruct([
            this.c.uin,
            this.uid,
            type ? 1 : 0,
            1,
            0,
            Buffer.byteLength(comment),
            comment,
            0,
            1,
            null,
            3004,
            11,
            null,
            null,
            this.gid ? core_1.pb.encode({ 1: this.gid }) : null,
            0,
            null,
            null,
            0,
        ]);
        const body = core_1.jce.encodeWrapper({ AF }, "mqq.IMService.FriendListServiceServantObj", "AddFriendReq");
        const payload = await this.c.sendUni("friendlist.addFriend", body);
        return core_1.jce.decodeWrapper(payload)[6] === 0;
    }
}
exports.Member = Member;
