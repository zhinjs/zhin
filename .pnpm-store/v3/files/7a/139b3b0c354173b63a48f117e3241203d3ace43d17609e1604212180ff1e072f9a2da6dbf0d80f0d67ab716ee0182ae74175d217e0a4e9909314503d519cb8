"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Group = exports.Discuss = void 0;
const crypto_1 = require("crypto");
const axios_1 = __importDefault(require("axios"));
const core_1 = require("./core");
const errors_1 = require("./errors");
const common_1 = require("./common");
const internal_1 = require("./internal");
const message_1 = require("./message");
const gfs_1 = require("./gfs");
const protobuf_1 = require("./core/protobuf");
const fetchmap = new Map();
const weakmap = new WeakMap();
const GI_BUF = core_1.pb.encode({
    1: 0,
    2: 0,
    5: 0,
    6: 0,
    15: "",
    29: 0,
    36: 0,
    37: 0,
    45: 0,
    46: 0,
    49: 0,
    50: 0,
    54: 0,
    89: "",
});
/** 讨论组 */
class Discuss extends internal_1.Contactable {
    static as(gid) {
        return new Discuss(this, Number(gid));
    }
    /** {@link gid} 的别名 */
    get group_id() {
        return this.gid;
    }
    constructor(c, gid) {
        super(c);
        this.gid = gid;
        (0, common_1.lock)(this, "gid");
    }
    /** 发送一条消息 */
    async sendMsg(content) {
        const { rich, brief } = await this._preprocess(content);
        const body = core_1.pb.encode({
            1: { 4: { 1: this.gid } },
            2: common_1.PB_CONTENT,
            3: { 1: rich },
            4: (0, crypto_1.randomBytes)(2).readUInt16BE(),
            5: (0, crypto_1.randomBytes)(4).readUInt32BE(),
            8: 0,
        });
        const payload = await this.c.sendUni("MessageSvc.PbSendMsg", body);
        const rsp = core_1.pb.decode(payload);
        if (rsp[1] !== 0) {
            this.c.logger.error(`failed to send: [Discuss(${this.gid})] ${rsp[2]}(${rsp[1]})`);
            (0, errors_1.drop)(rsp[1], rsp[2]);
        }
        this.c.stat.sent_msg_cnt++;
        this.c.logger.info(`succeed to send: [Discuss(${this.gid})] ` + brief);
        return {
            message_id: "",
            seq: 0,
            rand: 0,
            time: 0,
        };
    }
}
exports.Discuss = Discuss;
/** 群 */
class Group extends Discuss {
    static as(gid, strict = false) {
        const info = this.gl.get(gid);
        if (strict && !info)
            throw new Error(`你尚未加入群` + gid);
        let group = weakmap.get(info);
        if (group)
            return group;
        group = new Group(this, Number(gid), info);
        if (info)
            weakmap.set(info, group);
        return group;
    }
    /** 群资料 */
    get info() {
        if (!this._info || (0, common_1.timestamp)() - this._info?.update_time >= 900)
            this.renew().catch(common_1.NOOP);
        return this._info;
    }
    /** 群名 */
    get name() {
        return this.info?.group_name;
    }
    /** 我是否是群主 */
    get is_owner() {
        return this.info?.owner_id === this.c.uin;
    }
    /** 我是否是管理 */
    get is_admin() {
        return this.is_owner || !!this.info?.admin_flag;
    }
    /** 是否全员禁言 */
    get all_muted() {
        return this.info?.shutup_time_whole > (0, common_1.timestamp)();
    }
    /** 我的禁言剩余时间 */
    get mute_left() {
        const t = this.info?.shutup_time_me - (0, common_1.timestamp)();
        return t > 0 ? t : 0;
    }
    constructor(c, gid, _info) {
        super(c, gid);
        this._info = _info;
        this.fs = new gfs_1.Gfs(c, gid);
        (0, common_1.lock)(this, "fs");
        (0, common_1.hide)(this, "_info");
    }
    /**
     * 获取群员实例
     * @param uid 群员账号
     * @param strict 严格模式，若群员不存在会抛出异常
     */
    pickMember(uid, strict = false) {
        return this.c.pickMember(this.gid, uid, strict);
    }
    /**
     * 获取群头像url
     * @param size 头像大小，默认`0`
     * @param history 历史头像记录，默认`0`，若要获取历史群头像则填写1,2,3...
     * @returns 头像的url地址
     */
    getAvatarUrl(size = 0, history = 0) {
        return (`https://p.qlogo.cn/gh/${this.gid}/${this.gid}${history ? "_" + history : ""}/` + size);
    }
    /** 强制刷新群资料 */
    async renew() {
        if (this._info)
            this._info.update_time = (0, common_1.timestamp)();
        const body = core_1.pb.encode({
            1: this.c.apk.subid,
            2: {
                1: this.gid,
                2: GI_BUF,
            },
        });
        const payload = await this.c.sendOidb("OidbSvc.0x88d_0", body);
        const proto = core_1.pb.decode(payload)[4][1][3];
        if (!proto) {
            this.c.gl.delete(this.gid);
            this.c.gml.delete(this.gid);
            (0, errors_1.drop)(errors_1.ErrorCode.GroupNotJoined);
        }
        let info = {
            group_id: this.gid,
            group_name: proto[89] ? String(proto[89]) : String(proto[15]),
            member_count: proto[6],
            max_member_count: proto[5],
            owner_id: proto[1],
            admin_flag: !!proto[50],
            last_join_time: proto[49],
            last_sent_time: proto[54],
            shutup_time_whole: proto[45] ? 0xffffffff : 0,
            shutup_time_me: proto[46] > (0, common_1.timestamp)() ? proto[46] : 0,
            create_time: proto[2],
            grade: proto[36],
            max_admin_count: proto[29],
            active_member_count: proto[37],
            update_time: (0, common_1.timestamp)(),
        };
        info = Object.assign(this.c.gl.get(this.gid) || this._info || {}, info);
        this.c.gl.set(this.gid, info);
        this._info = info;
        weakmap.set(info, this);
        return info;
    }
    async _fetchMembers() {
        let next = 0;
        if (!this.c.gml.has(this.gid))
            this.c.gml.set(this.gid, new Map());
        try {
            while (true) {
                const GTML = core_1.jce.encodeStruct([
                    this.c.uin,
                    this.gid,
                    next,
                    (0, common_1.code2uin)(this.gid),
                    2,
                    0,
                    0,
                    0,
                ]);
                const body = core_1.jce.encodeWrapper({ GTML }, "mqq.IMService.FriendListServiceServantObj", "GetTroopMemberListReq");
                const payload = await this.c.sendUni("friendlist.GetTroopMemberListReq", body, 10);
                const nested = core_1.jce.decodeWrapper(payload);
                next = nested[4];
                if (!this.c.gml.has(this.gid))
                    this.c.gml.set(this.gid, new Map());
                for (let v of nested[3]) {
                    let info = {
                        group_id: this.gid,
                        user_id: v[0],
                        nickname: v[4] || "",
                        card: v[8] || "",
                        sex: v[3] ? (v[3] === -1 ? "unknown" : "female") : "male",
                        age: v[2] || 0,
                        join_time: v[15],
                        last_sent_time: v[16],
                        level: v[14],
                        role: v[18] % 2 === 1 ? "admin" : "member",
                        title: v[23],
                        title_expire_time: v[24] & 0xffffffff,
                        shutup_time: v[30] > (0, common_1.timestamp)() ? v[30] : 0,
                        update_time: 0,
                    };
                    const list = this.c.gml.get(this.gid);
                    info = Object.assign(list.get(v[0]) || {}, info);
                    if (this.c.gl.get(this.gid)?.owner_id === v[0])
                        info.role = "owner";
                    list.set(v[0], info);
                }
                if (!next)
                    break;
            }
        }
        catch {
            this.c.logger.error("加载群员列表超时");
        }
        fetchmap.delete(this.c.uin + "-" + this.gid);
        const mlist = this.c.gml.get(this.gid);
        if (!mlist?.size || !this.c.config.cache_group_member)
            this.c.gml.delete(this.gid);
        return mlist || new Map();
    }
    /** 获取群员列表 */
    async getMemberMap(no_cache = false) {
        const k = this.c.uin + "-" + this.gid;
        const fetching = fetchmap.get(k);
        if (fetching)
            return fetching;
        const mlist = this.c.gml.get(this.gid);
        if (!mlist || no_cache) {
            const fetching = this._fetchMembers();
            fetchmap.set(k, fetching);
            return fetching;
        }
        else {
            return mlist;
        }
    }
    /**
     * 添加精华消息
     * @param seq 消息序号
     * @param rand 消息的随机值
     */
    async addEssence(seq, rand) {
        const retPacket = await this.c.sendPacket("Oidb", "OidbSvc.0xeac_1", {
            1: this.gid,
            2: seq,
            3: rand,
        });
        const ret = core_1.pb.decode(retPacket)[4];
        if (ret[1]) {
            this.c.logger.error(`加精群消息失败： ${ret[2]}(${ret[1]})`);
            (0, errors_1.drop)(ret[1], ret[2]);
        }
        else {
            return "设置精华成功";
        }
    }
    /**
     * 移除精华消息
     * @param seq 消息序号
     * @param rand 消息的随机值
     */
    async removeEssence(seq, rand) {
        const retPacket = await this.c.sendPacket("Oidb", "OidbSvc.0xeac_2", {
            1: this.gid,
            2: seq,
            3: rand,
        });
        const ret = core_1.pb.decode(retPacket)[4];
        if (ret[1]) {
            this.c.logger.error(`移除群精华消息失败： ${ret[2]}(${ret[1]})`);
            (0, errors_1.drop)(ret[1], ret[2]);
        }
        else {
            return "移除群精华消息成功";
        }
    }
    /**
     * 发送一个文件
     * @param file `string`表示从该本地文件路径上传，`Buffer`表示直接上传这段内容
     * @param pid 上传的目标目录id，默认根目录
     * @param name 上传的文件名，`file`为`Buffer`时，若留空则自动以md5命名
     * @param callback 监控上传进度的回调函数，拥有一个"百分比进度"的参数
     * @returns 上传的文件属性
     */
    async sendFile(file, pid = "/", name, callback) {
        return await this.fs.upload(file, pid, name, callback);
    }
    /**
     * 发送一条消息
     * @param content 消息内容
     * @param source 引用回复的消息
     * @param anony 是否匿名
     */
    async sendMsg(content, source, anony = false) {
        const converter = await this._preprocess(content, source);
        if (anony) {
            if (!anony.id)
                anony = await this.getAnonyInfo();
            converter.anonymize(anony);
        }
        const rand = (0, crypto_1.randomBytes)(4).readUInt32BE();
        const body = core_1.pb.encode({
            1: { 2: { 1: this.gid } },
            2: common_1.PB_CONTENT,
            3: { 1: converter.rich },
            4: (0, crypto_1.randomBytes)(2).readUInt16BE(),
            5: rand,
            8: 0,
        });
        const e = `internal.${this.gid}.${rand}`;
        let message_id = "";
        this.c.trapOnce(e, id => (message_id = id));
        try {
            const payload = await this.c.sendUni("MessageSvc.PbSendMsg", body);
            const rsp = core_1.pb.decode(payload);
            if (rsp[1] !== 0) {
                this.c.logger.error(`failed to send: [Group: ${this.gid}] ${rsp[2]}(${rsp[1]})`);
                (0, errors_1.drop)(rsp[1], rsp[2]);
            }
        }
        finally {
            this.c.offTrap(e);
        }
        // 分片专属屎山
        try {
            if (!message_id) {
                const time = this.c.config.resend ? (converter.length <= 80 ? 2000 : 500) : 5000;
                message_id = await new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => {
                        this.c.offTrap(e);
                        reject();
                    }, time);
                    this.c.trapOnce(e, id => {
                        clearTimeout(timeout);
                        resolve(id);
                    });
                });
            }
        }
        catch {
            message_id = await this._sendMsgByFrag(converter);
        }
        this.c.stat.sent_msg_cnt++;
        this.c.logger.info(`succeed to send: [Group(${this.gid})] ` + converter.brief);
        {
            const { seq, rand, time } = (0, message_1.parseGroupMessageId)(message_id);
            const messageRet = { seq, rand, time, message_id };
            this.c.emit("send", messageRet);
            return messageRet;
        }
    }
    async _sendMsgByFrag(converter) {
        if (!this.c.config.resend || !converter.is_chain)
            (0, errors_1.drop)(errors_1.ErrorCode.RiskMessageError);
        const fragments = converter.toFragments();
        this.c.logger.warn("群消息可能被风控，将尝试使用分片发送");
        let n = 0;
        const rand = (0, crypto_1.randomBytes)(4).readUInt32BE();
        const div = (0, crypto_1.randomBytes)(2).readUInt16BE();
        for (let frag of fragments) {
            const body = core_1.pb.encode({
                1: { 2: { 1: this.gid } },
                2: {
                    1: fragments.length,
                    2: n++,
                    3: div,
                },
                3: { 1: frag },
                4: (0, crypto_1.randomBytes)(2).readUInt16BE(),
                5: rand,
                8: 0,
            });
            this.c.writeUni("MessageSvc.PbSendMsg", body);
        }
        const e = `internal.${this.gid}.${rand}`;
        try {
            return await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    this.c.offTrap(e);
                    reject();
                }, 5000);
                this.c.trapOnce(e, id => {
                    clearTimeout(timeout);
                    resolve(id);
                });
            });
        }
        catch {
            (0, errors_1.drop)(errors_1.ErrorCode.SensitiveWordsError);
        }
    }
    /**
     * 设置当前群成员消息屏蔽状态
     * @param member_id
     * @param isScreen
     */
    setScreenMemberMsg(member_id, isScreen) {
        return this.pickMember(member_id).setScreenMsg(isScreen);
    }
    async recallMsg(param, rand = 0, pktnum = 1) {
        if (param instanceof message_1.GroupMessage)
            var { seq, rand, pktnum } = param;
        else if (typeof param === "string")
            var { seq, rand, pktnum } = (0, message_1.parseGroupMessageId)(param);
        else
            var seq = param;
        if (pktnum > 1) {
            var msg = [], pb_msg = [], n = pktnum, i = 0;
            while (n-- > 0) {
                msg.push(core_1.pb.encode({
                    1: seq,
                    2: rand,
                }));
                pb_msg.push(core_1.pb.encode({
                    1: seq,
                    3: pktnum,
                    4: i++,
                }));
                ++seq;
            }
            var reserver = {
                1: 1,
                2: pb_msg,
            };
        }
        else {
            var msg = {
                1: seq,
                2: rand,
            };
            var reserver = { 1: 0 };
        }
        const body = core_1.pb.encode({
            2: {
                1: 1,
                2: 0,
                3: this.gid,
                4: msg,
                5: reserver,
            },
        });
        const payload = await this.c.sendUni("PbMessageSvc.PbMsgWithDraw", body);
        return core_1.pb.decode(payload)[2][1] === 0;
    }
    /** 设置群名 */
    setName(name) {
        return this._setting({ 3: String(name) });
    }
    /** 全员禁言 */
    muteAll(yes = true) {
        return this._setting({ 17: yes ? 0xffffffff : 0 });
    }
    /** 发送简易群公告 */
    announce(content) {
        return this._setting({ 4: String(content) });
    }
    async _setting(obj) {
        const body = core_1.pb.encode({
            1: this.gid,
            2: obj,
        });
        const payload = await this.c.sendOidb("OidbSvc.0x89a_0", body);
        return core_1.pb.decode(payload)[3] === 0;
    }
    /** 允许/禁止匿名 */
    async allowAnony(yes = true) {
        const buf = Buffer.allocUnsafe(5);
        buf.writeUInt32BE(this.gid);
        buf.writeUInt8(yes ? 1 : 0, 4);
        const payload = await this.c.sendOidb("OidbSvc.0x568_22", buf);
        return core_1.pb.decode(payload)[3] === 0;
    }
    /** 设置群备注 */
    async setRemark(remark = "") {
        const body = core_1.pb.encode({
            1: {
                1: this.gid,
                2: (0, common_1.code2uin)(this.gid),
                3: String(remark || ""),
            },
        });
        await this.c.sendOidb("OidbSvc.0xf16_1", body);
    }
    /** 禁言匿名群员，默认1800秒 */
    async muteAnony(flag, duration = 1800) {
        const [nick, id] = flag.split("@");
        const Cookie = this.c.cookies["qqweb.qq.com"];
        let body = new URLSearchParams({
            anony_id: id,
            group_code: String(this.gid),
            seconds: String(duration),
            anony_nick: nick,
            bkn: String(this.c.bkn),
        }).toString();
        await axios_1.default.post("https://qqweb.qq.com/c/anonymoustalk/blacklist", body, {
            headers: { Cookie, "Content-Type": "application/x-www-form-urlencoded" },
            timeout: 5000,
        });
    }
    /** 获取自己的匿名情报 */
    async getAnonyInfo() {
        const body = core_1.pb.encode({
            1: 1,
            10: {
                1: this.c.uin,
                2: this.gid,
            },
        });
        const payload = await this.c.sendUni("group_anonymous_generate_nick.group", body);
        const obj = core_1.pb.decode(payload)[11];
        return {
            enable: !obj[10][1],
            name: String(obj[3]),
            id: obj[5],
            id2: obj[4],
            expire_time: obj[6],
            color: String(obj[15]),
        };
    }
    /** 获取 @全体成员 的剩余次数 */
    async getAtAllRemainder() {
        const body = core_1.pb.encode({
            1: 1,
            2: 2,
            3: 1,
            4: this.c.uin,
            5: this.gid,
        });
        const payload = await this.c.sendOidb("OidbSvc.0x8a7_0", body);
        return core_1.pb.decode(payload)[4][2];
    }
    async _getLastSeq() {
        const body = core_1.pb.encode({
            1: this.c.apk.subid,
            2: {
                1: this.gid,
                2: {
                    22: 0,
                },
            },
        });
        const payload = await this.c.sendOidb("OidbSvc.0x88d_0", body);
        return core_1.pb.decode(payload)[4][1][3][22];
    }
    /**
     * 标记`seq`之前的消息为已读
     * @param seq 消息序号，默认为`0`，表示标记所有消息
     */
    async markRead(seq = 0) {
        const body = core_1.pb.encode({
            1: {
                1: this.gid,
                2: Number(seq || (await this._getLastSeq())),
            },
        });
        await this.c.sendUni("PbMessageSvc.PbMsgReadedReport", body);
    }
    /**
     * 获取`seq`之前的`cnt`条聊天记录，默认从最后一条发言往前，`cnt`默认20不能超过20
     * @param seq 消息序号，默认为`0`，表示从最后一条发言往前
     * @param cnt 聊天记录条数，默认`20`，超过`20`按`20`处理
     * @returns 群聊消息列表，服务器记录不足`cnt`条则返回能获取到的最多消息记录
     */
    async getChatHistory(seq = 0, cnt = 20) {
        if (cnt > 20)
            cnt = 20;
        if (!seq)
            seq = await this._getLastSeq();
        const from_seq = seq - cnt + 1;
        const body = core_1.pb.encode({
            1: this.gid,
            2: from_seq,
            3: Number(seq),
            6: 0,
        });
        const payload = await this.c.sendUni("MessageSvc.PbGetGroupMsg", body);
        const obj = core_1.pb.decode(payload), messages = [];
        if (obj[1] > 0 || !obj[6])
            return [];
        !Array.isArray(obj[6]) && (obj[6] = [obj[6]]);
        for (const proto of obj[6]) {
            try {
                messages.push(new message_1.GroupMessage(proto));
            }
            catch { }
        }
        return messages;
    }
    /**
     * 获取群文件下载地址
     * @param fid 文件id
     */
    async getFileUrl(fid) {
        return (await this.fs.download(fid)).url;
    }
    /** 设置群头像 */
    async setAvatar(file) {
        const img = new message_1.Image({ type: "image", file });
        await img.task;
        const url = `http://htdata3.qq.com/cgi-bin/httpconn?htcmd=0x6ff0072&ver=5520&ukey=${this.c.sig.skey}&range=0&uin=${this.c.uin}&seq=1&groupuin=${this.gid}&filetype=3&imagetype=5&userdata=0&subcmd=1&subver=101&clip=0_0_0_0&filesize=` +
            img.size;
        await axios_1.default.post(url, img.readable, { headers: { "Content-Length": String(img.size) } });
        img.deleteTmpFile();
    }
    /**
     * 邀请好友入群
     * @param uid 好友账号
     */
    async invite(uid) {
        const body = core_1.pb.encode({
            1: this.gid,
            2: {
                1: Number(uid),
            },
        });
        const payload = await this.c.sendOidb("OidbSvc.oidb_0x758", body);
        return core_1.pb.decode(payload)[4].toBuffer().length > 6;
    }
    /** 打卡 */
    async sign() {
        const body = core_1.pb.encode({
            2: {
                1: String(this.c.uin),
                2: String(this.gid),
                3: this.c.apk.ver,
            },
        });
        const payload = await this.c.sendOidb("OidbSvc.0xeb7_1", body);
        const rsp = core_1.pb.decode(payload);
        return { result: rsp[3] & 0xffffffff };
    }
    /** 退群，若为群主则解散该群 */
    async quit() {
        const buf = Buffer.allocUnsafe(8);
        buf.writeUInt32BE(this.c.uin);
        buf.writeUInt32BE(this.gid, 4);
        const GroupMngReq = core_1.jce.encodeStruct([2, this.c.uin, buf]);
        const body = core_1.jce.encodeWrapper({ GroupMngReq }, "KQQ.ProfileService.ProfileServantObj", "GroupMngReq");
        const payload = await this.c.sendUni("ProfileService.GroupMngReq", body);
        return core_1.jce.decodeWrapper(payload)[1] === 0;
    }
    /**
     * 设置管理员，use {@link Member.setAdmin}
     * @param uid 群员账号
     * @param yes 是否设为管理员
     */
    setAdmin(uid, yes = true) {
        return this.pickMember(uid).setAdmin(yes);
    }
    /**
     * 设置头衔，use {@link Member.setTitle}
     * @param uid 群员账号
     * @param title 头衔名
     * @param duration 持续时间，默认`-1`，表示永久
     */
    setTitle(uid, title = "", duration = -1) {
        return this.pickMember(uid).setTitle(title, duration);
    }
    /**
     * 设置名片，use {@link Member.setCard}
     * @param uid 群员账号
     * @param card 名片
     */
    setCard(uid, card = "") {
        return this.pickMember(uid).setCard(card);
    }
    /**
     * 踢出此群，use {@link Member.kick}
     * @param uid 群员账号
     * @param msg @todo 未知参数
     * @param block 是否屏蔽群员
     */
    kickMember(uid, msg, block = false) {
        return this.pickMember(uid).kick(msg, block);
    }
    /**
     * 禁言群员，use {@link Member.mute}
     * @param uid 群员账号
     * @param duration 禁言时长（秒），默认`600`
     */
    muteMember(uid, duration = 600) {
        return this.pickMember(uid).mute(duration);
    }
    /**
     * 戳一戳
     * @param uid 群员账号
     */
    pokeMember(uid) {
        return this.pickMember(uid).poke();
    }
    /**
     * 获取群内被禁言人
     * @returns
     */
    async getMuteMemberList() {
        let body = {
            "1": 2201,
            "3": 0,
            "4": {
                "1": this.group_id,
                "2": 0,
                "3": 6,
                "5": {
                    "1": 0,
                    "12": 0,
                },
            },
        };
        let toTime = (timestamp) => {
            var date = new Date(timestamp * 1000);
            var Y = date.getFullYear() + "-";
            var M = (date.getMonth() + 1 < 10 ? "0" + (date.getMonth() + 1) : date.getMonth() + 1) +
                "-";
            var D = (date.getDate() < 10 ? "0" + date.getDate() : date.getDate()) + " ";
            var h = date.getHours() + ":";
            var m = date.getMinutes();
            return Y + M + D + h + m;
        };
        let resBody = await this.c.sendUni("OidbSvc.0x899_0", core_1.pb.encode(body));
        let res = (await (0, protobuf_1.decodePb)(resBody))[4][4];
        if (!(res instanceof Array)) {
            res = [res];
        }
        return res
            .map((item) => {
            if (!item) {
                return null;
            }
            return {
                uin: item ? item[1] : null,
                unMuteTime: item ? toTime(item[12]) : null,
            };
        })
            .filter(item => item);
    }
}
exports.Group = Group;
