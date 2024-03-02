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
Object.defineProperty(exports, "__esModule", { value: true });
exports.createClient = exports.Client = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const log4js = __importStar(require("log4js"));
const core_1 = require("./core");
const common_1 = require("./common");
const internal_1 = require("./internal");
const friend_1 = require("./friend");
const group_1 = require("./group");
const member_1 = require("./member");
const message_1 = require("./message");
const guild_1 = require("./guild");
const errors_1 = require("./errors");
/** 一个客户端 */
class Client extends core_1.BaseClient {
    get [Symbol.toStringTag]() {
        return "OicqClient";
    }
    /** csrf token */
    get bkn() {
        let bkn = 5381;
        for (let v of this.sig.skey)
            bkn = bkn + (bkn << 5) + v;
        bkn &= 2147483647;
        return bkn;
    }
    /** 数据统计 */
    get stat() {
        this.statistics.msg_cnt_per_min = this._calcMsgCntPerMin();
        return this.statistics;
    }
    /** 修改日志级别 */
    set log_level(level) {
        this.logger.level = level;
        this.config.log_level = level;
    }
    constructor(uin, conf) {
        if (typeof uin !== "number")
            conf = uin;
        const config = {
            log_level: "info",
            platform: core_1.Platform.Android,
            auto_server: true,
            ignore_self: true,
            resend: true,
            cache_group_member: true,
            reconn_interval: 5,
            data_dir: path.join(require?.main?.path || process.cwd(), "data"),
            ...conf,
        };
        const dir = path.resolve(config.data_dir);
        createDataDir(dir);
        const file = path.join(dir, `device.json`);
        let device, isNew = false;
        try {
            // device = require(file) as ShortDevice
            const rawFile = fs.readFileSync(file);
            device = JSON.parse(rawFile.toString());
            if (typeof device?.display === "undefined")
                throw new Error();
        }
        catch {
            device = (0, core_1.generateShortDevice)();
            isNew = true;
            fs.writeFileSync(file, JSON.stringify(device, null, 2));
        }
        super(config.platform, device, config);
        /**
         * 得到一个群对象, 通常不会重复创建、调用
         * @param gid 群号
         * @param strict 严格模式，若群不存在会抛出异常
         * @returns 一个`Group`对象
         */
        this.pickGroup = group_1.Group.as.bind(this);
        /**
         * 得到一个好友对象, 通常不会重复创建、调用
         * @param uid 好友账号
         * @param strict 严格模式，若好友不存在会抛出异常
         * @returns 一个`Friend`对象
         */
        this.pickFriend = friend_1.Friend.as.bind(this);
        /**
         * 得到一个群员对象, 通常不会重复创建、调用
         * @param gid 群员所在的群号
         * @param uid 群员的账号
         * @param strict 严格模式，若群员不存在会抛出异常
         * @returns 一个`Member`对象
         */
        this.pickMember = member_1.Member.as.bind(this);
        /**
         * 创建一个用户对象
         * @param uid 用户的账号
         * @returns 一个`User`对象
         */
        this.pickUser = friend_1.User.as.bind(this);
        /**
         * 创建一个讨论组对象
         * @param gid 讨论组号
         * @returns 一个`Discuss`对象
         */
        this.pickDiscuss = group_1.Discuss.as.bind(this);
        /**
         * 创建一个频道对象，通常不会重复创建、调用
         * @param guild_id 频道号
         * @returns 一个`Guild`对象
         */
        this.pickGuild = guild_1.Guild.as.bind(this);
        this._cache = new Map();
        /** 好友列表 */
        this.fl = new Map();
        /** 陌生人列表 */
        this.sl = new Map();
        /** 群列表 */
        this.gl = new Map();
        /** 群员列表缓存 */
        this.gml = new Map();
        /** 我加入的频道列表 */
        this.guilds = new Map();
        /** 黑名单列表 */
        this.blacklist = new Set();
        /** 好友分组 */
        this.classes = new Map();
        /** 勿手动修改这些属性 */
        /** 在线状态 */
        this.status = common_1.OnlineStatus.Offline;
        /** 昵称 */
        this.nickname = "";
        /** 性别 */
        this.sex = "unknown";
        /** 年龄 */
        this.age = 0;
        /** @todo 未知属性 */
        this.bid = "";
        /** 漫游表情缓存 */
        this.stamp = new Set();
        /** 相当于频道中的qq号 */
        this.tiny_id = "";
        /** @todo 未知属性 */
        this.cookies = new Proxy(this.pskey, {
            get: (obj, domain) => {
                const cookie = `uin=o${this.uin}; skey=${this.sig.skey};`;
                if (!obj[domain])
                    return cookie;
                return `${cookie} p_uin=o${this.uin}; p_skey=${obj[domain]};`;
            },
            set: () => {
                return false;
            },
        });
        this.logger = log4js.getLogger("[icqq]");
        if (!config.sign_api_addr) {
            this.logger.warn(`未配置签名API地址，登录/消息发送可能失败`);
        }
        this.setSignServer(config.sign_api_addr);
        if (typeof uin === "number")
            this.uin = uin;
        this.device.mtime = Math.floor(fs.statSync(file).mtimeMs || Date.now());
        this.logger.level = config.log_level;
        if (isNew)
            this.logger.mark("创建了新的设备文件：" + file);
        this.logger.mark("----------");
        this.logger.mark(`Package Version: icqq@${this.pkg.version} (Released on ${this.pkg.upday})`);
        this.logger.mark("View Changelogs：https://github.com/icqqjs/icqq/releases");
        this.logger.mark("----------");
        this.dir = dir;
        this.config = config;
        internal_1.bindInternalListeners.call(this);
        this.on("internal.verbose", (verbose, level, c) => {
            const list = [
                "fatal",
                "mark",
                "error",
                "warn",
                "info",
                "debug",
                "trace",
            ];
            this.logger[list[level]](verbose);
        });
        (0, common_1.lock)(this, "dir");
        (0, common_1.lock)(this, "config");
        (0, common_1.lock)(this, "_cache");
        (0, common_1.lock)(this, "internal");
        (0, common_1.lock)(this, "pickUser");
        (0, common_1.lock)(this, "pickFriend");
        (0, common_1.lock)(this, "pickGroup");
        (0, common_1.lock)(this, "pickDiscuss");
        (0, common_1.lock)(this, "pickMember");
        (0, common_1.lock)(this, "cookies");
        (0, common_1.lock)(this, "fl");
        (0, common_1.lock)(this, "gl");
        (0, common_1.lock)(this, "sl");
        (0, common_1.lock)(this, "gml");
        (0, common_1.lock)(this, "blacklist");
        (0, common_1.hide)(this, "_sync_cookie");
        let n = 0;
        this.heartbeat = () => {
            this._calcMsgCntPerMin();
            n++;
            if (n > 10) {
                n = 0;
                this.setOnlineStatus();
            }
        };
        if (!this.config.auto_server)
            this.setRemoteServer("msfwifi.3g.qq.com", 8080);
    }
    async login(uin, password) {
        // let [uin, password] = args
        if (typeof uin !== "number") {
            password = uin;
            uin = this.uin;
        }
        if (password && password.length > 0) {
            let md5pass;
            if (typeof password === "string")
                md5pass = Buffer.from(password, "hex");
            else
                md5pass = password;
            if (md5pass.length !== 16)
                md5pass = (0, common_1.md5)(String(password));
            this.password_md5 = md5pass;
        }
        if ((await this.switchQQVer())) {
            this.logger.info(`[${uin}]获取到签名Api协议版本：${this.statistics.ver}`);
        }
        const apk_info = `${this.apk.display}_${this.apk.version}`;
        this.logger.info(`[${uin}]使用协议：${apk_info}`);
        this.uin = uin || this.uin;
        await this.updateCmdWhiteList();
        this.login_timer = null;
        try {
            if (!uin)
                throw new Error();
            const token_path = path.join(this.dir, this.uin + "_token");
            if (fs.existsSync(token_path + "_bak"))
                fs.renameSync(token_path + "_bak", token_path);
            if (!fs.existsSync(token_path) || this.token_retry_num <= this.sig.token_retry_count)
                throw new Error();
            const token = await fs.promises.readFile(token_path);
            return this.tokenLogin(token);
        }
        catch (e) {
            if (this.password_md5 && uin) {
                if (this.apk.display === "Watch") {
                    this.logger.warn("手表协议不支持密码登入，将使用扫码登入");
                    return this.sig.qrsig.length ? this.qrcodeLogin() : this.fetchQrcode();
                }
                return this.passwordLogin(uin, this.password_md5);
            }
            else {
                if (this.apk.device_type === -1) {
                    return this.logger.error("当前协议不支持扫码登入，请配置密码重新登入");
                }
                return this.sig.qrsig.length ? this.qrcodeLogin() : this.fetchQrcode();
            }
        }
    }
    /** 设置在线状态 */
    setOnlineStatus(status = this.status || common_1.OnlineStatus.Online) {
        return internal_1.setStatus.call(this, status);
    }
    /** 设置昵称 */
    async setNickname(nickname) {
        return this._setProfile(0x14e22, Buffer.from(String(nickname)));
    }
    /**
     * 设置性别
     * @param gender 0：未知，1：男，2：女
     */
    async setGender(gender) {
        return this._setProfile(0x14e29, Buffer.from([gender]));
    }
    /**
     * 设置生日
     * @param birthday `YYYYMMDD`格式的`string`（会过滤非数字字符）或`number`
     * */
    async setBirthday(birthday) {
        const birth = String(birthday).replace(/[^\d]/g, "");
        const buf = Buffer.allocUnsafe(4);
        buf.writeUInt16BE(Number(birth.substring(0, 4)));
        buf[2] = Number(birth.substring(4, 2));
        buf[3] = Number(birth.substring(6, 2));
        return this._setProfile(0x16593, buf);
    }
    /** 设置个人说明 */
    async setDescription(description = "") {
        return this._setProfile(0x14e33, Buffer.from(String(description)));
    }
    /** 设置个性签名 */
    async setSignature(signature = "") {
        return internal_1.setPersonalSign.call(this, signature);
    }
    /** 获取个性签名 */
    async getSignature() {
        return internal_1.getPersonalSign.call(this);
    }
    /** 设置头像 */
    async setAvatar(file) {
        return internal_1.setAvatar.call(this, new message_1.Image({ type: "image", file }));
    }
    /** 获取漫游表情 */
    getRoamingStamp(no_cache = false) {
        return internal_1.getStamp.call(this, no_cache);
    }
    /** 删除表情(支持批量) */
    deleteStamp(id) {
        return internal_1.delStamp.call(this, id);
    }
    /** 获取系统消息 */
    getSystemMsg() {
        return internal_1.getSysMsg.call(this);
    }
    /** 添加好友分组 */
    addClass(name) {
        return internal_1.addClass.call(this, name);
    }
    /** 删除好友分组 */
    deleteClass(id) {
        return internal_1.delClass.call(this, id);
    }
    /** 重命名好友分组 */
    renameClass(id, name) {
        return internal_1.renameClass.call(this, id, name);
    }
    /** 重载好友列表 */
    reloadFriendList() {
        return internal_1.loadFL.call(this);
    }
    /** 重载陌生人列表 */
    reloadStrangerList() {
        return internal_1.loadSL.call(this);
    }
    /** 重新加载频道列表 */
    reloadGuilds() {
        return internal_1.loadGPL.call(this);
    }
    /** 重载群列表 */
    reloadGroupList() {
        return internal_1.loadGL.call(this);
    }
    /** 重载黑名单 */
    reloadBlackList() {
        return internal_1.loadBL.call(this);
    }
    /** 清空缓存文件 fs.rm need v14.14 */
    cleanCache() {
        const dir = path.join(this.dir, "image");
        fs.rm?.(dir, { recursive: true }, () => {
            fs.mkdir(dir, common_1.NOOP);
        });
    }
    /**
     * 获取视频下载地址
     * use {@link Friend.getVideoUrl}
     */
    getVideoUrl(fid, md5) {
        return this.pickFriend(this.uin).getVideoUrl(fid, md5);
    }
    /**
     * 获取转发消息
     * use {@link Friend.getForwardMsg}
     */
    getForwardMsg(resid, fileName, nt) {
        return this.pickFriend(this.uin).getForwardMsg(resid, fileName, nt);
    }
    /**
     * 制作转发消息
     * use {@link Friend.makeForwardMsg} or {@link Group.makeForwardMsg}
     */
    makeForwardMsg(fake, dm = false, nt) {
        return (dm ? this.pickFriend : this.pickGroup)(this.uin).makeForwardMsg(fake, nt);
    }
    /** Ocr图片转文字 */
    imageOcr(file) {
        return internal_1.imageOcr.call(this, new message_1.Image({ type: "image", file }));
    }
    /** @cqhttp (cqhttp遗留方法) use {@link cookies[domain]} */
    getCookies(domain = "") {
        return this.cookies[domain];
    }
    /** @cqhttp use {@link bkn} */
    getCsrfToken() {
        return this.bkn;
    }
    /** @cqhttp use {@link fl} */
    getFriendList() {
        return this.fl;
    }
    /** @cqhttp use {@link gl} */
    getGroupList() {
        return this.gl;
    }
    /** @cqhttp use {@link guilds} */
    getGuildList() {
        return [...this.guilds.values()].map(guild => {
            return {
                guild_id: guild.guild_id,
                guild_name: guild.guild_name,
            };
        });
    }
    /** @cqhttp use {@link Guild.info} */
    getGuildInfo(guild_id) {
        const guild = this.pickGuild(guild_id);
        if (!guild)
            return null;
        return {
            guild_id: guild.guild_id,
            guild_name: guild.guild_name,
        };
    }
    getChannelInfo(guild_id, channel_id) {
        const guild = this.pickGuild(guild_id);
        if (!guild)
            return null;
        const channel = guild.channels.get(channel_id);
        if (!channel)
            return null;
        return {
            guild_id: guild.guild_id,
            channel_id: channel.channel_id,
            channel_name: channel.channel_name,
            channel_type: channel.channel_type,
        };
    }
    /**
     * 添加群精华消息
     * use {@link Group.addEssence}
     * @param message_id 消息id
     */
    async setEssenceMessage(message_id) {
        if (message_id.length <= 24)
            throw new core_1.ApiRejection(errors_1.ErrorCode.MessageBuilderError, "只能加精群消息");
        const { group_id, seq, rand } = (0, message_1.parseGroupMessageId)(message_id);
        return this.pickGroup(group_id).addEssence(seq, rand);
    }
    /**
     * 移除群精华消息
     * use {@link Group.removeEssence}
     * @param message_id 消息id
     */
    async removeEssenceMessage(message_id) {
        if (message_id.length <= 24)
            throw new core_1.ApiRejection(errors_1.ErrorCode.MessageBuilderError, "消息id无效");
        const { group_id, seq, rand } = (0, message_1.parseGroupMessageId)(message_id);
        return this.pickGroup(group_id).removeEssence(seq, rand);
    }
    /**
     * 获取子频道列表
     * use {@link Guild.channels}
     */
    getChannelList(guild_id) {
        const guild = this.guilds.get(guild_id);
        if (!guild)
            return [];
        return [...guild.channels.values()].map(channel => {
            return {
                guild_id,
                channel_id: channel.channel_id,
                channel_name: channel.channel_name,
                channel_type: channel.channel_type,
            };
        });
    }
    /**
     * 获取频道成员列表
     * use {@link Guild.getMemberList}
     */
    getGuildMemberList(guild_id) {
        const guild = this.guilds.get(guild_id);
        if (!guild)
            return [];
        return guild.getMemberList();
    }
    /** @cqhttp use {@link sl} */
    getStrangerList() {
        return this.sl;
    }
    /** @cqhttp use {@link User.getSimpleInfo} */
    async getStrangerInfo(user_id) {
        return this.pickUser(user_id).getSimpleInfo();
    }
    /** @cqhttp use {@link Group.info} or {@link Group.renew} */
    async getGroupInfo(group_id, no_cache = false) {
        const group = this.pickGroup(group_id);
        if (no_cache)
            return group.renew();
        return group.info || group.renew();
    }
    /** @cqhttp use {@link Group.getMemberMap} */
    async getGroupMemberList(group_id, no_cache = false) {
        return this.pickGroup(group_id).getMemberMap(no_cache);
    }
    /** @cqhttp use {@link Member.info} or {@link Member.renew} */
    async getGroupMemberInfo(group_id, user_id, no_cache = false) {
        if (no_cache || !this.gml.get(group_id)?.has(user_id))
            return this.pickMember(group_id, user_id).renew();
        return this.gml.get(group_id)?.get(user_id);
    }
    /** @cqhttp use {@link Friend.sendMsg} */
    async sendPrivateMsg(user_id, message, source) {
        return this.pickFriend(user_id).sendMsg(message, source);
    }
    /** @cqhttp use {@link Guild.sendMsg} */
    async sendGuildMsg(guild_id, channel_id, message) {
        return this.pickGuild(guild_id).sendMsg(channel_id, message);
    }
    /** @cqhttp use {@link Group.sendMsg} */
    async sendGroupMsg(group_id, message, source) {
        return this.pickGroup(group_id).sendMsg(message, source);
    }
    /** @cqhttp use {@link Group.sign} */
    async sendGroupSign(group_id) {
        return this.pickGroup(group_id).sign();
    }
    /** @cqhttp use {@link Discuss.sendMsg} */
    async sendDiscussMsg(discuss_id, message, source) {
        return this.pickDiscuss(discuss_id).sendMsg(message);
    }
    /** @cqhttp use {@link Member.sendMsg} */
    async sendTempMsg(group_id, user_id, message) {
        return this.pickMember(group_id, user_id).sendMsg(message);
    }
    /** @cqhttp use {@link User.recallMsg} or {@link Group.recallMsg} */
    async deleteMsg(message_id) {
        if (message_id.length > 24) {
            const { group_id, seq, rand, pktnum } = (0, message_1.parseGroupMessageId)(message_id);
            return this.pickGroup(group_id).recallMsg(seq, rand, pktnum);
        }
        else {
            const { user_id, seq, rand, time } = (0, message_1.parseDmMessageId)(message_id);
            return this.pickUser(user_id).recallMsg(seq, rand, time);
        }
    }
    /** @cqhttp use {@link User.markRead} or {@link Group.markRead} */
    async reportReaded(message_id) {
        if (message_id.length > 24) {
            const { group_id, seq } = (0, message_1.parseGroupMessageId)(message_id);
            return this.pickGroup(group_id).markRead(seq);
        }
        else {
            const { user_id, time } = (0, message_1.parseDmMessageId)(message_id);
            return this.pickUser(user_id).markRead(time);
        }
    }
    /** @cqhttp use {@link User.getChatHistory} or {@link Group.getChatHistory} */
    async getMsg(message_id) {
        return (await this.getChatHistory(message_id, 1)).pop();
    }
    /** @cqhttp use {@link User.getChatHistory} or {@link Group.getChatHistory} */
    async getChatHistory(message_id, count = 20) {
        if (message_id.length > 24) {
            const { group_id, seq } = (0, message_1.parseGroupMessageId)(message_id);
            return this.pickGroup(group_id).getChatHistory(seq, count);
        }
        else {
            const { user_id, time } = (0, message_1.parseDmMessageId)(message_id);
            return this.pickUser(user_id).getChatHistory(time, count);
        }
    }
    /** @cqhttp use {@link Group.muteAnony} */
    async setGroupAnonymousBan(group_id, flag, duration = 1800) {
        return this.pickGroup(group_id).muteAnony(flag, duration);
    }
    /** @cqhttp use {@link Group.allowAnony} */
    async setGroupAnonymous(group_id, enable = true) {
        return this.pickGroup(group_id).allowAnony(enable);
    }
    /** @cqhttp use {@link Group.muteAll} */
    async setGroupWholeBan(group_id, enable = true) {
        return this.pickGroup(group_id).muteAll(enable);
    }
    /**
     * 设置当前群成员消息屏蔽状态
     * @param group_id {number} 群号
     * @param member_id {number} 成员QQ号
     * @param isScreen {boolean} 是否屏蔽 默认true
     */
    async setGroupMemberScreenMsg(group_id, member_id, isScreen) {
        return this.pickGroup(group_id).setScreenMemberMsg(member_id, isScreen);
    }
    /** @cqhttp use {@link Group.setName} */
    async setGroupName(group_id, name) {
        return this.pickGroup(group_id).setName(name);
    }
    /** @cqhttp use {@link Group.announce} */
    async sendGroupNotice(group_id, content) {
        return this.pickGroup(group_id).announce(content);
    }
    /** @cqhttp use {@link Group.setAdmin} or {@link Member.setAdmin} */
    async setGroupAdmin(group_id, user_id, enable = true) {
        return this.pickMember(group_id, user_id).setAdmin(enable);
    }
    /** @cqhttp use {@link Group.setTitle} or {@link Member.setTitle} */
    async setGroupSpecialTitle(group_id, user_id, special_title, duration = -1) {
        return this.pickMember(group_id, user_id).setTitle(special_title, duration);
    }
    /** @cqhttp use {@link Group.setCard} or {@link Member.setCard} */
    async setGroupCard(group_id, user_id, card) {
        return this.pickMember(group_id, user_id).setCard(card);
    }
    /** @cqhttp use {@link Group.kickMember} or {@link Member.kick} */
    async setGroupKick(group_id, user_id, reject_add_request = false, message) {
        return this.pickMember(group_id, user_id).kick(message, reject_add_request);
    }
    /** @cqhttp use {@link Group.muteMember} or {@link Member.mute} */
    async setGroupBan(group_id, user_id, duration = 1800) {
        return this.pickMember(group_id, user_id).mute(duration);
    }
    /** @cqhttp use {@link Group.quit} */
    async setGroupLeave(group_id) {
        return this.pickGroup(group_id).quit();
    }
    /** @cqhttp use {@link Group.pokeMember} or {@link Member.poke} */
    async sendGroupPoke(group_id, user_id) {
        return this.pickMember(group_id, user_id).poke();
    }
    /** @cqhttp use {@link Member.addFriend} */
    async addFriend(group_id, user_id, comment = "") {
        return this.pickMember(group_id, user_id).addFriend(comment);
    }
    /** @cqhttp use {@link Friend.delete} */
    async deleteFriend(user_id, block = true) {
        return this.pickFriend(user_id).delete(block);
    }
    /** @cqhttp use {@link Group.invite} */
    async inviteFriend(group_id, user_id) {
        return this.pickGroup(group_id).invite(user_id);
    }
    /** @cqhttp use {@link Friend.thumbUp} */
    async sendLike(user_id, times = 1) {
        return this.pickFriend(user_id).thumbUp(times);
    }
    /** @cqhttp use {@link setAvatar} */
    async setPortrait(file) {
        return this.setAvatar(file);
    }
    /** @cqhttp use {@link Group.setAvatar} */
    async setGroupPortrait(group_id, file) {
        return this.pickGroup(group_id).setAvatar(file);
    }
    /** @cqhttp use {@link Group.fs} */
    acquireGfs(group_id) {
        return this.pickGroup(group_id).fs;
    }
    /** @cqhttp use {@link User.setFriendReq} or {@link User.addFriendBack} */
    async setFriendAddRequest(flag, approve = true, remark = "", block = false) {
        const { user_id, seq, single } = (0, internal_1.parseFriendRequestFlag)(flag);
        const user = this.pickUser(user_id);
        return single
            ? user.addFriendBack(seq, remark)
            : user.setFriendReq(seq, approve, remark, block);
    }
    /** @cqhttp use {@link User.setGroupInvite} or {@link User.setGroupReq} */
    async setGroupAddRequest(flag, approve = true, reason = "", block = false) {
        const { group_id, user_id, seq, invite } = (0, internal_1.parseGroupRequestFlag)(flag);
        const user = this.pickUser(user_id);
        return invite
            ? user.setGroupInvite(group_id, seq, approve, block)
            : user.setGroupReq(group_id, seq, approve, reason, block);
    }
    /**
     * 监听群邀请/消息事件
     * @param group_ids 监听群的群号
     * @returns 事件处理
     */
    group(...group_ids) {
        return (listener) => {
            return this.trap((eventName, event) => {
                return group_ids.includes(event.group_id);
            }, listener);
        };
    }
    /**
     * 监听用户私聊/群聊事件
     * @param user_ids 监听的用户账号
     * @returns 事件处理
     */
    user(...user_ids) {
        return (listener) => {
            return this.trap((eventName, event) => {
                return user_ids.includes(event.user_id);
            }, listener);
        };
    }
    /** emit an event */
    em(name = "", data) {
        data = Object.defineProperty(data || {}, "self_id", {
            value: this.uin,
            writable: true,
            enumerable: true,
            configurable: true,
        });
        while (true) {
            this.emit(name, data);
            let i = name.lastIndexOf(".");
            if (i === -1)
                break;
            name = name.slice(0, i);
        }
    }
    _msgExists(from, type, seq, time) {
        if ((0, common_1.timestamp)() + this.sig.time_diff - time >= 60 || time < this.stat.start_time)
            return true;
        const id = [from, type, seq].join("-");
        const set = this._cache.get(time);
        if (!set) {
            this._cache.set(time, new Set([id]));
            return false;
        }
        else {
            if (set.has(id))
                return true;
            else
                set.add(id);
            return false;
        }
    }
    _calcMsgCntPerMin() {
        let cnt = 0;
        for (let [time, set] of this._cache) {
            if ((0, common_1.timestamp)() - time >= 60)
                this._cache.delete(time);
            else
                cnt += set.size;
        }
        return cnt;
    }
    async _setProfile(k, v) {
        const buf = Buffer.allocUnsafe(11 + v.length);
        buf.writeUInt32BE(this.uin);
        buf.writeUInt8(0, 4);
        buf.writeInt32BE(k, 5);
        buf.writeUInt16BE(v.length, 9);
        buf.fill(v, 11);
        const payload = await this.sendOidb("OidbSvc.0x4ff_9", buf);
        const obj = core_1.pb.decode(payload);
        return obj[3] === 0 || obj[3] === 34;
    }
    /** @deprecated use {@link submitSlider} */
    sliderLogin(ticket) {
        return this.submitSlider(ticket);
    }
    /** @deprecated use {@link sendSmsCode} */
    sendSMSCode() {
        return this.sendSmsCode();
    }
    /** @deprecated use {@link submitSmsCode} */
    submitSMSCode(code) {
        return this.submitSmsCode(code);
    }
    /** @deprecated use {@link status} */
    get online_status() {
        return this.status;
    }
}
exports.Client = Client;
function createDataDir(dir) {
    if (!fs.existsSync(dir))
        fs.mkdirSync(dir, { mode: 0o755, recursive: true });
    const img_path = path.join(dir, "image");
    if (!fs.existsSync(img_path))
        fs.mkdirSync(img_path);
}
/** 创建一个客户端 (=new Client) */
function createClient(config) {
    return new Client(config);
}
exports.createClient = createClient;
