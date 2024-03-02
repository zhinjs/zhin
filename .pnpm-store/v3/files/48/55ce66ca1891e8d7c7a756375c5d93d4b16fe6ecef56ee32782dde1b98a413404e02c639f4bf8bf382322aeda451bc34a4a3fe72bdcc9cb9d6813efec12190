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
exports.highwayHttpUpload = exports.highwayUpload = exports.CmdID = void 0;
const stream = __importStar(require("stream"));
const net = __importStar(require("net"));
const crypto_1 = require("crypto");
const http_1 = __importDefault(require("http"));
const axios_1 = __importDefault(require("axios"));
const core_1 = require("../core");
const errors_1 = require("../errors");
const common_1 = require("../common");
var CmdID;
(function (CmdID) {
    CmdID[CmdID["DmImage"] = 1] = "DmImage";
    CmdID[CmdID["GroupImage"] = 2] = "GroupImage";
    CmdID[CmdID["SelfPortrait"] = 5] = "SelfPortrait";
    CmdID[CmdID["ShortVideo"] = 25] = "ShortVideo";
    CmdID[CmdID["DmPtt"] = 26] = "DmPtt";
    CmdID[CmdID["MultiMsg"] = 27] = "MultiMsg";
    CmdID[CmdID["GroupPtt"] = 29] = "GroupPtt";
    CmdID[CmdID["OfflineFile"] = 69] = "OfflineFile";
    CmdID[CmdID["GroupFile"] = 71] = "GroupFile";
    CmdID[CmdID["Ocr"] = 76] = "Ocr";
    //
})(CmdID || (exports.CmdID = CmdID = {}));
const __ = Buffer.from([41]);
class HighwayTransform extends stream.Transform {
    constructor(c, obj) {
        super();
        this.c = c;
        this.obj = obj;
        this.seq = (0, crypto_1.randomBytes)(2).readUInt16BE();
        this.offset = 0;
        if (!obj.ticket)
            this.obj.ticket = c.sig.bigdata.sig_session;
        if (obj.encrypt && obj.ext)
            this.obj.ext = core_1.tea.encrypt(obj.ext, c.sig.bigdata.session_key);
        this.on("error", common_1.NOOP);
    }
    _transform(data, encoding, callback) {
        let offset = 0, limit = 1048576;
        while (offset < data.length) {
            const chunk = data.slice(offset, limit + offset);
            const head = core_1.pb.encode({
                1: {
                    1: 1,
                    2: String(this.c.uin),
                    3: "PicUp.DataUp",
                    4: this.seq++,
                    6: this.c.apk.subid,
                    7: 4096,
                    8: this.obj.cmdid,
                    10: 2052,
                },
                2: {
                    2: this.obj.size,
                    3: this.offset + offset,
                    4: chunk.length,
                    6: this.obj.ticket,
                    8: (0, common_1.md5)(chunk),
                    9: this.obj.md5,
                },
                3: this.obj.ext
            });
            offset += chunk.length;
            const _ = Buffer.allocUnsafe(9);
            _.writeUInt8(40);
            _.writeUInt32BE(head.length, 1);
            _.writeUInt32BE(chunk.length, 5);
            this.push(_);
            this.push(head);
            this.push(chunk);
            this.push(__);
        }
        this.offset += data.length;
        callback(null);
    }
}
/** highway上传数据 (只能上传流) */
function highwayUpload(readable, obj, ip, port) {
    ip = (0, common_1.int32ip2str)(ip || this.sig.bigdata.ip);
    port = port || this.sig.bigdata.port;
    if (!port)
        throw new core_1.ApiRejection(errors_1.ErrorCode.NoUploadChannel, "没有上传通道，如果你刚刚登录，请等待几秒");
    if (!readable)
        throw new core_1.ApiRejection(errors_1.ErrorCode.HighwayFileTypeError, "不支持的file类型");
    return new Promise((resolve, reject) => {
        const highway = new HighwayTransform(this, obj);
        const createSocket = (ip, port) => {
            this.logger.debug(`[${obj.md5.toString('hex')}]highway ip:${ip} port:${port}`);
            let upload_timeout = -1;
            const connect_timeout = setTimeout(() => {
                socket.destroy(new Error(`[${obj.md5.toString('hex')}]highway ip:${ip} port:${port} connect timeout`));
            }, 6000);
            const socket = net.connect(port, ip, () => {
                clearTimeout(connect_timeout);
                if (obj.timeout > 0) {
                    upload_timeout = setTimeout(() => {
                        socket.end();
                        reject(new core_1.ApiRejection(errors_1.ErrorCode.HighwayTimeout, `[${obj.md5.toString('hex')}]上传超时(${obj.timeout}s)`));
                    }, obj.timeout * 1000);
                }
                readable.pipe(highway).pipe(socket, { end: false });
            });
            const handleRspHeader = (header) => {
                const rsp = core_1.pb.decode(header);
                if (typeof rsp[3] === "number" && rsp[3] !== 0) {
                    this.logger.warn(`[${obj.md5.toString('hex')}]highway upload failed (code: ${rsp[3]})`);
                    readable.unpipe(highway).destroy();
                    highway.unpipe(socket).destroy();
                    socket.end();
                    reject(new core_1.ApiRejection(rsp[3], `[${obj.md5.toString('hex')}]unknown highway error`));
                }
                else {
                    const percentage = ((rsp[2][3] + rsp[2][4]) / rsp[2][2] * 100).toFixed(2);
                    //rsp[2][9].toBuffer()
                    this.logger.debug(`[${obj.md5.toString('hex')}]highway chunk uploaded (${percentage}%)`);
                    if (typeof obj.callback === "function")
                        obj.callback(percentage);
                    if (Number(percentage) >= 100) {
                        socket.end();
                        resolve(rsp[7]);
                    }
                }
            };
            let buf = common_1.BUF0;
            socket.on("data", (chunk) => {
                try {
                    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
                    while (buf.length >= 5) {
                        const len = buf.readInt32BE(1);
                        if (buf.length >= len + 10) {
                            handleRspHeader(buf.slice(9, len + 9));
                            buf = buf.slice(len + 10);
                        }
                        else {
                            break;
                        }
                    }
                }
                catch (err) {
                    this.logger.error(err);
                }
            });
            socket.on("close", (had_error) => {
                clearTimeout(upload_timeout);
                if (had_error && ip != (0, common_1.int32ip2str)(this.sig.bigdata.ip) && this.sig.bigdata.port) {
                    this.logger.error(`[${obj.md5.toString('hex')}]highway ip:${ip} port:${port} network error`);
                    createSocket((0, common_1.int32ip2str)(this.sig.bigdata.ip), this.sig.bigdata.port);
                    return;
                }
                reject(new core_1.ApiRejection(errors_1.ErrorCode.HighwayNetworkError, `[${obj.md5.toString('hex')}]上传遇到网络错误`));
            });
            socket.on("error", (err) => {
                this.logger.error(err);
            });
            readable.on("error", (err) => {
                this.logger.error(err);
                socket.end();
            });
        };
        createSocket(ip, port);
    });
}
exports.highwayUpload = highwayUpload;
const agent = new http_1.default.Agent({ maxSockets: 10 });
function highwayHttpUpload(readable, obj, ip, port) {
    ip = (0, common_1.int32ip2str)(ip || this.sig.bigdata.ip);
    port = port || this.sig.bigdata.port;
    if (!port)
        throw new core_1.ApiRejection(errors_1.ErrorCode.NoUploadChannel, "没有上传通道，如果你刚刚登录，请等待几秒");
    this.logger.debug(`highway(http) ip:${ip} port:${port}`);
    const url = "http://" + ip + ":" + port + "/cgi-bin/httpconn?htcmd=0x6FF0087&uin=" + this.uin;
    let seq = 1;
    let offset = 0, limit = 524288;
    obj.ticket = this.sig.bigdata.sig_session;
    const tasks = new Set();
    const controller = new AbortController();
    const cancels = new Set();
    let finished = 0;
    readable.on("data", data => {
        let _offset = 0;
        while (_offset < data.length) {
            const chunk = data.slice(_offset, limit + _offset);
            const head = core_1.pb.encode({
                1: {
                    1: 1,
                    2: String(this.uin),
                    3: "PicUp.DataUp",
                    4: seq++,
                    5: 0,
                    6: this.apk.subid,
                    8: obj.cmdid,
                },
                2: {
                    1: 0,
                    2: obj.size,
                    3: offset + _offset,
                    4: chunk.length,
                    6: obj.ticket,
                    8: (0, common_1.md5)(chunk),
                    9: obj.md5,
                    10: 0,
                    13: 0,
                },
                3: obj.ext,
                4: Date.now()
            });
            _offset += chunk.length;
            const _ = Buffer.allocUnsafe(9);
            _.writeUInt8(40);
            _.writeUInt32BE(head.length, 1);
            _.writeUInt32BE(chunk.length, 5);
            const buf = Buffer.concat([_, head, chunk, __]);
            const task = new Promise((resolve, reject) => {
                const c = axios_1.default.CancelToken.source();
                cancels.add(c);
                axios_1.default.post(url, buf, {
                    responseType: "arraybuffer",
                    httpAgent: agent,
                    cancelToken: c.token,
                    headers: {
                        "Content-Length": String(buf.length),
                        "Content-Type": "application/octet-stream"
                    }
                }).then(r => {
                    let percentage, rsp;
                    try {
                        const buf = Buffer.from(r?.data);
                        const header = buf.slice(9, buf.length - 1);
                        rsp = core_1.pb.decode(header);
                    }
                    catch (err) {
                        this.logger.error(err);
                        reject(err);
                        return;
                    }
                    if (rsp?.[3] !== 0) {
                        controller.abort();
                        reject(new core_1.ApiRejection(rsp[3], "unknown highway error"));
                        return;
                    }
                    ++finished;
                    percentage = (finished / tasks.size * 100).toFixed(2);
                    this.logger.debug(`highway(http) chunk uploaded (${percentage}%)`);
                    if (typeof obj.callback === "function" && percentage)
                        obj.callback(percentage);
                    if (finished < tasks.size && rsp[7]?.toBuffer().length > 0) {
                        cancels.forEach(c => c.cancel());
                        this.logger.debug(`highway(http) chunk uploaded (100.00%)`);
                        if (typeof obj.callback === "function")
                            obj.callback("100.00");
                    }
                    if (finished >= tasks.size && !rsp[7]?.toBuffer().length)
                        reject(new core_1.ApiRejection(errors_1.ErrorCode.UnsafeFile, "文件校验未通过，上传失败"));
                    resolve(undefined);
                }).catch(reject);
            });
            tasks.add(task);
        }
        offset += data.length;
    });
    return new Promise((resolve, reject) => {
        readable.on("err", reject)
            .on("end", () => {
            Promise.all(tasks).then(resolve).catch(err => {
                if (err instanceof axios_1.default.Cancel === false) {
                    cancels.forEach(c => c.cancel());
                    reject(err);
                }
                resolve(undefined);
            });
        });
    });
}
exports.highwayHttpUpload = highwayHttpUpload;
