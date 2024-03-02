"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getApiQQVer = exports.submitSsoPacket = exports.requestSignToken = exports.getSign = exports.getT544 = void 0;
const axios_1 = __importDefault(require("axios"));
const base_client_1 = require("./base-client");
const constants_1 = require("./constants");
async function getT544(cmd) {
    let sign = constants_1.BUF0;
    if (this.sig.sign_api_addr && this.apk.qua) {
        const time = Date.now();
        let qImei36 = this.device.qImei36 || this.device.qImei16;
        let post_params = {
            ver: this.apk.ver,
            uin: this.uin || 0,
            data: cmd,
            android_id: this.device.android_id,
            qimei36: qImei36 || this.device.android_id,
            guid: this.device.guid.toString('hex'),
            version: this.apk.sdkver
        };
        let url = new URL(this.sig.sign_api_addr);
        let path = url.pathname;
        if (path.substring(path.length - 1) === '/') {
            path += 'energy';
        }
        else {
            path = path.replace(/\/sign$/, '/energy');
        }
        url.pathname = path;
        const data = await get.bind(this)(url.href, post_params);
        const log = `[qsign]getT544:${cmd} result(${Date.now() - time}ms):${JSON.stringify(data)}`;
        if (data.code === 0) {
            this.emit("internal.verbose", log, base_client_1.VerboseLevel.Debug);
            if (typeof (data.data) === 'string') {
                sign = Buffer.from(data.data, 'hex');
            }
            else if (typeof (data.data?.sign) === 'string') {
                sign = Buffer.from(data.data.sign, 'hex');
            }
        }
        else {
            if (data.code === 1) {
                if (data.msg.includes('Uin is not registered.')) {
                    if (await register.call(this)) {
                        return await this.getT544(cmd);
                    }
                }
            }
            this.emit("internal.verbose", `签名api异常：${log}`, base_client_1.VerboseLevel.Error);
        }
    }
    return this.generateT544Packet(cmd, sign);
}
exports.getT544 = getT544;
async function getSign(cmd, seq, body) {
    let params = constants_1.BUF0;
    if (!this.sig.sign_api_addr) {
        return params;
    }
    let qImei36 = this.device.qImei36 || this.device.qImei16;
    if (this.apk.qua) {
        const time = Date.now();
        let post_params = {
            qua: this.apk.qua,
            uin: this.uin || 0,
            cmd: cmd,
            seq: seq,
            android_id: this.device.android_id,
            qimei36: qImei36 || this.device.android_id,
            buffer: body.toString('hex'),
            guid: this.device.guid.toString('hex'),
        };
        let url = new URL(this.sig.sign_api_addr);
        let path = url.pathname;
        if (path.substring(path.length - 1) === '/') {
            path += 'sign';
        }
        url.pathname = path;
        const data = await get.bind(this)(url.href, post_params, true);
        const log = `[qsign]sign:${cmd} seq:${seq} result(${Date.now() - time}ms):${JSON.stringify(data)}`;
        if (data.code === 0) {
            this.emit("internal.verbose", log, base_client_1.VerboseLevel.Debug);
            const Data = data.data || {};
            params = this.generateSignPacket(Data.sign, Data.token, Data.extra);
            let list = Data.ssoPacketList || Data.requestCallback || [];
            if (list.length > 0)
                this.ssoPacketListHandler(list);
        }
        else {
            if (data.code === 1) {
                if (data.msg.includes('Uin is not registered.')) {
                    if (await register.call(this)) {
                        return await this.getSign(cmd, seq, body);
                    }
                }
            }
            this.emit("internal.verbose", `签名api异常：${log}`, base_client_1.VerboseLevel.Error);
        }
    }
    return params;
}
exports.getSign = getSign;
async function requestSignToken() {
    if (!this.sig.sign_api_addr) {
        return [];
    }
    let qImei36 = this.device.qImei36 || this.device.qImei16;
    if (this.apk.qua) {
        const time = Date.now();
        let post_params = {
            uin: this.uin || 0,
            android_id: this.device.android_id,
            qimei36: qImei36 || this.device.android_id,
            guid: this.device.guid.toString('hex'),
        };
        let url = new URL(this.sig.sign_api_addr);
        let path = url.pathname;
        if (path.substring(path.length - 1) === '/') {
            path += 'request_token';
        }
        else {
            path = path.replace(/\/sign$/, '/request_token');
        }
        url.pathname = path;
        const data = await get.bind(this)(url.href, post_params);
        this.emit("internal.verbose", `[qsign]requestSignToken result(${Date.now() - time}ms): ${JSON.stringify(data)}`, base_client_1.VerboseLevel.Debug);
        if (data.code === 0) {
            let ssoPacketList = data.data?.ssoPacketList || data.data?.requestCallback || data.data;
            if (!ssoPacketList || ssoPacketList.length < 1)
                return [];
            return ssoPacketList;
        }
        else if (data.code === 1) {
            if (data.msg.includes('Uin is not registered.')) {
                if (await register.call(this)) {
                    return await this.requestSignToken();
                }
            }
        }
    }
    return [];
}
exports.requestSignToken = requestSignToken;
async function submitSsoPacket(cmd, callbackId, body) {
    if (!this.sig.sign_api_addr) {
        return [];
    }
    let qImei36 = this.device.qImei36 || this.device.qImei16;
    if (this.apk.qua) {
        const time = Date.now();
        let post_params = {
            ver: this.apk.ver,
            qua: this.apk.qua,
            uin: this.uin || 0,
            cmd: cmd,
            callback_id: callbackId,
            android_id: this.device.android_id,
            qimei36: qImei36 || this.device.android_id,
            buffer: body.toString('hex'),
            guid: this.device.guid.toString('hex'),
        };
        let url = new URL(this.sig.sign_api_addr);
        let path = url.pathname;
        if (path.substring(path.length - 1) === '/') {
            path += 'submit';
        }
        else {
            path = path.replace(/\/sign$/, '/submit');
        }
        url.pathname = path;
        const data = await get.bind(this)(url.href, post_params);
        this.emit("internal.verbose", `[qsign]submitSsoPacket result(${Date.now() - time}ms): ${JSON.stringify(data)}`, base_client_1.VerboseLevel.Debug);
        if (data.code === 0) {
            let ssoPacketList = data.data?.ssoPacketList || data.data?.requestCallback || data.data;
            if (!ssoPacketList || ssoPacketList.length < 1)
                return [];
            return ssoPacketList;
        }
    }
    return [];
}
exports.submitSsoPacket = submitSsoPacket;
async function register() {
    let qImei36 = this.device.qImei36 || this.device.qImei16;
    const time = Date.now();
    let post_params = {
        uin: this.uin || 0,
        android_id: this.device.android_id,
        qimei36: qImei36,
        guid: this.device.guid.toString('hex')
    };
    let url = new URL(this.sig.sign_api_addr);
    let path = url.pathname;
    if (path.substring(path.length - 1) === '/') {
        path += 'register';
    }
    else {
        path = path.replace(/\/sign$/, '/register');
    }
    url.pathname = path;
    const data = await get.bind(this)(url.href, post_params);
    this.emit("internal.verbose", `[qsign]register result(${Date.now() - time}ms): ${JSON.stringify(data)}`, base_client_1.VerboseLevel.Debug);
    if (data.code == 0) {
        return true;
    }
    ;
    this.emit("internal.verbose", `[qsign]签名api注册异常：result(${Date.now() - time}ms): ${JSON.stringify(data)}`, base_client_1.VerboseLevel.Error);
    return false;
}
async function getApiQQVer() {
    let QQVer = this.config.ver;
    if (!this.sig.sign_api_addr) {
        return QQVer;
    }
    const apks = this.getApkInfoList(this.config.platform);
    const packageName = this.apk.id;
    let url = new URL(this.sig.sign_api_addr);
    let path = url.pathname;
    if (path.substring(path.length - 1) != '/') {
        path = path.replace(/\/sign$/, '/');
    }
    url.pathname = path;
    const data = await get.bind(this)(url.href);
    if (data.code === 0) {
        const ver = data?.data?.protocol?.version;
        if (ver) {
            if (apks.find(val => val.ver === ver)) {
                QQVer = ver;
            }
        }
    }
    return QQVer;
}
exports.getApiQQVer = getApiQQVer;
async function get(url, params = {}, post = false) {
    const config = {
        timeout: 30000,
        headers: {
            'User-Agent': `icqq@${this.pkg.version} (Released on ${this.pkg.upday})`,
            'Content-Type': "application/x-www-form-urlencoded"
        }
    };
    let data = { code: -1 };
    let num = 0;
    while (data.code == -1 && num < 3) {
        if (num > 0)
            await new Promise((resolve) => setTimeout(resolve, 2000));
        num++;
        if (post) {
            data = await axios_1.default.post(url, params, config).catch(err => ({ data: { code: -1, msg: err?.message } }));
        }
        else {
            config.params = params;
            data = await axios_1.default.get(url, config).catch(err => ({ data: { code: -1, msg: err?.message } }));
        }
        data = data.data;
    }
    return data;
}
