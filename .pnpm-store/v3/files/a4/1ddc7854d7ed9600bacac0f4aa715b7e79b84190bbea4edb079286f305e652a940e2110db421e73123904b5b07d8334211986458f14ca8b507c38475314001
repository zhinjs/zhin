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
exports.fetchServerList = void 0;
const net_1 = require("net");
const axios_1 = __importDefault(require("axios"));
const constants_1 = require("./constants");
const jce = __importStar(require("./jce"));
const tea = __importStar(require("./tea"));
const default_host = "msfwifi.3g.qq.com";
const default_port = 8080;
let update_time = 0;
let searching;
let host_port = {};
/**
 * @event connect2
 * @event packet
 * @event lost
 */
class Network extends net_1.Socket {
    constructor() {
        super();
        this.host = default_host;
        this.port = default_port;
        this.auto_search = true;
        this.connected = false;
        this.buf = constants_1.BUF0;
        this.on("close", () => {
            this.buf = constants_1.BUF0;
            if (this.connected) {
                this.connected = false;
                delete host_port[this.host];
                this.resolve();
                this.emit("lost");
            }
        });
        this.on("data", (chunk) => {
            this.buf = this.buf.length === 0 ? chunk : Buffer.concat([this.buf, chunk]);
            while (this.buf.length > 4) {
                let len = this.buf.readUInt32BE();
                if (this.buf.length >= len) {
                    const packet = this.buf.slice(4, len);
                    this.buf = this.buf.slice(len);
                    this.emit("packet", packet);
                }
                else {
                    break;
                }
            }
        });
    }
    join(cb = constants_1.NOOP) {
        if (this.connecting)
            return;
        if (this.connected)
            return cb();
        this.removeAllListeners("connect");
        this.connect({
            host: this.host,
            port: this.port,
            family: 4
        }, () => {
            this.connected = true;
            this.emit("connect2");
            cb();
        });
        this.resolve();
    }
    resolve() {
        if (!this.auto_search)
            return;
        const iplist = Object.keys(host_port);
        if (iplist.length > 0) {
            this.host = iplist[0];
            this.port = host_port[this.host];
        }
        if ((0, constants_1.timestamp)() - update_time >= 3600 && !searching) {
            searching = fetchServerList().then(map => {
                searching = undefined;
                const list = Object.keys(map).slice(0, 3);
                if (list[0] && list[1]) {
                    update_time = (0, constants_1.timestamp)();
                    host_port = {};
                    host_port[list[0]] = map[list[0]];
                    host_port[list[1]] = map[list[1]];
                }
            }).catch(constants_1.NOOP);
        }
    }
}
exports.default = Network;
/** 通常来说只有前两个ip比较稳定，后面的可能距离较远 */
async function fetchServerList() {
    const key = Buffer.from("F0441F5FF42DA58FDCF7949ABA62D411", "hex");
    const HttpServerListReq = jce.encodeStruct([
        null,
        0, 0, 1, "00000", 100, 537064989, "356235088634151", 0, 0, 0,
        0, 0, 0, 1
    ]);
    let body = jce.encodeWrapper({ HttpServerListReq }, "ConfigHttp", "HttpServerListReq");
    const len = Buffer.alloc(4);
    len.writeUInt32BE(body.length + 4);
    body = Buffer.concat([len, body]);
    body = tea.encrypt(body, key);
    const { data } = await axios_1.default.post("https://configsvr.msf.3g.qq.com/configsvr/serverlist.jsp?mType=getssolist", body, { timeout: 10000, responseType: "arraybuffer" });
    let buf = Buffer.from(data);
    buf = tea.decrypt(buf, key).slice(4);
    const nested = jce.decodeWrapper(buf);
    const map = {};
    for (let v of nested[2])
        map[v[1]] = v[2];
    return map;
}
exports.fetchServerList = fetchServerList;
