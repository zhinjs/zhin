"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Friend = exports.User = void 0;
const crypto_1 = require("crypto");
const stream_1 = require("stream");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const core_1 = require("./core");
const errors_1 = require("./errors");
const common_1 = require("./common");
const message_1 = require("./message");
const internal_1 = require("./internal");
const protobuf_1 = require("./core/protobuf");
const weakmap = new WeakMap();
/** 用户 */
class User extends internal_1.Contactable {
    /** `this.uid`的别名 */
    get user_id() {
        return this.uid;
    }
    static as(uid) {
        return new User(this, Number(uid));
    }
    constructor(c, uid) {
        super(c);
        this.uid = uid;
        (0, common_1.lock)(this, "uid");
    }
    /** 返回作为好友的实例 */
    asFriend(strict = false) {
        return this.c.pickFriend(this.uid, strict);
    }
    /** 返回作为某群群员的实例 */
    asMember(gid, strict = false) {
        return this.c.pickMember(gid, this.uid, strict);
    }
    /**
     * 获取头像url
     * @param size 头像大小，默认`0`
     * @returns 头像的url地址
     */
    getAvatarUrl(size = 0) {
        return `https://q1.qlogo.cn/g?b=qq&s=${size}&nk=` + this.uid;
    }
    async getAddFriendSetting() {
        const FS = core_1.jce.encodeStruct([this.c.uin, this.uid, 3004, 0, null, 1]);
        const body = core_1.jce.encodeWrapper({ FS }, "mqq.IMService.FriendListServiceServantObj", "GetUserAddFriendSettingReq");
        const payload = await this.c.sendUni("friendlist.getUserAddFriendSetting", body);
        return core_1.jce.decodeWrapper(payload)[2];
    }
    /**
     * 点赞，支持陌生人点赞
     * @param times 点赞次数，默认1次
     */
    async thumbUp(times = 1) {
        if (times > 20)
            times = 20;
        let ReqFavorite;
        if (this.c.fl.get(this.uid)) {
            ReqFavorite = core_1.jce.encodeStruct([
                core_1.jce.encodeNested([
                    this.c.uin,
                    1,
                    this.c.sig.seq + 1,
                    1,
                    0,
                    Buffer.from("0C180001060131160131", "hex"),
                ]),
                this.uid,
                0,
                1,
                Number(times),
            ]);
        }
        else {
            ReqFavorite = core_1.jce.encodeStruct([
                core_1.jce.encodeNested([
                    this.c.uin,
                    1,
                    this.c.sig.seq + 1,
                    1,
                    0,
                    Buffer.from("0C180001060131160135", "hex"),
                ]),
                this.uid,
                0,
                5,
                Number(times),
            ]);
        }
        const body = core_1.jce.encodeWrapper({ ReqFavorite }, "VisitorSvc", "ReqFavorite", this.c.sig.seq + 1);
        const payload = await this.c.sendUni("VisitorSvc.ReqFavorite", body);
        return core_1.jce.decodeWrapper(payload)[0][3] === 0;
    }
    /** 查看资料 */
    async getSimpleInfo() {
        const arr = [null, 0, "", [this.uid], 1, 1, 0, 0, 0, 1, 0, 1];
        arr[101] = 1;
        const req = core_1.jce.encodeStruct(arr);
        const body = core_1.jce.encodeWrapper({ req }, "KQQ.ProfileService.ProfileServantObj", "GetSimpleInfo");
        const payload = await this.c.sendUni("ProfileService.GetSimpleInfo", body);
        const nested = core_1.jce.decodeWrapper(payload);
        for (let v of nested) {
            return {
                /** 账号 */
                user_id: v[1],
                /** 昵称 */
                nickname: (v[5] || ""),
                /** 性别 */
                sex: (v[3] ? (v[3] === -1 ? "unknown" : "female") : "male"),
                /** 年龄 */
                age: (v[4] || 0),
                /** 地区 */
                area: (v[13] + " " + v[14] + " " + v[15]).trim(),
            };
        }
        (0, errors_1.drop)(errors_1.ErrorCode.UserNotExists);
    }
    /**
     * 获取`time`往前的`cnt`条聊天记录
     * @param time 默认当前时间，为时间戳的分钟数（`Date.now() / 1000`）
     * @param cnt 聊天记录条数，默认`20`，超过`20`按`20`处理
     * @returns 私聊消息列表，服务器记录不足`cnt`条则返回能获取到的最多消息记录
     */
    async getChatHistory(time = (0, common_1.timestamp)(), cnt = 20) {
        if (cnt > 20)
            cnt = 20;
        const body = core_1.pb.encode({
            1: this.uid,
            2: Number(time),
            3: 0,
            4: Number(cnt),
        });
        const payload = await this.c.sendUni("MessageSvc.PbGetOneDayRoamMsg", body);
        const obj = core_1.pb.decode(payload), messages = [];
        if (obj[1] > 0 || !obj[6])
            return messages;
        !Array.isArray(obj[6]) && (obj[6] = [obj[6]]);
        for (const proto of obj[6]) {
            try {
                messages.push(new message_1.PrivateMessage(proto, this.c.uin));
            }
            catch { }
        }
        return messages;
    }
    /**
     * 标记`time`之前为已读
     * @param time 默认当前时间，为时间戳的分钟数（`Date.now() / 1000`）
     */
    async markRead(time = (0, common_1.timestamp)()) {
        const body = core_1.pb.encode({
            3: {
                2: {
                    1: this.uid,
                    2: Number(time),
                },
            },
        });
        await this.c.sendUni("PbMessageSvc.PbMsgReadedReport", body);
    }
    async recallMsg(param, rand = 0, time = 0) {
        if (param instanceof message_1.PrivateMessage)
            var { seq, rand, time } = param;
        else if (typeof param === "string")
            var { seq, rand, time } = (0, message_1.parseDmMessageId)(param);
        else
            var seq = param;
        const body = core_1.pb.encode({
            1: [
                {
                    1: [
                        {
                            1: this.c.uin,
                            2: this.uid,
                            3: Number(seq),
                            4: (0, message_1.rand2uuid)(Number(rand)),
                            5: Number(time),
                            6: Number(rand),
                        },
                    ],
                    2: 0,
                    3: {
                        1: this.c.fl.has(this.uid) || this.c.sl.has(this.uid) ? 0 : 1,
                    },
                    4: 1,
                },
            ],
        });
        const payload = await this.c.sendUni("PbMessageSvc.PbMsgWithDraw", body);
        return core_1.pb.decode(payload)[1][1] <= 2;
    }
    _getRouting(file = false) {
        if (Reflect.has(this, "gid"))
            return {
                3: {
                    1: (0, common_1.code2uin)(Reflect.get(this, "gid")),
                    2: this.uid,
                },
            };
        return file ? { 15: { 1: this.uid, 2: 4 } } : { 1: { 1: this.uid } };
    }
    /**
     * 发送一条消息
     * @param content 消息内容
     * @param source 引用回复的消息
     */
    async sendMsg(content, source) {
        const { rich, brief } = await this._preprocess(content, source);
        return this._sendMsg({ 1: rich }, brief);
    }
    async _sendMsg(proto3, brief, file = false) {
        const seq = this.c.sig.seq + 1;
        const rand = (0, crypto_1.randomBytes)(4).readUInt32BE();
        const body = core_1.pb.encode({
            1: this._getRouting(file),
            2: common_1.PB_CONTENT,
            3: proto3,
            4: seq,
            5: rand,
            6: (0, internal_1.buildSyncCookie)(this.c.sig.session.readUInt32BE()),
        });
        const payload = await this.c.sendUni("MessageSvc.PbSendMsg", body);
        const rsp = core_1.pb.decode(payload);
        if (rsp[1] !== 0 || rsp[14] === 0) {
            this.c.logger.error(`failed to send: [Private: ${this.uid}] ${rsp[2]}(${rsp[1]})`);
            (0, errors_1.drop)(rsp[1] || -70, rsp[2] || '私聊消息发送失败，可能被风控');
        }
        this.c.logger.info(`succeed to send: [Private(${this.uid})] ` + brief);
        this.c.stat.sent_msg_cnt++;
        const time = rsp[3];
        const message_id = (0, message_1.genDmMessageId)(this.uid, seq, rand, time, 1);
        const messageRet = { message_id, seq, rand, time };
        this.c.emit("send", messageRet);
        return messageRet;
    }
    /**
     * 回添双向好友
     * @param seq 申请消息序号
     * @param remark 好友备注
     */
    async addFriendBack(seq, remark = "") {
        const body = core_1.pb.encode({
            1: 1,
            2: Number(seq),
            3: this.uid,
            4: 10,
            5: 2004,
            6: 1,
            7: 0,
            8: {
                1: 2,
                52: String(remark),
            },
        });
        const payload = await this.c.sendUni("ProfileService.Pb.ReqSystemMsgAction.Friend", body);
        return core_1.pb.decode(payload)[1][1] === 0;
    }
    /**
     * 处理好友申请
     * @param seq 申请消息序号
     * @param yes 是否同意
     * @param remark 好友备注
     * @param block 是否屏蔽来自此用户的申请
     */
    async setFriendReq(seq, yes = true, remark = "", block = false) {
        const body = core_1.pb.encode({
            1: 1,
            2: Number(seq),
            3: this.uid,
            4: 1,
            5: 6,
            6: 7,
            8: {
                1: yes ? 2 : 3,
                52: String(remark),
                53: block ? 1 : 0,
            },
        });
        const payload = await this.c.sendUni("ProfileService.Pb.ReqSystemMsgAction.Friend", body);
        return core_1.pb.decode(payload)[1][1] === 0;
    }
    /**
     * 处理入群申请
     * @param gid 群号
     * @param seq 申请消息序号
     * @param yes 是否同意
     * @param reason 若拒绝，拒绝的原因
     * @param block 是否屏蔽来自此用户的申请
     */
    async setGroupReq(gid, seq, yes = true, reason = "", block = false) {
        const body = core_1.pb.encode({
            1: 1,
            2: Number(seq),
            3: this.uid,
            4: 1,
            5: 3,
            6: 31,
            7: 1,
            8: {
                1: yes ? 11 : 12,
                2: Number(gid),
                50: String(reason),
                53: block ? 1 : 0,
            },
        });
        const payload = await this.c.sendUni("ProfileService.Pb.ReqSystemMsgAction.Group", body);
        return core_1.pb.decode(payload)[1][1] === 0;
    }
    /**
     * 处理群邀请
     * @param gid 群号
     * @param seq 申请消息序号
     * @param yes 是否同意
     * @param block 是否屏蔽来自此群的邀请
     */
    async setGroupInvite(gid, seq, yes = true, block = false) {
        const body = core_1.pb.encode({
            1: 1,
            2: Number(seq),
            3: this.uid,
            4: 1,
            5: 3,
            6: 10016,
            7: 2,
            8: {
                1: yes ? 11 : 12,
                2: Number(gid),
                53: block ? 1 : 0,
            },
        });
        const payload = await this.c.sendUni("ProfileService.Pb.ReqSystemMsgAction.Group", body);
        return core_1.pb.decode(payload)[1][1] === 0;
    }
    /**
     * 获取文件信息
     * @param fid 文件id
     */
    async getFileInfo(fid) {
        const body = core_1.pb.encode({
            1: 1200,
            14: {
                10: this.c.uin,
                20: fid,
                30: 2,
            },
            101: 3,
            102: 104,
            99999: { 1: 90200 },
        });
        const payload = await this.c.sendUni("OfflineFilleHandleSvr.pb_ftn_CMD_REQ_APPLY_DOWNLOAD-1200", body);
        const rsp = core_1.pb.decode(payload)[14];
        if (rsp[10] !== 0)
            (0, errors_1.drop)(errors_1.ErrorCode.OfflineFileNotExists, rsp[20]);
        const obj = rsp[30];
        let url = String(obj[50]);
        if (!url.startsWith("http"))
            url = `http://${obj[30]}:${obj[40]}` + url;
        return {
            name: String(rsp[40][7]),
            fid: String(rsp[40][6]),
            md5: rsp[40][100].toHex(),
            size: rsp[40][3],
            duration: rsp[40][4],
            url,
        };
    }
    /**
     * 获取离线文件下载地址
     * @param fid 文件id
     */
    async getFileUrl(fid) {
        return (await this.getFileInfo(fid)).url;
    }
}
exports.User = User;
/** 好友 */
class Friend extends User {
    static as(uid, strict = false) {
        const info = this.fl.get(uid);
        if (strict && !info)
            throw new Error(uid + `不是你的好友`);
        let friend = weakmap.get(info);
        if (friend)
            return friend;
        friend = new Friend(this, Number(uid), info);
        if (info)
            weakmap.set(info, friend);
        return friend;
    }
    /** 好友资料 */
    get info() {
        return this._info;
    }
    /** 昵称 */
    get nickname() {
        return this.info?.nickname;
    }
    /** 性别 */
    get sex() {
        return this.info?.sex;
    }
    /** 备注 */
    get remark() {
        return this.info?.remark;
    }
    /** 分组id */
    get class_id() {
        return this.info?.class_id;
    }
    /** 分组名 */
    get class_name() {
        return this.c.classes.get(this.info?.class_id);
    }
    constructor(c, uid, _info) {
        super(c, uid);
        this._info = _info;
        (0, common_1.hide)(this, "_info");
    }
    /** 设置备注 */
    async setRemark(remark) {
        const req = core_1.jce.encodeStruct([this.uid, String(remark || "")]);
        const body = core_1.jce.encodeWrapper({ req }, "KQQ.ProfileService.ProfileServantObj", "ChangeFriendName");
        await this.c.sendUni("ProfileService.ChangeFriendName", body);
    }
    /** 设置分组(注意：如果分组id不存在也会成功) */
    async setClass(id) {
        const buf = Buffer.alloc(10);
        (buf[0] = 1), (buf[2] = 5);
        buf.writeUInt32BE(this.uid, 3);
        buf[7] = Number(id);
        const MovGroupMemReq = core_1.jce.encodeStruct([this.c.uin, 0, buf]);
        const body = core_1.jce.encodeWrapper({ MovGroupMemReq }, "mqq.IMService.FriendListServiceServantObj", "MovGroupMemReq");
        await this.c.sendUni("friendlist.MovGroupMemReq", body);
    }
    /** 戳一戳 */
    async poke(self = false) {
        const body = core_1.pb.encode({
            1: self ? this.c.uin : this.uid,
            5: this.uid,
        });
        const payload = await this.c.sendOidb("OidbSvc.0xed3", body);
        return core_1.pb.decode(payload)[3] === 0;
    }
    /**
     * 删除好友
     * @param block 屏蔽此好友的申请，默认为`true`
     */
    async delete(block = true) {
        const DF = core_1.jce.encodeStruct([this.c.uin, this.uid, 2, block ? 1 : 0]);
        const body = core_1.jce.encodeWrapper({ DF }, "mqq.IMService.FriendListServiceServantObj", "DelFriendReq");
        const payload = await this.c.sendUni("friendlist.delFriend", body);
        this.c.sl.delete(this.uid);
        return core_1.jce.decodeWrapper(payload)[2] === 0;
    }
    /**
     * 发送离线文件
     * @param file `string`表示从该本地文件路径获取，`Buffer`表示直接发送这段内容
     * @param filename 对方看到的文件名，`file`为`Buffer`时，若留空则自动以md5命名
     * @param callback 监控上传进度的回调函数，拥有一个"百分比进度"的参数
     * @returns 文件id(撤回时使用)
     */
    async sendFile(file, filename, callback) {
        let filesize, filemd5, filesha, filestream;
        if (file instanceof Uint8Array) {
            if (!Buffer.isBuffer(file))
                file = Buffer.from(file);
            filesize = file.length;
            (filemd5 = (0, common_1.md5)(file)), (filesha = (0, common_1.sha)(file));
            filename = filename ? String(filename) : "file" + filemd5.toString("hex");
            filestream = stream_1.Readable.from(file, { objectMode: false, highWaterMark: 524288 });
        }
        else {
            file = String(file);
            filesize = (await fs_1.default.promises.stat(file)).size;
            [filemd5, filesha] = await (0, common_1.fileHash)(file);
            filename = filename ? String(filename) : path_1.default.basename(file);
            filestream = fs_1.default.createReadStream(file, { highWaterMark: 524288 });
        }
        const body1700 = core_1.pb.encode({
            1: 1700,
            2: 6,
            19: {
                10: this.c.uin,
                20: this.uid,
                30: filesize,
                40: filename,
                50: filemd5,
                60: filesha,
                70: "/storage/emulated/0/Android/data/com.tencent.mobileqq/Tencent/QQfile_recv/" +
                    filename,
                80: 0,
                90: 0,
                100: 0,
                110: filemd5,
            },
            101: 3,
            102: 104,
            200: 1,
        });
        const payload = await this.c.sendUni("OfflineFilleHandleSvr.pb_ftn_CMD_REQ_APPLY_UPLOAD_V3-1700", body1700);
        const rsp1700 = core_1.pb.decode(payload)[19];
        if (rsp1700[10] !== 0)
            (0, errors_1.drop)(rsp1700[10], rsp1700[20]);
        const fid = rsp1700[90].toBuffer();
        if (!rsp1700[110]) {
            const ext = core_1.pb.encode({
                1: 100,
                2: 2,
                100: {
                    100: {
                        1: 3,
                        100: this.c.uin,
                        200: this.uid,
                        400: 0,
                        700: payload,
                    },
                    200: {
                        100: filesize,
                        200: filemd5,
                        300: filesha,
                        400: filemd5,
                        600: fid,
                        700: rsp1700[220].toBuffer(),
                    },
                    300: {
                        100: 2,
                        200: String(this.c.apk.subid),
                        300: 2,
                        400: "d92615c5",
                        600: 4,
                    },
                    400: {
                        100: filename,
                    },
                },
                200: 1,
            });
            await internal_1.highwayHttpUpload.call(this.c, filestream, {
                md5: filemd5,
                size: filesize,
                cmdid: internal_1.CmdID.OfflineFile,
                ext,
                callback,
            });
        }
        const body800 = core_1.pb.encode({
            1: 800,
            2: 7,
            10: {
                10: this.c.uin,
                20: this.uid,
                30: fid,
            },
            101: 3,
            102: 104,
        });
        await this.c.sendUni("OfflineFilleHandleSvr.pb_ftn_CMD_REQ_UPLOAD_SUCC-800", body800);
        const proto3 = {
            2: {
                1: {
                    1: 0,
                    3: fid,
                    4: filemd5,
                    5: filename,
                    6: filesize,
                    9: 1,
                },
            },
        };
        await this._sendMsg(proto3, `[文件：${filename}]`, true);
        return String(fid);
    }
    /**
     * 撤回离线文件
     * @param fid 文件id
     */
    async recallFile(fid) {
        const body = core_1.pb.encode({
            1: 400,
            2: 0,
            6: {
                1: this.c.uin,
                2: fid,
            },
            101: 3,
            102: 104,
            200: 1,
        });
        const payload = await this.c.sendUni("OfflineFilleHandleSvr.pb_ftn_CMD_REQ_RECALL-400", body);
        const rsp = core_1.pb.decode(payload)[6];
        return rsp[1] === 0;
    }
    /**
     * 转发离线文件
     * @param fid 文件fid
     * @param group_id 群号，转发群文件时填写
     * @returns 转发成功后新文件的id
     */
    async forwardFile(fid, group_id = 0) {
        let new_fid;
        if (group_id > 0) {
            const body = core_1.pb.encode({
                3: {
                    1: group_id,
                    2: 3,
                    3: 102,
                    4: `/${fid}`,
                    5: 3,
                    6: this.uid,
                },
            });
            const payload = await this.c.sendOidbSvcTrpcTcp("OidbSvcTrpcTcp.0x6d9_2", body);
            const rsp = payload[3];
            if (rsp[1] !== 0)
                (0, errors_1.drop)(rsp[1], rsp[2]);
            new_fid = rsp[4];
            const info = await this.getFileInfo(new_fid);
            const proto3 = {
                2: {
                    1: {
                        1: 0,
                        3: new_fid,
                        4: Buffer.from(info.md5, "hex"),
                        5: info.name,
                        6: info.size,
                        9: 1,
                    },
                },
            };
            await this._sendMsg(proto3, `[文件：${info.name}]`, true);
        }
        else {
            const body = core_1.pb.encode({
                1: 700,
                2: 0,
                9: {
                    10: this.c.uin,
                    20: this.uid,
                    30: fid,
                },
                101: 3,
                102: 104,
                200: 1,
            });
            const payload = await this.c.sendUni("OfflineFilleHandleSvr.pb_ftn_CMD_REQ_APPLY_FORWARD_FILE-700", body);
            const rsp = core_1.pb.decode(payload)[9];
            new_fid = rsp[50];
            const ticket = rsp[60];
            if (rsp[10] !== 0)
                (0, errors_1.drop)(rsp[10], rsp[20]);
            const info = await this.getFileInfo(fid);
            const proto3 = {
                2: {
                    1: {
                        1: 0,
                        3: new_fid,
                        4: Buffer.from(info.md5, "hex"),
                        5: info.name,
                        6: info.size,
                        9: 1,
                        57: ticket,
                    },
                },
            };
            await this._sendMsg(proto3, `[文件：${info.name}]`, true);
        }
        return String(new_fid);
    }
    /**
     * 查找机器人与这个人的共群
     * @returns
     */
    async searchSameGroup() {
        let body = core_1.pb.encode({
            "1": 3316,
            "2": 0,
            "3": 0,
            "4": {
                "1": this.c.uin,
                "2": this.uid,
                "4": 1,
                "5": [
                    {
                        "3": {
                            "1": this.c.uin,
                            "2": this.uid,
                        },
                        "5": 3436,
                    },
                    {
                        "3": {
                            "1": {
                                "1": {
                                    "6": `${this.uid}`,
                                },
                                "2": 1,
                            },
                        },
                        "5": 3460,
                    },
                ],
                "6": 0,
            },
            "6": "android 8.9.28",
        });
        const payload = await this.c.sendUni("OidbSvc.0xcf4", body);
        let res = await (0, protobuf_1.decodePb)(payload);
        //console.log();
        //console.log((res as any)[4][12]);
        if (!res[4][12][1]) {
            return [];
        }
        return res[4][12][1].map((item) => {
            return {
                groupName: item["3"],
                Group_Id: item["1"],
            };
        });
    }
}
exports.Friend = Friend;
