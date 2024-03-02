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
exports.bindInternalListeners = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const pngjs_1 = require("pngjs");
const core_1 = require("../core");
const common_1 = require("../common");
const sysmsg_1 = require("./sysmsg");
const pbgetmsg_1 = require("./pbgetmsg");
const onlinepush_1 = require("./onlinepush");
const guild_1 = require("./guild");
async function pushNotifyListener(payload) {
    if (!this._sync_cookie)
        return;
    try {
        var nested = core_1.jce.decodeWrapper(payload.slice(4));
    }
    catch {
        var nested = core_1.jce.decodeWrapper(payload.slice(15));
    }
    switch (nested[5]) {
        case 33: //群员入群
        case 38: //建群
        case 85: //群申请被同意
        case 141: //陌生人
        case 166: //好友
        case 167: //单向好友
        case 208: //好友语音
        case 529: //离线文件
            return pbgetmsg_1.pbGetMsg.call(this);
        case 84: //群请求
        case 87: //群邀请
        case 525: //群请求(来自群员的邀请)
            return sysmsg_1.getGrpSysMsg.call(this);
        case 187: //好友请求
        case 191: //单向好友增加
            return sysmsg_1.getFrdSysMsg.call(this);
        case 528: //黑名单同步
            return this.reloadBlackList();
    }
}
const events = {
    "OnlinePush.PbPushGroupMsg": onlinepush_1.groupMsgListener,
    "OnlinePush.PbPushDisMsg": onlinepush_1.discussMsgListener,
    "OnlinePush.ReqPush": onlinepush_1.onlinePushListener,
    "OnlinePush.PbPushTransMsg": onlinepush_1.onlinePushTransListener,
    "OnlinePush.PbC2CMsgSync": onlinepush_1.dmMsgSyncListener,
    "MessageSvc.PushNotify": pushNotifyListener,
    "MessageSvc.PushReaded": pbgetmsg_1.pushReadedListener,
    // "trpc.group_pro.synclogic.SyncLogic.PushFirstView": guildListPushListener,
    "MsgPush.PushGroupProMsg": guild_1.guildMsgListener,
};
/** 事件总线, 在这里捕获奇怪的错误 */
async function eventsListener(cmd, payload, seq) {
    try {
        await Reflect.get(events, cmd)?.call(this, payload, seq);
    }
    catch (e) {
        this.logger.trace(e);
    }
}
/** 上线后加载资源 */
async function onlineListener(token, nickname, gender, age) {
    this.nickname = nickname;
    this.age = age;
    this.sex = gender ? (gender === 1 ? "male" : "female") : "unknown";
    // 恢复之前的状态
    this.status = this.status || common_1.OnlineStatus.Online;
    this.setOnlineStatus(this.status);
    // 存token
    tokenUpdatedListener.call(this, token);
    this.log_level = this.config.log_level;
    this.logger.mark(`Welcome, ${this.nickname} ! 正在加载资源...`);
    await Promise.allSettled([
        this.reloadFriendList(),
        this.reloadGroupList(),
        this.reloadStrangerList(),
        this.reloadGuilds(),
        this.reloadBlackList(),
    ]);
    this.logger.mark(`加载了${this.fl.size}个好友，${this.gl.size}个群，${this.guilds.size}个频道，${this.sl.size}个陌生人`);
    pbgetmsg_1.pbGetMsg.call(this).catch(common_1.NOOP);
    this.em("system.online");
}
function tokenUpdatedListener(token) {
    if (token == common_1.BUF0)
        return;
    const token_path = path.join(this.dir, this.uin + '_token');
    if (fs.existsSync(token_path))
        fs.renameSync(token_path, token_path + '_bak');
    fs.writeFile(token_path, token, () => {
        fs.unlink(token_path + '_bak', common_1.NOOP);
    });
    this.sig.token_retry_count = 0;
}
function kickoffListener(message) {
    this.logger.warn(message);
    this.terminate();
    //fs.unlink(path.join(this.dir, this.uin + '_token'), NOOP)
    this.em("system.offline.kickoff", { message });
}
function logQrcode(img) {
    const png = pngjs_1.PNG.sync.read(img);
    const color_reset = "\x1b[0m";
    const color_fg_blk = "\x1b[30m";
    const color_bg_blk = "\x1b[40m";
    const color_fg_wht = "\x1b[37m";
    const color_bg_wht = "\x1b[47m";
    for (let i = 36; i < png.height * 4 - 36; i += 24) {
        let line = "";
        for (let j = 36; j < png.width * 4 - 36; j += 12) {
            let r0 = png.data[i * png.width + j];
            let r1 = png.data[i * png.width + j + (png.width * 4 * 3)];
            let bgcolor = (r0 == 255) ? color_bg_wht : color_bg_blk;
            let fgcolor = (r1 == 255) ? color_fg_wht : color_fg_blk;
            line += `${fgcolor + bgcolor}\u2584`;
        }
        console.log(line + color_reset);
    }
    console.log(`${color_fg_blk + color_bg_wht}       请使用 手机QQ 扫描二维码        ${color_reset}`);
    console.log(`${color_fg_blk + color_bg_wht}                                       ${color_reset}`);
}
function qrcodeListener(image) {
    const file = path.join(this.dir, "qrcode.png");
    fs.writeFile(file, image, () => {
        try {
            logQrcode(image);
        }
        catch {
        }
        this.logger.mark("二维码图片已保存到：" + file);
        this.em("system.login.qrcode", { image });
    });
}
function sliderListener(url) {
    this.logger.mark("收到滑动验证码，请访问以下地址完成滑动，并从网络响应中取出ticket输入：" + url);
    this.em("system.login.slider", { url });
}
function verifyListener(url, phone) {
    this.logger.mark("收到登录保护，只需验证一次便长期有效，可以访问URL验证或发短信验证。访问URL完成验证后调用login()可直接登录。发短信验证需要调用sendSmsCode()和submitSmsCode()方法。");
    this.logger.mark("登录保护验证URL：" + url.replace("verify", "qrcode"));
    this.logger.mark("密保手机号：" + phone);
    return this.em("system.login.device", { url, phone });
}
/**
 * 登录相关错误
 * @param code -2服务器忙 -3上线失败(需要删token)
 */
