"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPttBuffer = exports.Contactable = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const querystring_1 = __importDefault(require("querystring"));
const axios_1 = __importDefault(require("axios"));
const stream_1 = require("stream");
const crypto_1 = require("crypto");
const child_process_1 = require("child_process");
const core_1 = require("../core");
const errors_1 = require("../errors");
const common_1 = require("../common");
const message_1 = require("../message");
const highway_1 = require("./highway");
const share_1 = require("../message/share");
const silk_1 = require("../core/silk");
/** 所有用户和群的基类 */
class Contactable {
    // 对方账号，可能是群号也可能是QQ号
    get target() {
        return this.uid || this.gid || this.c.uin;
    }
    // 是否是 Direct Message (私聊)
    get dm() {
        return !!this.uid;
    }
    /** 返回所属的客户端对象 */
    get client() {
        return this.c;
    }
    constructor(c) {
        this.c = c;
        (0, common_1.lock)(this, "c");
    }
    get [Symbol.unscopables]() {
        return {
            c: true,
        };
    }
    // 取私聊图片fid
    async _offPicUp(imgs) {
        const req = [];
        for (const img of imgs) {
            req.push({
                1: this.c.uin,
                2: this.uid,
                3: 0,
                4: img.md5,
                5: img.size,
                6: img.md5.toString("hex"),
                7: 5,
                8: 9,
                9: 0,
                10: 0,
                11: 0, //retry
                12: 1, //bu
                13: img.origin ? 1 : 0,
                14: img.width,
                15: img.height,
                16: img.type,
                17: this.c.apk.version,
                22: 0,
            });
        }
        const body = core_1.pb.encode({
            1: 1,
            2: req,
            // 10: 3
        });
        const payload = await this.c.sendUni("LongConn.OffPicUp", body);
        return core_1.pb.decode(payload)[2];
    }
    // 取群聊图片fid
    async _groupPicUp(imgs) {
        const req = [];
        for (const img of imgs) {
            req.push({
                1: this.gid,
                2: this.c.uin,
                3: 0,
                4: img.md5,
                5: img.size,
                6: img.md5.toString("hex"),
                7: 5,
                8: 9,
                9: 1, //bu
                10: img.width,
                11: img.height,
                12: img.type,
                13: this.c.apk.version,
                14: 0,
                15: 1052,
                16: img.origin ? 1 : 0,
                18: 0,
                19: 0,
            });
        }
        const body = core_1.pb.encode({
            1: 3,
            2: 1,
            3: req,
        });
        const payload = await this.c.sendUni("ImgStore.GroupPicUp", body);
        return core_1.pb.decode(payload)[3];
    }
    /** 上传一批图片以备发送(无数量限制)，理论上传一次所有群和好友都能发 */
    async uploadImages(imgs) {
        this.c.logger.debug(`开始图片任务，共有${imgs.length}张图片`);
        const tasks = [];
        for (let i = 0; i < imgs.length; i++) {
            if (!(imgs[i] instanceof message_1.Image))
                imgs[i] = new message_1.Image(imgs[i], this.dm, path_1.default.join(this.c.dir, "../image"));
            tasks.push(imgs[i].task);
        }
        const res1 = await Promise.allSettled(tasks);
        for (let i = 0; i < res1.length; i++) {
            if (res1[i].status === "rejected")
                this.c.logger.warn(`图片${i + 1}失败, reason: ` + res1[i].reason?.message);
        }
        let n = 0;
        while (imgs.length > n) {
            let rsp = await (this.dm ? this._offPicUp : this._groupPicUp).call(this, imgs.slice(n, n + 20));
            !Array.isArray(rsp) && (rsp = [rsp]);
            const tasks = [];
            for (let i = n; i < imgs.length; ++i) {
                if (i >= n + 20)
                    break;
                tasks.push(this._uploadImage(imgs[i], rsp[i % 20]));
            }
            const res2 = await Promise.allSettled(tasks);
            for (let i = 0; i < res2.length; i++) {
                if (res2[i].status === "rejected") {
                    res1[n + i] = res2[i];
                    this.c.logger.warn(`图片${n + i + 1}上传失败, reason: ` + res2[i].reason?.message);
                }
            }
            n += 20;
        }
        this.c.logger.debug(`图片任务结束`);
        return res1;
    }
    async _uploadImage(img, rsp) {
        const j = this.dm ? 1 : 0;
        if (rsp[2 + j] !== 0)
            throw new Error(String(rsp[3 + j]));
        img.fid = rsp[9 + j].toBuffer?.() || rsp[9 + j];
        if (rsp[4 + j]) {
            img.deleteTmpFile();
            return;
        }
        if (!img.readable) {
            img.deleteCacheFile();
            return;
        }
        const ip = rsp[6 + j]?.[0] || rsp[6 + j];
        const port = rsp[7 + j]?.[0] || rsp[7 + j];
        return highway_1.highwayUpload.call(this.c, img.readable, {
            cmdid: j ? highway_1.CmdID.DmImage : highway_1.CmdID.GroupImage,
            md5: img.md5,
            size: img.size,
            ticket: rsp[8 + j].toBuffer()
        }, ip, port).finally(img.deleteTmpFile.bind(img));
    }
    /** 发送网址分享 */
    async shareUrl(content, config) {
        const body = (0, share_1.buildShare)((this.gid || this.uid), this.dm ? 0 : 1, content, config);
        await this.c.sendOidb("OidbSvc.0xb77_9", core_1.pb.encode(body));
    }
    /** 发送音乐分享 */
    async shareMusic(platform, id) {
        const body = await (0, message_1.buildMusic)((this.gid || this.uid), this.dm ? 0 : 1, platform, id);
        await this.c.sendOidb("OidbSvc.0xb77_9", core_1.pb.encode(body));
    }
    /** 发消息预处理 */
    async _preprocess(content, source) {
        try {
            if (!Array.isArray(content))
                content = [content];
            const forwardNode = content.filter(e => typeof e !== 'string' && e.type === 'node');
            const task = content.filter(e => !forwardNode.includes(e))
                .map(item => typeof item === "string" ? { type: 'text', text: item } : item).flat().map(async (elem) => {
                if (elem.type === 'video')
                    return await this.uploadVideo(elem);
                if (elem.type === 'share')
                    return await this.shareUrl(elem);
                if (elem.type === 'music')
                    return {
                        ...await message_1.musicFactory[elem.platform].getMusicInfo(elem.id),
                        ...elem
                    };
                if (elem.type === 'record')
                    return await this.uploadPtt(elem);
                return Promise.resolve(elem);
            });
            if (forwardNode.length)
                task.push(this.makeForwardMsg(forwardNode));
            content = (await Promise.all(task)).filter(Boolean);
            const converter = new message_1.Converter(content, {
                dm: this.dm,
                cachedir: path_1.default.join(this.c.dir, "image"),
                mlist: this.c.gml.get(this.gid)
            });
            if (source)
                await converter.quote(source);
            if (converter.imgs.length)
                await this.uploadImages(converter.imgs);
            return converter;
        }
        catch (e) {
            (0, errors_1.drop)(errors_1.ErrorCode.MessageBuilderError, e.message);
        }
    }
    async _downloadFileToTmpDir(url, headers) {
        const savePath = path_1.default.join(common_1.TMP_DIR, (0, common_1.uuid)());
        let readable = (await axios_1.default.get(url, {
            headers,
            responseType: "stream",
        })).data;
        readable = readable.pipe(new common_1.DownloadTransform);
        await (0, common_1.pipeline)(readable, fs_1.default.createWriteStream(savePath));
        return savePath;
    }
    async _saveFileToTmpDir(file) {
        const buf = file instanceof Buffer ? file : Buffer.from(file.slice(9), "base64");
        const savePath = path_1.default.join(common_1.TMP_DIR, (0, common_1.uuid)());
        await fs_1.default.promises.writeFile(savePath, buf);
        return savePath;
    }
    /** 上传一个视频以备发送(理论上传一次所有群和好友都能发) */
    async uploadVideo(elem) {
        let { file, temp = false } = elem;
        if (file instanceof Buffer || file.startsWith("base64://")) {
            file = await this._saveFileToTmpDir(file);
            temp = true;
        }
        else if (file.startsWith("protobuf://")) {
            return elem;
        }
        else if (file.startsWith('https://') || file.startsWith('http://')) {
            file = await this._downloadFileToTmpDir(file);
            temp = true;
        }
        file = file.replace(/^file:\/{2}/, "");
        common_1.IS_WIN && file.startsWith("/") && (file = file.slice(1));
        const thumb = path_1.default.join(common_1.TMP_DIR, (0, common_1.uuid)());
        await new Promise((resolve, reject) => {
            (0, child_process_1.exec)(`${this.c.config.ffmpeg_path || "ffmpeg"} -y -i "${file}" -f image2 -frames:v 1 "${thumb}"`, (error, stdout, stderr) => {
                this.c.logger.debug("ffmpeg output: " + stdout + stderr);
                fs_1.default.stat(thumb, (err) => {
                    if (err)
                        reject(new core_1.ApiRejection(errors_1.ErrorCode.FFmpegVideoThumbError, "ffmpeg获取视频图像帧失败"));
                    else
                        resolve(undefined);
                });
            });
        });
        const [width, height, seconds] = await new Promise((resolve) => {
            (0, child_process_1.exec)(`${this.c.config.ffprobe_path || "ffprobe"} -i "${file}" -show_streams`, (error, stdout, stderr) => {
                const lines = (stdout || stderr || "").split("\n");
                let width = 1280, height = 720, seconds = 120;
                for (const line of lines) {
                    if (line.startsWith("width=")) {
                        width = parseInt(line.slice(6));
                    }
                    else if (line.startsWith("height=")) {
                        height = parseInt(line.slice(7));
                    }
                    else if (line.startsWith("duration=")) {
                        seconds = parseInt(line.slice(9));
                        break;
                    }
                }
                resolve([width, height, seconds]);
            });
        });
        const md5video = await (0, common_1.md5Stream)(fs_1.default.createReadStream(file));
        const md5thumb = await (0, common_1.md5Stream)(fs_1.default.createReadStream(thumb));
        const name = md5video.toString("hex") + ".mp4";
        const videosize = (await fs_1.default.promises.stat(file)).size;
        const thumbsize = (await fs_1.default.promises.stat(thumb)).size;
        const ext = core_1.pb.encode({
            1: this.c.uin,
            2: this.target,
            3: 1,
            4: 2,
            5: {
                1: name,
                2: md5video,
                3: md5thumb,
                4: videosize,
                5: height,
                6: width,
                7: 3,
                8: seconds,
                9: thumbsize,
            },
            6: this.target,
            20: 1,
        });
        const body = core_1.pb.encode({
            1: 300,
            3: ext,
            100: {
                1: 0,
                2: 1,
            }
        });
        const payload = await this.c.sendUni("PttCenterSvr.GroupShortVideoUpReq", body);
        const rsp = core_1.pb.decode(payload)[3];
        if (rsp[1])
            throw new Error(String(rsp[2]));
        if (!rsp[7]) {
            const md5 = await (0, common_1.md5Stream)(createReadable(thumb, file));
            await highway_1.highwayUpload.call(this.c, createReadable(thumb, file), {
                cmdid: highway_1.CmdID.ShortVideo,
                md5,
                size: thumbsize + videosize,
                ext,
                encrypt: true,
            });
        }
        fs_1.default.unlink(thumb, common_1.NOOP);
        if (temp)
            fs_1.default.unlink(file, common_1.NOOP);
        const buf = core_1.pb.encode({
            1: rsp[5].toBuffer(),
            2: md5video,
            3: name,
            4: 3,
            5: seconds,
            6: videosize,
            7: width,
            8: height,
            9: md5thumb,
            10: "camera",
            11: thumbsize,
            12: 0,
            15: 1,
            16: width,
            17: height,
            18: 0,
            19: 0,
        });
        return {
            type: "video", file: "protobuf://" + Buffer.from(buf).toString("base64")
        };
    }
    /** 上传一个语音以备发送(理论上传一次所有群和好友都能发) */
    async uploadPtt(elem, transcoding = true, brief = '') {
        this.c.logger.debug("开始语音任务");
        if (typeof elem.file === "string" && elem.file.startsWith("protobuf://"))
            return elem;
        const buf = await getPttBuffer(elem.file, transcoding, this.c.config.ffmpeg_path || "ffmpeg");
        if (!elem.seconds && String(buf.slice(0, 7)).includes("SILK")) {
            elem.seconds = Math.ceil((await (0, silk_1.getDuration)(buf) || 0) / 1000);
        }
        const hash = (0, common_1.md5)(buf);
        const codec = (String(buf.slice(0, 7)).includes("SILK") || !transcoding) ? 1 : 0;
        const body = {
            1: 3,
            2: 3,
            5: {
                1: this.target,
                2: this.c.uin,
                3: 0,
                4: hash,
                5: buf.length,
                6: hash.toString("hex") + (codec ? ".slk" : ".amr"),
                7: 2,
                8: 9,
                9: 3,
                10: this.c.apk.version,
                12: elem.seconds || 1,
                13: 1,
                14: codec,
                15: 2,
            },
        };
        const payload = await this.c.sendUni("PttStore.GroupPttUp", core_1.pb.encode(body));
        const rsp = core_1.pb.decode(payload)[5];
        rsp[2] && (0, errors_1.drop)(rsp[2], rsp[3]);
        const ip = rsp[5]?.[0] || rsp[5], port = rsp[6]?.[0] || rsp[6];
        const ukey = rsp[7].toHex(), filekey = rsp[11].toHex();
        if (this.c.sig.bigdata.port) {
            await highway_1.highwayUpload.call(this.c, stream_1.Readable.from(Buffer.from(buf), { objectMode: false }), {
                cmdid: highway_1.CmdID.GroupPtt,
                md5: hash,
                size: buf.length,
                ext: core_1.pb.encode(body)
            });
        }
        else {
            const params = {
                ver: 4679,
                ukey, filekey,
                filesize: buf.length,
                bmd5: hash.toString("hex"),
                mType: "pttDu",
                voice_encodec: codec
            };
            const url = `http://${(0, common_1.int32ip2str)(ip)}:${port}/?` + querystring_1.default.stringify(params);
            const headers = {
                "User-Agent": `QQ/${this.c.apk.version} CFNetwork/1126`,
                "Net-Type": "Wifi"
            };
            await axios_1.default.post(url, buf, { headers });
        }
        this.c.logger.debug("语音任务结束");
        const fid = rsp[11].toBuffer();
        const b = {
            1: 4,
            2: this.c.uin,
            3: fid,
            4: hash,
            5: hash.toString("hex") + ".amr",
            6: buf.length,
            8: 0,
            11: 1,
            18: fid,
            29: codec,
            30: {
                1: 0,
                5: 0,
                6: '',
                7: 0,
                8: brief
            },
        };
        if (elem.seconds)
            b[19] = elem.seconds;
        return {
            type: "record", file: "protobuf://" + Buffer.from(core_1.pb.encode(b)).toString("base64")
        };
    }
    async _newUploadMultiMsg(compressed) {
        const body = core_1.pb.encode({
            2: {
                1: this.dm ? 1 : 3,
                2: {
                    2: this.target
                },
                4: compressed
            },
            15: {
                1: 4,
                2: 2,
                3: 9,
                4: 0
            }
        });
        const payload = await this.c.sendUni("trpc.group.long_msg_interface.MsgService.SsoSendLongMsg", body);
        const rsp = core_1.pb.decode(payload)?.[2];
        if (!rsp?.[3])
            (0, errors_1.drop)(rsp?.[1], rsp?.[2]?.toString() || "unknown trpc.group.long_msg_interface.MsgService.SsoSendLongMsg error");
        return rsp[3].toString();
    }
    async _uploadMultiMsg(compressed) {
        const body = core_1.pb.encode({
            1: 1,
            2: 5,
            3: 9,
            4: 3,
            5: this.c.apk.version,
            6: [{
                    1: this.target,
                    2: compressed.length,
                    3: (0, common_1.md5)(compressed),
                    4: 3,
                    5: 0,
                }],
            8: 1,
        });
        const payload = await this.c.sendUni("MultiMsg.ApplyUp", body);
        let rsp = core_1.pb.decode(payload)[2];
        if (rsp[1] !== 0)
            (0, errors_1.drop)(rsp[1], rsp[2]?.toString() || "unknown MultiMsg.ApplyUp error");
        const buf = core_1.pb.encode({
            1: 1,
            2: 5,
            3: 9,
            4: [{
                    1: this.dm ? 1 : 3,
                    2: this.target,
                    4: compressed,
                    5: 2,
                    6: rsp[3].toBuffer(),
                }],
        });
        const ip = rsp[4]?.[0] || rsp[4], port = rsp[5]?.[0] || rsp[5];
        await highway_1.highwayUpload.call(this.c, stream_1.Readable.from(Buffer.from(buf), { objectMode: false }), {
            cmdid: highway_1.CmdID.MultiMsg,
            md5: (0, common_1.md5)(buf),
            size: buf.length,
            ticket: rsp[10].toBuffer(),
        }, ip, port);
        return rsp[2].toString();
    }
    /**
     * 制作一条合并转发消息以备发送（制作一次可以到处发）
     * 需要注意的是，好友图片和群图片的内部格式不一样，对着群制作的转发消息中的图片，发给好友可能会裂图，反过来也一样
     * 支持4层套娃转发（PC仅显示3层）
     */
    async makeForwardMsg(msglist, nt = false) {
        if (!Array.isArray(msglist))
            msglist = [msglist];
        const nodes = [];
        const makers = [];
        let imgs = [];
        let preview = [];
        let cnt = 0;
        let MultiMsg = [];
        let brief;
        for (const fake of msglist) {
            brief = null;
            if (!Array.isArray(fake.message))
                fake.message = [fake.message];
            if (fake.message.length === 1 && typeof fake.message[0] !== "string" && ['xml', 'json'].includes(fake.message[0].type)) {
                const elem = fake.message[0];
                let resid;
                let fileName;
                if (elem.type === 'xml') {
                    let brief_reg = /brief\=\"(.*?)\"/gm.exec(elem.data);
                    if (brief_reg && brief_reg.length > 0) {
                        brief = brief_reg[1];
                    }
                    else
                        brief = '[XML]';
                    let resid_reg = /m_resid\=\"(.*?)\"/gm.exec(elem.data);
                    let fileName_reg = /m_fileName\=\"(.*?)\"/gm.exec(elem.data);
                    if (resid_reg && resid_reg.length > 1 && fileName_reg && fileName_reg.length > 1) {
                        resid = resid_reg[1];
                        fileName = fileName_reg[1];
                    }
                }
                else if (elem.type === 'json') {
                    brief = '[JSON]';
                    let json;
                    try {
                        json = typeof (elem.data) === 'object' ? elem.data : JSON.parse(elem.data);
                    }
                    catch (err) {
                    }
                    if (json) {
                        brief = json.prompt;
                        if (json.app === 'com.tencent.multimsg' && json.meta?.detail) {
                            let detail = json.meta.detail;
                            resid = detail.resid;
                            fileName = detail.uniseq;
                        }
                    }
                }
                if (resid && fileName) {
                    const buff = nt ? await this._newDownloadMultiMsg(String(resid), this.dm ? 1 : 2) : await this._downloadMultiMsg(String(resid), this.dm ? 1 : 2);
                    let arr = core_1.pb.decode(buff)[2];
                    if (!Array.isArray(arr))
                        arr = [arr];
                    for (let val of arr) {
                        let m_fileName = val[1].toString();
                        if (m_fileName === 'MultiMsg') {
                            MultiMsg.push({
                                1: fileName,
                                2: val[2]
                            });
                        }
                        else {
                            MultiMsg.push(val);
                        }
                    }
                }
            }
            const maker = await this._preprocess(fake.message);
            if (maker?.brief && brief) {
                maker.brief = brief;
            }
            makers.push(maker);
            const seq = (0, crypto_1.randomBytes)(2).readInt16BE();
            const rand = (0, crypto_1.randomBytes)(4).readInt32BE();
            let nickname = String(fake.nickname || fake.user_id);
            if (!nickname && fake instanceof message_1.PrivateMessage)
                nickname = this.c.fl.get(fake.user_id)?.nickname || this.c.sl.get(fake.user_id)?.nickname || nickname;
            if (cnt < 4) {
                preview.push({
                    text: `${(0, common_1.escapeXml)(nickname)}: ${(0, common_1.escapeXml)(maker.brief.slice(0, 50))}`
                });
                cnt++;
            }
            if (nt) {
                nodes.push({
                    1: {
                        1: fake.user_id,
                        //2: 'uid',
                        6: this.dm ? this.c.uin : null,
                        8: this.dm ? null : {
                            1: this.target,
                            2: nickname,
                            5: 2
                        }
                    },
                    2: {
                        1: this.dm ? 166 : 82,
                        4: rand,
                        5: seq,
                        6: fake.time || (0, common_1.timestamp)(),
                        7: 1,
                        8: 0,
                        9: 0
                    },
                    3: {
                        1: maker.rich
                    }
                });
            }
            else {
                nodes.push({
                    1: {
                        1: fake.user_id,
                        2: this.target,
                        3: this.dm ? 166 : 82,
                        4: this.dm ? 11 : null,
                        5: seq,
                        6: fake.time || (0, common_1.timestamp)(),
                        7: (0, message_1.rand2uuid)(rand),
                        9: this.dm ? null : {
                            1: this.target,
                            4: nickname,
                        },
                        14: this.dm ? nickname : null,
                        20: {
                            1: 0,
                            2: rand
                        }
                    },
                    3: {
                        1: maker.rich
                    }
                });
            }
        }
        MultiMsg.push({
            1: "MultiMsg",
            2: {
                1: nodes
            }
        });
        const compressed = await (0, common_1.gzip)(core_1.pb.encode({
            //1: nodes,
            2: MultiMsg
        }));
        let resid;
        try {
            resid = nt ? await this._newUploadMultiMsg(compressed) : await this._uploadMultiMsg(compressed);
        }
        catch {
            resid = nt ? await this._newUploadMultiMsg(compressed) : await this._uploadMultiMsg(compressed);
        }
        const json = {
            "app": "com.tencent.multimsg",
            "config": { "autosize": 1, "forward": 1, "round": 1, "type": "normal", "width": 300 },
            "desc": "[聊天记录]",
            "extra": "",
            "meta": {
                "detail": {
                    "news": preview,
                    "resid": resid,
                    "source": "群聊的聊天记录",
                    "summary": `查看${nodes.length}条转发消息`,
                    "uniseq": (0, common_1.uuid)().toUpperCase()
                }
            },
            "prompt": "[聊天记录]",
            "ver": "0.0.0.5",
            "view": "contact"
        };
        return {
            type: "json",
            data: json
        };
    }
    /** 下载并解析合并转发 */
    async getForwardMsg(resid, fileName = "MultiMsg", nt = false) {
        const ret = [];
        const buf = nt ? await this._newDownloadMultiMsg(String(resid), this.dm ? 1 : 2) : await this._downloadMultiMsg(String(resid), this.dm ? 1 : 2);
        let a = core_1.pb.decode(buf)[2];
        if (!Array.isArray(a))
            a = [a];
        for (let b of a) {
            const m_fileName = b[1].toString();
            if (m_fileName === fileName) {
                a = b;
                break;
            }
        }
        if (Array.isArray(a))
            a = a[0];
        a = a[2][1];
        if (!Array.isArray(a))
            a = [a];
        for (let proto of a) {
            try {
                ret.push(new message_1.ForwardMessage(proto));
            }
            catch {
            }
        }
        return ret;
    }
    async _newDownloadMultiMsg(resid, bu) {
        const body = core_1.pb.encode({
            1: {
                1: {
                    2: this.target
                },
                2: resid,
                3: bu === 2 ? 3 : 1
            },
            15: {
                1: 2,
                2: 2,
                3: 9,
                4: 0
            }
        });
        const payload = await this.c.sendUni("trpc.group.long_msg_interface.MsgService.SsoRecvLongMsg", body);
        const rsp = core_1.pb.decode(payload)?.[1];
        if (!rsp?.[4])
            return common_1.BUF0;
        return (0, common_1.unzip)(rsp[4].toBuffer());
    }
    async _downloadMultiMsg(resid, bu) {
        const body = core_1.pb.encode({
            1: 2,
            2: 5,
            3: 9,
            4: 3,
            5: this.c.apk.version,
            7: [{
                    1: resid,
                    2: 3,
                }],
            8: bu,
            9: 2,
        });
        const payload = await this.c.sendUni("MultiMsg.ApplyDown", body);
        const rsp = core_1.pb.decode(payload)[3];
        const ip = (0, common_1.int32ip2str)(rsp[4]?.[0] || rsp[4]);
        const port = rsp[5]?.[0] || rsp[5];
        let url = port == 443 ? `https://${ip}` : `http://${ip}:${port}`;
        url += rsp[2];
        let { data, headers } = await axios_1.default.get(url, {
            headers: {
                "Host": `${port == 443 ? 'ssl.' : ''}htdata.qq.com`,
                "User-Agent": `QQ/${this.c.apk.version} CFNetwork/1126`,
                "Net-Type": "Wifi"
            }, responseType: "arraybuffer"
        });
        data = Buffer.from(data);
        let buf = headers["accept-encoding"]?.includes("gzip") ? await (0, common_1.unzip)(data) : data;
        const head_len = buf.readUInt32BE(1);
        const body_len = buf.readUInt32BE(5);
        buf = core_1.tea.decrypt(buf.slice(head_len + 9, head_len + 9 + body_len), rsp[3].toBuffer());
        return (0, common_1.unzip)(core_1.pb.decode(buf)[3][3].toBuffer());
    }
    /** 获取视频下载地址 */
    async getVideoUrl(fid, md5) {
        const body = core_1.pb.encode({
            1: 400,
            4: {
                1: this.c.uin,
                2: this.c.uin,
                3: 1,
                4: 7,
                5: fid,
                6: 1,
                8: md5 instanceof Buffer ? md5 : Buffer.from(md5, "hex"),
                9: 1,
                10: 2,
                11: 2,
                12: 2,
            }
        });
        const payload = await this.c.sendUni("PttCenterSvr.ShortVideoDownReq", body);
        const rsp = core_1.pb.decode(payload)[4];
        if (rsp[1] !== 0)
            (0, errors_1.drop)(rsp[1], "获取视频下载地址失败");
        const obj = rsp[9];
        return String(Array.isArray(obj[10]) ? obj[10][0] : obj[10]) + String(obj[11]);
    }
}
exports.Contactable = Contactable;
// 两个文件合并到一个流
function createReadable(file1, file2) {
    return stream_1.Readable.from(concatStreams(fs_1.default.createReadStream(file1, { highWaterMark: 256 * 1024 }), fs_1.default.createReadStream(file2, { highWaterMark: 256 * 1024 })));
}
// 合并两个流
async function* concatStreams(readable1, readable2) {
    for await (const chunk of readable1)
        yield chunk;
    for await (const chunk of readable2)
        yield chunk;
}
async function getPttBuffer(file, transcoding = true, ffmpeg = "ffmpeg") {
    if (file instanceof Buffer || file.startsWith("base64://")) {
        // Buffer或base64
        const buf = file instanceof Buffer ? file : Buffer.from(file.slice(9), "base64");
        const head = buf.slice(0, 7).toString();
        if (head.includes("SILK") || head.includes("AMR") || !transcoding) {
            return buf;
        }
        else {
            const tmpfile = path_1.default.join(common_1.TMP_DIR, (0, common_1.uuid)());
            await fs_1.default.promises.writeFile(tmpfile, buf);
            return audioTrans(tmpfile, ffmpeg, true);
        }
    }
    else if (file.startsWith("http://") || file.startsWith("https://")) {
        // 网络文件
        const readable = (await axios_1.default.get(file, { responseType: "stream" })).data;
        const tmpfile = path_1.default.join(common_1.TMP_DIR, (0, common_1.uuid)());
        await (0, common_1.pipeline)(readable.pipe(new common_1.DownloadTransform), fs_1.default.createWriteStream(tmpfile));
        const head = await read7Bytes(tmpfile);
        if (head.includes("SILK") || head.includes("AMR") || !transcoding) {
            const buf = await fs_1.default.promises.readFile(tmpfile);
            fs_1.default.unlink(tmpfile, common_1.NOOP);
            return buf;
        }
        else {
            return audioTrans(tmpfile, ffmpeg, true);
        }
    }
    else {
        // 本地文件
        file = String(file).replace(/^file:\/{2}/, "");
        common_1.IS_WIN && file.startsWith("/") && (file = file.slice(1));
        const head = await read7Bytes(file);
        if (head.includes("SILK") || head.includes("AMR") || !transcoding) {
            return fs_1.default.promises.readFile(file);
        }
        else {
            return audioTrans(file, ffmpeg);
        }
    }
}
exports.getPttBuffer = getPttBuffer;
function audioTransSlik(file, ffmpeg = "ffmpeg", temp = false) {
    return new Promise((resolve, reject) => {
        const tmpfile = path_1.default.join(common_1.TMP_DIR, (0, common_1.uuid)());
        (0, child_process_1.exec)(`${ffmpeg} -y -i "${file}" -f s16le -ar 24000 -ac 1 -fs 31457280 "${tmpfile}"`, async (error, stdout, stderr) => {
            try {
                const pcm = await fs_1.default.promises.readFile(tmpfile);
                try {
                    const slik = (await (0, silk_1.encode)(pcm, 24000)).data;
                    resolve(Buffer.from(slik));
                }
                catch {
                    reject(new core_1.ApiRejection(errors_1.ErrorCode.FFmpegPttTransError, "音频转码到silk失败，请确认你的ffmpeg可以处理此转换"));
                }
            }
            catch {
                reject(new core_1.ApiRejection(errors_1.ErrorCode.FFmpegPttTransError, "音频转码到pcm失败，请确认你的ffmpeg可以处理此转换"));
            }
            finally {
                fs_1.default.unlink(tmpfile, common_1.NOOP);
                if (temp)
                    fs_1.default.unlink(file, common_1.NOOP);
            }
        });
    });
}
function audioTrans(file, ffmpeg = "ffmpeg", temp = false) {
    return new Promise(async (resolve, reject) => {
        try {
            const slik = await audioTransSlik(file, ffmpeg, temp);
            resolve(slik);
            return;
        }
        catch { }
        const tmpfile = path_1.default.join(common_1.TMP_DIR, (0, common_1.uuid)());
        (0, child_process_1.exec)(`${ffmpeg} -y -i "${file}" -ac 1 -ar 8000 -f amr "${tmpfile}"`, async (error, stdout, stderr) => {
            try {
                const amr = await fs_1.default.promises.readFile(tmpfile);
                resolve(amr);
            }
            catch {
                reject(new core_1.ApiRejection(errors_1.ErrorCode.FFmpegPttTransError, "音频转码到amr失败，请确认你的ffmpeg可以处理此转换"));
            }
            finally {
                fs_1.default.unlink(tmpfile, common_1.NOOP);
                if (temp)
                    fs_1.default.unlink(file, common_1.NOOP);
            }
        });
    });
}
async function read7Bytes(file) {
    const fd = await fs_1.default.promises.open(file, "r");
    const buf = (await fd.read(Buffer.alloc(7), 0, 7, 0)).buffer;
    fd.close();
    return buf;
}
