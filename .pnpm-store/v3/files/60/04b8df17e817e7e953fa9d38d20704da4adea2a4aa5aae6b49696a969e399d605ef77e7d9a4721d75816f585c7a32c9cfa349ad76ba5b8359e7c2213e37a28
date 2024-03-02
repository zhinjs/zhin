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
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OnlineStatus = exports.MAX_UPLOAD_SIZE = exports.TMP_DIR = exports.IS_WIN = exports.PB_CONTENT = exports.DownloadTransform = exports.log = exports.escapeXml = exports.parseFunString = exports.uin2code = exports.code2uin = exports.fileHash = exports.md5Stream = exports.uuid = void 0;
const fs = __importStar(require("fs"));
const crypto = __importStar(require("crypto"));
const stream = __importStar(require("stream"));
const util = __importStar(require("util"));
const os = __importStar(require("os"));
const pb = __importStar(require("./core/protobuf"));
function uuid() {
    let hex = crypto.randomBytes(16).toString("hex");
    return (hex.substring(0, 8) +
        "-" +
        hex.substring(8, 4) +
        "-" +
        hex.substr(12, 4) +
        "-" +
        hex.substring(16, 4) +
        "-" +
        hex.substring(20));
}
exports.uuid = uuid;
/** 计算流的md5 */
function md5Stream(readable) {
    return new Promise((resolve, reject) => {
        readable.on("error", reject);
        readable.pipe(crypto.createHash("md5").on("error", reject).on("data", resolve));
    });
}
exports.md5Stream = md5Stream;
/** 计算文件的md5和sha */
function fileHash(filepath) {
    const readable = fs.createReadStream(filepath);
    const sha = new Promise((resolve, reject) => {
        readable.on("error", reject);
        readable.pipe(crypto.createHash("sha1").on("error", reject).on("data", resolve));
    });
    return Promise.all([md5Stream(readable), sha]);
}
exports.fileHash = fileHash;
/** 群号转uin */
function code2uin(code) {
    let left = Math.floor(code / 1000000);
    if (left >= 0 && left <= 10)
        left += 202;
    else if (left >= 11 && left <= 19)
        left += 469;
    else if (left >= 20 && left <= 66)
        left += 2080;
    else if (left >= 67 && left <= 156)
        left += 1943;
    else if (left >= 157 && left <= 209)
        left += 1990;
    else if (left >= 210 && left <= 309)
        left += 3890;
    else if (left >= 310 && left <= 335)
        left += 3490;
    else if (left >= 336 && left <= 386)
        left += 2265;
    else if (left >= 387 && left <= 499)
        left += 3490;
    return left * 1000000 + (code % 1000000);
}
exports.code2uin = code2uin;
/** uin转群号 */
function uin2code(uin) {
    let left = Math.floor(uin / 1000000);
    if (left >= 202 && left <= 212)
        left -= 202;
    else if (left >= 480 && left <= 488)
        left -= 469;
    else if (left >= 2100 && left <= 2146)
        left -= 2080;
    else if (left >= 2010 && left <= 2099)
        left -= 1943;
    else if (left >= 2147 && left <= 2199)
        left -= 1990;
    else if (left >= 2600 && left <= 2651)
        left -= 2265;
    else if (left >= 3800 && left <= 3989)
        left -= 3490;
    else if (left >= 4100 && left <= 4199)
        left -= 3890;
    return left * 1000000 + (uin % 1000000);
}
exports.uin2code = uin2code;
/** 解析彩色群名片 */
function parseFunString(buf) {
    if (buf[0] === 0xa) {
        let res = "";
        try {
            let arr = pb.decode(buf)[1];
            if (!Array.isArray(arr))
                arr = [arr];
            for (let v of arr) {
                if (v[2])
                    res += String(v[2]);
            }
        }
        catch { }
        return res;
    }
    else {
        return String(buf);
    }
}
exports.parseFunString = parseFunString;
/** xml转义 */
function escapeXml(str) {
    return str.replace(/[&"><]/g, function (s) {
        if (s === "&")
            return "&amp;";
        if (s === "<")
            return "&lt;";
        if (s === ">")
            return "&gt;";
        if (s === '"')
            return "&quot;";
        return "";
    });
}
exports.escapeXml = escapeXml;
function log(any) {
    if (any instanceof Buffer)
        any = any.toString("hex").replace(/(.)(.)/g, "$1$2 ");
    console.log(util.inspect(any, {
        depth: 20,
        showHidden: false,
        maxArrayLength: 1000,
        maxStringLength: 20000,
    }));
}
exports.log = log;
/** 用于下载限量 */
class DownloadTransform extends stream.Transform {
    constructor() {
        super(...arguments);
        this._size = 0;
    }
    _transform(data, encoding, callback) {
        this._size += data.length;
        let error = null;
        if (this._size <= exports.MAX_UPLOAD_SIZE)
            this.push(data);
        else
            error = new Error("downloading over 30MB is refused");
        callback(error);
    }
}
exports.DownloadTransform = DownloadTransform;
exports.PB_CONTENT = pb.encode({ 1: 1, 2: 0, 3: 0 });
exports.IS_WIN = os.platform() === "win32";
/** 系统临时目录，用于临时存放下载的图片等内容 */
exports.TMP_DIR = os.tmpdir();
/** 最大上传和下载大小，以图片上传限制为准：30MB */
exports.MAX_UPLOAD_SIZE = 31457280;
/** 可设置的在线状态 */
var OnlineStatus;
(function (OnlineStatus) {
    /** 离线 */
    OnlineStatus[OnlineStatus["Offline"] = 0] = "Offline";
    /** 在线 */
    OnlineStatus[OnlineStatus["Online"] = 11] = "Online";
    /** 离开 */
    OnlineStatus[OnlineStatus["Absent"] = 31] = "Absent";
    /** 隐身 */
    OnlineStatus[OnlineStatus["Invisible"] = 41] = "Invisible";
    /** 忙碌 */
    OnlineStatus[OnlineStatus["Busy"] = 50] = "Busy";
    /** Q我吧 */
    OnlineStatus[OnlineStatus["Qme"] = 60] = "Qme";
    /** 请勿打扰 */
    OnlineStatus[OnlineStatus["DontDisturb"] = 70] = "DontDisturb";
})(OnlineStatus || (exports.OnlineStatus = OnlineStatus = {}));
__exportStar(require("./core/constants"), exports);