function loginErrorListener(code, message) {
    if (message)
        this.logger.error(message);
    if (this.login_timer)
        return;
    // token expired
    if (!code || code < -100) {
        this.logger.mark("登录token过期");
        this.em('system.token.expire');
        this.sig.token_retry_count++;
        //fs.unlink(path.join(this.dir, this.uin + "_token"), NOOP)
        this.logger.mark("3秒后重新连接");
        this.login_timer = setTimeout(this.login.bind(this), 3000);
    }
    // network error
    else if (code < 0) {
        this.terminate();
        if (code === -3) { //register failed
            //fs.unlink(path.join(this.dir, this.uin + "_token"), NOOP)
            this.sig.token_retry_count = this.token_retry_num - 1;
        }
        const t = this.config.reconn_interval;
        if (t >= 1) {
            this.logger.mark(t + "秒后重新连接");
            this.login_timer = setTimeout(this.login.bind(this, this.uin), t * 1000);
        }
        this.em("system.offline.network", { message });
    }
    // login error
    else if (code > 0) {
        this.em("system.login.error", { code, message });
    }
}
function qrcodeErrorListener(code, message) {
    this.logger.error(`二维码扫码遇到错误: ${code} (${message})`);
    this.logger.mark("二维码已更新");
    this.login();
}
function bindInternalListeners() {
    this.on("internal.online", onlineListener);
    this.on("internal.kickoff", kickoffListener);
    this.on("internal.token", tokenUpdatedListener);
    this.on("internal.qrcode", qrcodeListener);
    this.on("internal.slider", sliderListener);
    this.on("internal.verify", verifyListener);
    this.on("internal.error.token", loginErrorListener);
    this.on("internal.error.login", loginErrorListener);
    this.on("internal.error.qrcode", qrcodeErrorListener);
    this.on("internal.error.network", loginErrorListener);
    this.on("internal.sso", eventsListener);
}
exports.bindInternalListeners = bindInternalListeners;
