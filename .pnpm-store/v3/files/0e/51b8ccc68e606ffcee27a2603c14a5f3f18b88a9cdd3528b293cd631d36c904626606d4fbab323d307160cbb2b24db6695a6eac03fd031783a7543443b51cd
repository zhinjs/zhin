"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ForwardMessage = exports.DiscussMessage = exports.GroupMessage = exports.PrivateMessage = exports.Message = exports.parseGroupMessageId = exports.genGroupMessageId = exports.parseDmMessageId = exports.genDmMessageId = exports.uuid2rand = exports.rand2uuid = void 0;
const qs = __importStar(require("querystring"));
const core_1 = require("../core");
const common_1 = require("../common");
const parser_1 = require("./parser");
const querystring_1 = __importDefault(require("querystring"));
function rand2uuid(rand) {
    return 16777216n << 32n | BigInt(rand);
}
exports.rand2uuid = rand2uuid;
function uuid2rand(uuid) {
    return Number(BigInt(uuid) & 0xffffffffn);
}
exports.uuid2rand = uuid2rand;
/** @cqhttp 生成私聊消息id */
function genDmMessageId(uid, seq, rand, time, flag = 0) {
    const buf = Buffer.allocUnsafe(17);
    buf.writeUInt32BE(uid);
    buf.writeInt32BE(seq & 0xffffffff, 4);
    buf.writeInt32BE(rand & 0xffffffff, 8);
    buf.writeUInt32BE(time, 12);
    buf.writeUInt8(flag, 16); //接收为0 发送为1
    return buf.toString("base64");
}
exports.genDmMessageId = genDmMessageId;
/** @cqhttp 解析私聊消息id */
function parseDmMessageId(msgid) {
    const buf = Buffer.from(msgid, "base64");
    const user_id = buf.readUInt32BE(), seq = buf.readUInt32BE(4), rand = buf.readUInt32BE(8), time = buf.readUInt32BE(12), flag = buf.length >= 17 ? buf.readUInt8(16) : 0;
    return { user_id, seq, rand, time, flag };
}
exports.parseDmMessageId = parseDmMessageId;
/** @cqhttp 生成群消息id */
function genGroupMessageId(gid, uid, seq, rand, time, pktnum = 1) {
    const buf = Buffer.allocUnsafe(21);
    buf.writeUInt32BE(gid);
    buf.writeUInt32BE(uid, 4);
    buf.writeInt32BE(seq & 0xffffffff, 8);
    buf.writeInt32BE(rand & 0xffffffff, 12);
    buf.writeUInt32BE(time, 16);
    buf.writeUInt8(pktnum > 1 ? pktnum : 1, 20);
    return buf.toString("base64");
}
exports.genGroupMessageId = genGroupMessageId;
/** @cqhttp 解析群消息id */
function parseGroupMessageId(msgid) {
    const buf = Buffer.from(msgid, "base64");
    const group_id = buf.readUInt32BE(), user_id = buf.readUInt32BE(4), seq = buf.readUInt32BE(8), rand = buf.readUInt32BE(12), time = buf.readUInt32BE(16), pktnum = buf.length >= 21 ? buf.readUInt8(20) : 1;
    return { group_id, user_id, seq, rand, time, pktnum };
}
exports.parseGroupMessageId = parseGroupMessageId;
/** 一条消息 */
class Message {
    /** 发送方昵称，仅供内部转发消息时使用 */
    get nickname() {
        return this.sender?.card || this.sender?.nickname || "";
    }
    /** 反序列化一条消息 (私聊消息需要你的uin) */
    static deserialize(serialized, uin) {
        const proto = core_1.pb.decode(serialized);
        switch (proto[1][3]) {
            case 82:
                return new GroupMessage(proto);
            case 83:
                return new DiscussMessage(proto);
            default:
                return new PrivateMessage(proto, uin);
        }
    }
    /** 组合分片消息(通常仅内部使用) */
    static combine(msgs) {
        msgs.sort((a, b) => a.index - b.index);
        const host = msgs[0];
        let chain = host.message;
        for (const guest of msgs.slice(1)) {
            if (guest.atme)
                host.atme = true;
            if (guest.atall)
                host.atall = true;
            host.raw_message += guest.raw_message;
            for (const elem of guest.message) {
                const prev = chain[chain.length - 1];
                if (elem.type === "text" && prev?.type === "text")
                    prev.text += elem.text;
                else
                    chain.push(elem);
            }
        }
        return host;
    }
    constructor(proto) {
        this.proto = proto;
        this.post_type = "message";
        /** @cqhttp cqhttp方法用 */
        this.message_id = "";
        this.proto = proto;
        const head = proto[1], frag = proto[2], body = proto[3];
        this.pktnum = frag[1];
        this.index = frag[2];
        this.div = frag[3];
        this.user_id = head[1];
        this.time = head[6];
        this.seq = head[5];
        this.rand = proto[3]?.[1]?.[1]?.[3] || uuid2rand(head[7]);
        this.font = body[1]?.[1]?.[9]?.toString() || "unknown";
        this.parsed = (0, parser_1.parse)(body[1], head[2]);
        this.message = this.parsed.message;
        this.raw_message = this.parsed.brief;
        if (this.parsed.quotation) {
            const q = this.parsed.quotation;
            this.source = {
                user_id: q[2],
                time: q[3],
                seq: q[1]?.[0] || q[1],
                rand: uuid2rand(q[8]?.[3] || 0),
                message: (0, parser_1.parse)(Array.isArray(q[5]) ? q[5] : [q[5]]).brief,
            };
        }
        (0, common_1.lock)(this, "proto");
        (0, common_1.lock)(this, "parsed");
        (0, common_1.lock)(this, "pktnum");
        (0, common_1.lock)(this, "index");
        (0, common_1.lock)(this, "div");
    }
    /** 将消息序列化保存 */
    serialize() {
        return this.proto.toBuffer();
    }
    /** 以适合人类阅读的形式输出 */
    toString() {
        return this.parsed.content;
    }
    toJSON(keys) {
        return Object.fromEntries(Object.keys(this).filter((key) => {
            return typeof this[key] !== "function" && !keys.includes(key);
        }).map(key => {
            return [key, this[key]];
        }));
    }
    /** @deprecated 转换为CQ码 */
    toCqcode() {
        const mCQInside = {
            "&": "&amp;",
            ",": "&#44;",
            "[": "&#91;",
            "]": "&#93;",
        };
        let cqcode = "";
        if (this.source) {
            const quote = { ...this.source, flag: 1 };
            const mid = genDmMessageId(this.user_id, quote.seq, quote.rand, quote.time, quote.flag);
            cqcode += `[CQ:reply,id=${mid}]`;
        }
        (this.message || []).forEach((c) => {
            if ("text" === c.type) {
                cqcode += c.text;
                return;
            }
            const s = querystring_1.default.stringify(c, ",", "=", {
                encodeURIComponent: (s) => s.replace(new RegExp(Object.keys(mCQInside).join("|"), "g"), ((s) => mCQInside[s] || "")),
            });
            const cq = `[CQ:${c.type}${s ? "," : ""}${s}]`;
            cqcode += cq;
        });
        return cqcode;
    }
}
exports.Message = Message;
/** 一条私聊消息 */
class PrivateMessage extends Message {
    /** 反序列化一条私聊消息，你需要传入你的`uin`，否则无法知道你是发送者还是接收者 */
    static deserialize(serialized, uin) {
        return new PrivateMessage(core_1.pb.decode(serialized), uin);
    }
    constructor(proto, uin) {
        super(proto);
        this.message_type = "private";
        /**
         * @type {"friend"} 好友
         * @type {"group"} 群临时会话
         * @type {"other"} 其他途径的临时会话
         * @type {"self"} 我的设备
         */
        this.sub_type = "friend";
        /** 发送方信息 */
        this.sender = {
            /** 账号 */
            user_id: 0,
            /** 昵称 */
            nickname: "",
            /** 群号，当消息来自群聊时有效 */
            group_id: undefined,
            /** 讨论组号，当消息来自讨论组时有效 */
            discuss_id: undefined,
        };
        const head = proto[1], content = proto[2], body = proto[3];
        this.from_id = this.sender.user_id = head[1];
        this.to_id = head[2];
        this.auto_reply = !!(content && content[4]);
        switch (head[3]) {
            case 529:
                if (head[4] === 4) {
                    const trans = body[2][1];
                    if (trans[1] !== 0)
                        throw new Error("unsupported message (ignore ok)");
                    const elem = {
                        type: "file",
                        name: String(trans[5]),
                        size: trans[6],
                        md5: trans[4]?.toHex() || "",
                        duration: trans[51] || 0,
                        fid: String(trans[3]),
                    };
                    this.message = [elem];
                    this.raw_message = "[离线文件]";
                    this.parsed.content = `{file:${elem.fid}}`;
                }
                else {
                    this.sub_type = this.from_id === this.to_id ? "self" : "other";
                    this.message = this.raw_message = this.parsed.content = body[2]?.[6]?.[5]?.[1]?.[2]?.toString() || "";
                }
                break;
            case 141:
                this.sub_type = "group";
                this.sender.nickname = this.parsed.extra?.[1]?.toString() || "";
                if (head[8]?.[3])
                    this.sender.group_id = head[8]?.[4];
                else
                    this.sender.discuss_id = head[8]?.[4];
                break;
        }
        let opposite = this.from_id, flag = 0;
        if (this.from_id === uin)
            opposite = this.to_id, flag = 1;
        this.message_id = genDmMessageId(opposite, this.seq, this.rand, this.time, flag);
    }
}
exports.PrivateMessage = PrivateMessage;
/** 一条群消息 */
class GroupMessage extends Message {
    /** 反序列化一条群消息 */
    static deserialize(serialized) {
        return new GroupMessage(core_1.pb.decode(serialized));
    }
    constructor(proto) {
        super(proto);
        this.message_type = "group";
        /** 发送方信息 */
        this.sender = {
            /** 账号 */
            user_id: 0,
            /** 昵称 */
            nickname: "",
            /** @todo 未知属性 */
            sub_id: "",
            /** 名片 */
            card: "",
            /** 性别，@deprecated */
            sex: "unknown",
            /** 年龄，@deprecated */
            age: 0,
            /** 地区，@deprecated */
            area: "",
            /** 等级 */
            level: 0,
            /** 权限 */
            role: "member",
            /** 头衔 */
            title: ""
        };
        const group = proto[1][9];
        this.group_id = group[1] || 0;
        this.group_name = group[8]?.toString() || "";
        this.block = group[2] === 127;
        this.sender.user_id = proto[1][1];
        this.sender.sub_id = proto[1][11];
        if (this.parsed.anon) {
            this.sub_type = "anonymous";
            this.anonymous = {
                id: this.parsed.anon[6],
                id2: this.parsed.anon[4],
                name: String(this.parsed.anon[3]),
                color: String(this.parsed.anon[7]),
                expire_time: this.parsed.anon[5],
                flag: String(this.parsed.anon[3]) + "@" + this.parsed.anon[2].toBase64(),
                enable: true,
            };
            this.sender.card = this.sender.nickname = "匿名消息";
        }
        else {
            this.sub_type = "normal";
            this.anonymous = null;
            const ext = this.parsed.extra;
            if (!ext?.[2])
                this.sender.nickname = ext?.[1]?.toString() || "";
            else
                this.sender.nickname = this.sender.card = (0, common_1.parseFunString)(group[4].toBuffer());
            if (ext?.[4])
                this.sender.role = ext[4] === 8 ? "owner" : "admin";
            this.sender.level = ext?.[3] || 0;
            this.sender.title = ext?.[7]?.toString() || "";
        }
        this.atme = this.parsed.atme;
        this.atall = this.parsed.atall;
        this.message_id = genGroupMessageId(this.group_id, this.user_id, this.seq, this.rand, this.time, this.pktnum);
    }
}
exports.GroupMessage = GroupMessage;
/** 一条讨论组消息 */
class DiscussMessage extends Message {
    /** 反序列化一条讨论组消息 */
    static deserialize(serialized) {
        return new DiscussMessage(core_1.pb.decode(serialized));
    }
    constructor(proto) {
        super(proto);
        this.message_type = "discuss";
        const discuss = proto[1][13];
        this.discuss_id = discuss[1] || 0;
        this.discuss_name = discuss[5]?.toString() || "";
        this.atme = this.parsed.atme;
        const card = discuss[4]?.toString() || "";
        this.sender = {
            user_id: proto[1][1],
            nickname: card,
            card: card,
        };
        this.rand = proto[3][1][1][3];
    }
}
exports.DiscussMessage = DiscussMessage;
/** 一条转发消息 */
class ForwardMessage {
    /** 反序列化一条转发消息 */
    static deserialize(serialized) {
        return new ForwardMessage(core_1.pb.decode(serialized));
    }
    constructor(proto) {
        this.proto = proto;
        this.proto = proto;
        const head = proto[1];
        this.time = head[6] || 0;
        this.seq = head[5];
        this.user_id = head[1] || 0;
        this.nickname = head[14]?.toString() || head[9]?.[4]?.toString() || "";
        this.group_id = head[9]?.[1];
        this.parsed = (0, parser_1.parse)(proto[3][1]);
        this.message = this.parsed.message;
        this.raw_message = this.parsed.brief;
        (0, common_1.lock)(this, "proto");
        (0, common_1.lock)(this, "parsed");
    }
    /** 将转发消息序列化保存 */
    serialize() {
        return this.proto.toBuffer();
    }
    /** 以适合人类阅读的形式输出 */
    toString() {
        return this.parsed.content;
    }
    /** @deprecated 转换为CQ码 */
    toCqcode() {
        return genCqcode(this.message);
    }
}
exports.ForwardMessage = ForwardMessage;
function escapeCQInside(s) {
    if (s === "&")
        return "&amp;";
    if (s === ",")
        return "&#44;";
    if (s === "[")
        return "&#91;";
    if (s === "]")
        return "&#93;";
    return "";
}
function genCqcode(content) {
    let cqcode = "";
    for (let elem of content) {
        if (elem.type === "text") {
            cqcode += elem.text;
            continue;
        }
        const tmp = { ...elem };
        delete tmp.type;
        const str = qs.stringify(tmp, ",", "=", { encodeURIComponent: (s) => s.replace(/&|,|\[|\]/g, escapeCQInside) });
        cqcode += "[CQ:" + elem.type + (str ? "," : "") + str + "]";
    }
    return cqcode;
}
