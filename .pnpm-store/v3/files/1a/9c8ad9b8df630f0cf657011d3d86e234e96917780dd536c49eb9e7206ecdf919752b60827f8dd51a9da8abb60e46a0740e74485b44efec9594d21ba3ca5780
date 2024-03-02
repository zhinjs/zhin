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
exports.hide = exports.unlock = exports.lock = exports.int32ip2str = exports.timestamp = exports.formatTime = exports.randomString = exports.sha = exports.md5 = exports.pipeline = exports.gzip = exports.unzip = exports.NOOP = exports.BUF16 = exports.BUF4 = exports.BUF0 = void 0;
const crypto_1 = require("crypto");
const util_1 = require("util");
const zlib = __importStar(require("zlib"));
const stream = __importStar(require("stream"));
/** 一个0长buf */
exports.BUF0 = Buffer.alloc(0);
/** 4个0的buf */
exports.BUF4 = Buffer.alloc(4);
/** 16个0的buf */
exports.BUF16 = Buffer.alloc(16);
/** no operation */
const NOOP = () => { };
exports.NOOP = NOOP;
/** promisified unzip */
exports.unzip = (0, util_1.promisify)(zlib.unzip);
/** promisified gzip */
exports.gzip = (0, util_1.promisify)(zlib.gzip);
/** promisified pipeline */
exports.pipeline = (0, util_1.promisify)(stream.pipeline);
/** md5 hash */
const md5 = (data) => (0, crypto_1.createHash)("md5").update(data).digest();
exports.md5 = md5;
/** sha hash */
const sha = (data) => (0, crypto_1.createHash)("sha1").update(data).digest();
exports.sha = sha;
const randomString = (n, template = 'abcdef1234567890') => {
    const len = template.length;
    return new Array(n).fill(false).map(() => template.charAt(Math.floor(Math.random() * len))).join('');
};
exports.randomString = randomString;
function formatTime(value, template = 'yyyy-MM-dd HH:mm:ss') {
    const date = new Date();
    const o = {
        "M+": date.getMonth() + 1, //月份
        "d+": date.getDate(), //日
        "H+": date.getHours(), //小时
        "m+": date.getMinutes(), //分
        "s+": date.getSeconds(), //秒
        "q+": Math.floor((date.getMonth() + 3) / 3), //季度
        "S": date.getMilliseconds() //毫秒
    };
    if (/(y+)/.test(template))
        template = template.replace(/(y+)/, (sub) => (date.getFullYear() + "").slice(0, sub.length));
    for (let k in o) {
        const reg = new RegExp("(" + k + ")");
        if (reg.test(template)) {
            template = template.replace(reg, (v) => `${o[k]}`.padStart(v.length, ''));
        }
    }
    return template;
}
exports.formatTime = formatTime;
/** unix timestamp (second) */
const timestamp = () => Math.floor(Date.now() / 1000);
exports.timestamp = timestamp;
/** 数字ip转通用ip */
function int32ip2str(ip) {
    if (typeof ip === "string")
        return ip;
    ip = ip & 0xffffffff;
    return [
        ip & 0xff,
        (ip & 0xff00) >> 8,
        (ip & 0xff0000) >> 16,
        (ip & 0xff000000) >> 24 & 0xff,
    ].join(".");
}
exports.int32ip2str = int32ip2str;
/** 隐藏并锁定一个属性 */
function lock(obj, prop) {
    Reflect.defineProperty(obj, prop, {
        configurable: false,
        enumerable: false,
        writable: false,
    });
}
exports.lock = lock;
function unlock(obj, prop) {
    Reflect.defineProperty(obj, prop, {
        configurable: false,
        enumerable: false,
        writable: true,
    });
}
exports.unlock = unlock;
/** 隐藏一个属性 */
function hide(obj, prop) {
    Reflect.defineProperty(obj, prop, {
        configurable: false,
        enumerable: false,
        writable: true,
    });
}
exports.hide = hide;
