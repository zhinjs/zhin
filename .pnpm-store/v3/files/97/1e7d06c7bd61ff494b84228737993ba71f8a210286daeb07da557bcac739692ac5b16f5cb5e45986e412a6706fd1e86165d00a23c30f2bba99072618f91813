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
exports.Gfs = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const crypto_1 = require("crypto");
const stream_1 = require("stream");
const core_1 = require("./core");
const errors_1 = require("./errors");
const common = __importStar(require("./common"));
const internal_1 = require("./internal");
function checkRsp(rsp) {
    if (!rsp[1])
        return;
    (0, errors_1.drop)(rsp[1], rsp[2]);
}
/**
 * 群文件系统
 * `fid`表示一个文件或目录的id，`pid`表示它所在目录的id
 * 根目录的id为"/"
 * 只能在根目录下创建目录
 * 删除一个目录会删除下面的全部文件
 */
class Gfs {
    /** `this.gid`的别名 */
    get group_id() {
        return this.gid;
    }
    /** 返回所在群的实例 */
    get group() {
        return this.c.pickGroup(this.gid);
    }
    /** 返回所属的客户端对象 */
    get client() {
        return this.c;
    }
    constructor(c, gid) {
        this.c = c;
        this.gid = gid;
        common.lock(this, "c");
        common.lock(this, "gid");
    }
    /** 获取使用空间和文件数 */
    async df() {
        const [a, b] = await Promise.all([
            (async () => {
                const body = core_1.pb.encode({
                    4: {
                        1: this.gid,
                        2: 3,
                    },
                });
                const payload = await this.c.sendOidbSvcTrpcTcp("OidbSvcTrpcTcp.0x6d8_3", body);
                const rsp = payload[4];
                const total = Number(rsp[4]), used = Number(rsp[5]), free = total - used;
                return {
                    /** 总空间 */
                    total,
                    /** 已使用的空间 */
                    used,
                    /** 剩余空间 */
                    free,
                };
            })(),
            (async () => {
                const body = core_1.pb.encode({
                    3: {
                        1: this.gid,
                        2: 2,
                    },
                });
                const payload = await this.c.sendOidbSvcTrpcTcp("OidbSvcTrpcTcp.0x6d8_2", body);
                const rsp = payload[3];
                const file_count = Number(rsp[4]), max_file_count = Number(rsp[6]);
                return {
                    /** 文件数 */
                    file_count,
                    /** 文件数量上限 */
                    max_file_count,
                };
            })(),
        ]);
        return Object.assign(a, b);
    }
    async _resolve(fid) {
        const body = core_1.pb.encode({
            1: {
                1: this.gid,
                2: 0,
                4: String(fid),
            },
        });
        const payload = await this.c.sendOidbSvcTrpcTcp("OidbSvcTrpcTcp.0x6d8_0", body);
        const rsp = payload[1];
        checkRsp(rsp);
        return genGfsFileStat(rsp[4]);
    }
    /**
     * 获取文件或目录属性
     * @param fid 目标文件id
     */
    async stat(fid) {
        try {
            return await this._resolve(fid);
        }
        catch (e) {
            const files = await this.dir("/");
            for (let file of files) {
                if (!file.is_dir)
                    break;
                if (file.fid === fid)
                    return file;
            }
            throw e;
        }
    }
    /**
     * 列出`pid`目录下的所有文件和目录
     * @param pid 目标目录，默认为根目录，即`"/"`
     * @param start @todo 未知参数
     * @param limit 文件/目录上限，超过此上限就停止获取，默认`100`
     * @returns 文件和目录列表
     */
    async dir(pid = "/", start = 0, limit = 100) {
        const body = core_1.pb.encode({
            2: {
                1: this.gid,
                2: 1,
                3: String(pid),
                5: Number(limit) || 100,
                13: Number(start) || 0,
            },
        });
        const payload = await this.c.sendOidbSvcTrpcTcp("OidbSvcTrpcTcp.0x6d8_1", body);
        const rsp = payload[2];
        checkRsp(rsp);
        const arr = [];
        if (!rsp[5])
            return arr;
        const files = Array.isArray(rsp[5]) ? rsp[5] : [rsp[5]];
        for (let file of files) {
            if (file[3])
                arr.push(genGfsFileStat(file[3]));
            else if (file[2])
                arr.push(genGfsDirStat(file[2]));
        }
        return arr;
    }
    /** {@link dir} 的别名 */
    ls(pid = "/", start = 0, limit = 100) {
        return this.dir(pid, start, limit);
    }
    /** 创建目录(只能在根目录下创建) */
    async mkdir(name) {
        const body = core_1.pb.encode({
            1: {
                1: this.gid,
                2: 0,
                3: "/",
                4: String(name),
            },
        });
        const payload = await this.c.sendOidbSvcTrpcTcp("OidbSvcTrpcTcp.0x6d7_0", body);
        const rsp = payload[1];
        checkRsp(rsp);
        return genGfsDirStat(rsp[4]);
    }
    /** 删除文件/目录(删除目录会删除下面的所有文件) */
    async rm(fid) {
        fid = String(fid);
        let rsp;
        if (!fid.startsWith("/")) {
            //rm file
            const file = await this._resolve(fid);
            const body = core_1.pb.encode({
                4: {
                    1: this.gid,
                    2: 3,
                    3: file.busid,
                    4: file.pid,
                    5: file.fid,
                },
            });
            const payload = await this.c.sendOidbSvcTrpcTcp("OidbSvcTrpcTcp.0x6d6_3", body);
            rsp = payload[4];
        }
        else {
            //rm dir
            const body = core_1.pb.encode({
                2: {
                    1: this.gid,
                    2: 1,
                    3: String(fid),
                },
            });
            const payload = await this.c.sendOidbSvcTrpcTcp("OidbSvcTrpcTcp.0x6d7_1", body);
            rsp = payload[2];
        }
        checkRsp(rsp);
    }
    /**
     * 重命名文件/目录
     * @param fid 文件id
     * @param name 新命名
     */
    async rename(fid, name) {
        fid = String(fid);
        let rsp;
        if (!fid.startsWith("/")) {
            //rename file
            const file = await this._resolve(fid);
            const body = core_1.pb.encode({
                5: {
                    1: this.gid,
                    2: 4,
                    3: file.busid,
                    4: file.fid,
                    5: file.pid,
                    6: String(name),
                },
            });
            const payload = await this.c.sendOidbSvcTrpcTcp("OidbSvcTrpcTcp.0x6d6_4", body);
            rsp = payload[5];
        }
        else {
            //rename dir
            const body = core_1.pb.encode({
                3: {
                    1: this.gid,
                    2: 2,
                    3: String(fid),
                    4: String(name),
                },
            });
            const payload = await this.c.sendOidbSvcTrpcTcp("OidbSvcTrpcTcp.0x6d7_2", body);
            rsp = payload[3];
        }
        checkRsp(rsp);
    }
    /**
     * 移动文件
     * @param fid 要移动的文件id
     * @param pid 目标目录id
     */
    async mv(fid, pid) {
        const file = await this._resolve(fid);
        const body = core_1.pb.encode({
            6: {
                1: this.gid,
                2: 5,
                3: file.busid,
                4: file.fid,
                5: file.pid,
                6: String(pid),
            },
        });
        const payload = await this.c.sendOidbSvcTrpcTcp("OidbSvcTrpcTcp.0x6d6_5", body);
        const rsp = payload[6];
        checkRsp(rsp);
    }
    async _feed(fid, busid) {
        const body = core_1.pb.encode({
            5: {
                1: this.gid,
                2: 4,
                3: {
                    1: busid,
                    2: fid,
                    3: (0, crypto_1.randomBytes)(4).readInt32BE(),
                    5: 1,
                },
            },
        });
        const payload = await this.c.sendOidbSvcTrpcTcp("OidbSvcTrpcTcp.0x6d9_4", body);
        let rsp = payload[5];
        checkRsp(rsp);
        rsp = rsp[4];
        checkRsp(rsp);
        return await this._resolve(rsp[3]);
    }
    /**
     * 上传一个文件
     * @param file `string`表示从该本地文件路径上传，`Buffer`表示直接上传这段内容
     * @param pid 上传的目标目录id，默认根目录
     * @param name 上传的文件名，`file`为`Buffer`时，若留空则自动以md5命名
     * @param callback 监控上传进度的回调函数，拥有一个"百分比进度"的参数
     * @returns 上传的文件属性
     */
    async upload(file, pid = "/", name, callback) {
        let size, md5, sha1;
        if (file instanceof Uint8Array) {
            if (!Buffer.isBuffer(file))
                file = Buffer.from(file);
            size = file.length;
            (md5 = common.md5(file)), (sha1 = common.sha(file));
            name = name ? String(name) : "file" + md5.toString("hex");
        }
        else {
            file = String(file);
            size = (await fs_1.default.promises.stat(file)).size;
            [md5, sha1] = await common.fileHash(file);
            name = name ? String(name) : path_1.default.basename(file);
        }
        const body = core_1.pb.encode({
            1: {
                1: this.gid,
                2: 0,
                3: 102,
                4: 5,
                5: String(pid),
                6: name,
                7: "/storage/emulated/0/Pictures/files/s/" + name,
                8: size,
                9: sha1,
                11: md5,
                15: 1,
            },
        });
        const payload = await this.c.sendOidbSvcTrpcTcp("OidbSvcTrpcTcp.0x6d6_0", body);
        const rsp = payload[1];
        checkRsp(rsp);
        if (!rsp[10]) {
            const ext = core_1.pb.encode({
                1: 100,
                2: 1,
                3: 0,
                100: {
                    100: {
                        1: rsp[6],
                        100: this.c.uin,
                        200: this.gid,
                        400: this.gid,
                    },
                    200: {
                        100: size,
                        200: md5,
                        300: sha1,
                        600: rsp[7],
                        700: rsp[9],
                    },
                    300: {
                        100: 2,
                        200: String(this.c.apk.subid),
                        300: 2,
                        400: "9e9c09dc",
                        600: 4,
                    },
                    400: {
                        100: name,
                    },
                    500: {
                        200: {
                            1: {
                                1: 1,
                                2: rsp[12],
                            },
                            2: rsp[14],
                        },
                    },
                },
            });
            await internal_1.highwayUpload.call(this.c, Buffer.isBuffer(file)
                ? stream_1.Readable.from(file, { objectMode: false })
                : fs_1.default.createReadStream(String(file), { highWaterMark: 1024 * 256 }), {
                cmdid: 71,
                callback,
                md5,
                size,
                ext,
            });
        }
        return await this._feed(String(rsp[7]), rsp[6]);
    }
    /**
     * 将文件转发到当前群
     * @param stat 另一个群中的文件属性
     * @param pid 转发的目标目录，默认根目录
     * @param name 转发后的文件名，默认不变
     * @returns 转发的文件在当前群的属性
     */
    async forward(stat, pid = "/", name) {
        const body = core_1.pb.encode({
            1: {
                1: this.gid,
                2: 3,
                3: 102,
                4: 5,
                5: String(pid),
                6: String(name || stat.name),
                7: "/storage/emulated/0/Pictures/files/s/" + (name || stat.name),
                8: Number(stat.size),
                9: Buffer.from(stat.sha1, "hex"),
                11: Buffer.from(stat.md5, "hex"),
                15: 1,
            },
        });
        const payload = await this.c.sendOidbSvcTrpcTcp("OidbSvcTrpcTcp.0x6d6_0", body);
        const rsp = payload[1];
        checkRsp(rsp);
        if (!rsp[10])
            (0, errors_1.drop)(errors_1.ErrorCode.GroupFileNotExists, "文件不存在，无法被转发");
        return await this._feed(String(rsp[7]), rsp[6]);
    }
    /**
     * 将离线(私聊)文件转发到当前群
     * @param fid 私聊文件fid
     * @param name 转发后的文件名，默认不变
     * @returns 转发的文件在当前群的属性
     */
    async forwardOfflineFile(fid, name) {
        const stat = await this.c.pickFriend(this.c.uin).getFileInfo(fid);
        const body = core_1.pb.encode({
            1: 60100,
            2: 0,
            101: 3,
            102: 103,
            90000: {
                10: this.gid,
                30: 102,
                40: this.c.uin,
                50: stat.size,
                60: String(name || stat.name),
                80: fid,
            },
        });
        const payload = await this.c.sendOidbSvcTrpcTcp("OidbSvcTrpcTcp.0xe37_60100", body);
        const rsp = payload[90000];
        if (rsp[10] !== 0)
            (0, errors_1.drop)(errors_1.ErrorCode.OfflineFileNotExists, "文件不存在，无法被转发");
        return await this._feed(String(rsp[30]), rsp[50]);
    }
    /**
     * 获取文件下载地址
     * @param fid 文件id
     */
    async download(fid) {
        const file = await this._resolve(fid);
        const body = core_1.pb.encode({
            3: {
                1: this.gid,
                2: 2,
                3: file.busid,
                4: file.fid,
            },
        });
        const payload = await this.c.sendOidbSvcTrpcTcp("OidbSvcTrpcTcp.0x6d6_2", body);
        const rsp = payload[3];
        checkRsp(rsp);
        return {
            name: file.name,
            url: encodeURI(`http://${rsp[4]}/ftn_handler/${rsp[6].toHex()}/?fname=${file.name}`),
            size: file.size,
            md5: file.md5,
            duration: file.duration,
            fid: file.fid,
        };
    }
}
exports.Gfs = Gfs;
function genGfsDirStat(file) {
    return {
        fid: String(file[1]),
        pid: String(file[2]),
        name: String(file[3]),
        create_time: file[4],
        modify_time: file[5],
        user_id: file[6],
        file_count: file[8] || 0,
        is_dir: true,
    };
}
function genGfsFileStat(file) {
    const stat = {
        fid: String(file[1]),
        pid: String(file[16]),
        name: String(file[2]),
        busid: file[4],
        size: file[5],
        md5: file[12].toHex(),
        sha1: file[10].toHex(),
        create_time: file[6],
        duration: file[7],
        modify_time: file[8],
        user_id: file[15],
        download_times: file[9],
        is_dir: false,
    };
    if (stat.fid.startsWith("/"))
        stat.fid = stat.fid.slice(1);
    return stat;
}
