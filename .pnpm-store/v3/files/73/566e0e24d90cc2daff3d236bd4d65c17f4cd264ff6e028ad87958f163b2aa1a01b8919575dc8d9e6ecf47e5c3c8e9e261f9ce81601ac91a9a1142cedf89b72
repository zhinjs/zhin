"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Image = exports.parseImageFileParam = exports.buildImageFileParam = void 0;
const stream_1 = require("stream");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const crypto_1 = require("crypto");
const probe_image_size_1 = __importDefault(require("probe-image-size"));
const axios_1 = __importDefault(require("axios"));
const common_1 = require("../common");
const TYPE = {
    jpg: 1000,
    png: 1001,
    webp: 1002,
    bmp: 1005,
    gif: 2000,
    face: 4,
};
const EXT = {
    3: "png",
    4: "face",
    1000: "jpg",
    1001: "png",
    1002: "webp",
    1003: "jpg",
    1005: "bmp",
    2000: "gif",
    2001: "png",
};
/** 构造图片file */
function buildImageFileParam(md5, size, width, height, type) {
    size = size || 0;
    width = width || 0;
    height = height || 0;
    const ext = EXT[type] || "jpg";
    return md5 + size + "-" + width + "-" + height + "." + ext;
}
exports.buildImageFileParam = buildImageFileParam;
/** 从图片的file中解析出图片属性参数 */
function parseImageFileParam(file) {
    let md5, size, width, height, ext;
    let sp = file.split("-");
    md5 = sp[0].slice(0, 32);
    size = Number(sp[0].slice(32)) || 0;
    width = Number(sp[1]) || 0;
    height = parseInt(sp[2]) || 0;
    sp = file.split(".");
    ext = sp[1] || "jpg";
    return { md5, size, width, height, ext };
}
exports.parseImageFileParam = parseImageFileParam;
class Image {
    /** 从服务端拿到fid后必须设置此值，否则图裂 */
    set fid(val) {
        this._fid = val;
        if (this.dm) {
            this.proto[3] = val;
            this.proto[10] = val;
        }
        else {
            this.proto[7] = val;
        }
    }
    /** @param elem
     * @param cachedir
     @param dm 是否私聊图片 */
    constructor(elem, dm = false, cachedir) {
        this.dm = dm;
        this.cachedir = cachedir;
        /** 最终用于发送的对象 */
        this.proto = {};
        /** 图片属性 */
        this.md5 = (0, crypto_1.randomBytes)(16);
        this.size = 0xffff;
        this.width = 320;
        this.height = 240;
        this.type = 1000;
        let { file, cache, timeout, headers, asface, origin, summary } = elem;
        this.origin = origin;
        this.asface = asface;
        this.summary = summary;
        this.setProto();
        if (file instanceof Buffer) {
            this.task = this.fromProbeSync(file);
        }
        else if (file instanceof stream_1.Readable) {
            this.task = this.fromReadable(file);
        }
        else if (typeof file !== "string") {
            throw new Error("bad file param: " + file);
        }
        else if (file.startsWith("base64://")) {
            this.task = this.fromProbeSync(Buffer.from(file.slice(9), "base64"));
        }
        else if (file.startsWith("http://") || file.startsWith("https://")) {
            this.task = this.fromWeb(file, cache, headers, timeout);
        }
        else {
            this.task = this.fromLocal(file);
        }
    }
    setProperties(dimensions) {
        if (!dimensions)
            throw new Error("bad image file");
        this.width = dimensions.width;
        this.height = dimensions.height;
        this.type = TYPE[dimensions.type] || 1000;
    }
    parseFileParam(file) {
        const { md5, size, width, height, ext } = parseImageFileParam(file);
        const hash = Buffer.from(md5, "hex");
        if (hash.length !== 16)
            throw new Error("bad file param: " + file);
        this.md5 = hash;
        size > 0 && (this.size = size);
        this.width = width;
        this.height = height;
        TYPE[ext] & (this.type = TYPE[ext]);
        this.setProto();
    }
    async fromProbeSync(buf) {
        const dimensions = probe_image_size_1.default.sync(buf);
        this.setProperties(dimensions);
        this.md5 = (0, common_1.md5)(buf);
        this.size = buf.length;
        this.readable = stream_1.Readable.from(buf, { objectMode: false });
        this.setProto();
    }
    async fromReadable(readable, timeout) {
        try {
            readable = readable.pipe(new common_1.DownloadTransform);
            timeout = timeout > 0 ? timeout : 60;
            this.tmpfile = path_1.default.join(common_1.TMP_DIR, (0, common_1.uuid)());
            var id = setTimeout(() => {
                readable.destroy();
            }, timeout * 1000);
            const [dimensions, md5] = await Promise.all([
                // @ts-ignore
                (0, probe_image_size_1.default)(readable, true),
                (0, common_1.md5Stream)(readable),
                (0, common_1.pipeline)(readable, fs_1.default.createWriteStream(this.tmpfile)),
            ]);
            this.setProperties(dimensions);
            this.md5 = md5;
            this.size = (await fs_1.default.promises.stat(this.tmpfile)).size;
            this.readable = fs_1.default.createReadStream(this.tmpfile, { highWaterMark: 1024 * 256 });
            this.setProto();
        }
        catch (e) {
            this.deleteTmpFile();
            throw e;
        }
        finally {
            clearTimeout(id);
        }
    }
    async fromWeb(url, cache, headers, timeout) {
        if (this.cachedir) {
            this.cachefile = path_1.default.join(this.cachedir, (0, common_1.md5)(url).toString("hex"));
            if (cache) {
                try {
                    this.parseFileParam(await fs_1.default.promises.readFile(this.cachefile, "utf8"));
                    return;
                }
                catch { }
            }
        }
        const readable = (await axios_1.default.get(url, {
            headers,
            responseType: "stream",
        })).data;
        await this.fromReadable(readable, timeout);
        this.cachefile && fs_1.default.writeFile(this.cachefile, buildImageFileParam(this.md5.toString("hex"), this.size, this.width, this.height, this.type), common_1.NOOP);
    }
    async fromLocal(file) {
        try {
            //收到的图片
            this.parseFileParam(file);
        }
        catch {
            //本地图片
            file.startsWith("file://") && (file = file.slice(7).replace(/%20/g, " "));
            common_1.IS_WIN && file.startsWith("/") && (file = file.slice(1));
            const stat = await fs_1.default.promises.stat(file);
            if (stat.size <= 0 || stat.size > common_1.MAX_UPLOAD_SIZE)
                throw new Error("bad file size: " + stat.size);
            const readable = fs_1.default.createReadStream(file);
            const [dimensions, md5] = await Promise.all([
                // @ts-ignore
                (0, probe_image_size_1.default)(readable, true),
                (0, common_1.md5Stream)(readable)
            ]);
            readable.destroy();
            this.setProperties(dimensions);
            this.md5 = md5;
            this.size = stat.size;
            this.readable = fs_1.default.createReadStream(file, { highWaterMark: 1024 * 256 });
            this.setProto();
        }
    }
    setProto() {
        let proto;
        if (this.dm) {
            proto = {
                1: this.md5.toString("hex"),
                2: this.size,
                3: this._fid,
                5: this.type,
                7: this.md5,
                8: this.height,
                9: this.width,
                10: this._fid,
                13: this.origin ? 1 : 0,
                16: this.type === 4 ? 5 : 0,
                24: 0,
                25: 0,
                29: {
                    1: this.asface ? 1 : 0
                },
            };
        }
        else {
            proto = {
                2: this.md5.toString("hex") + (this.asface ? ".gif" : ".jpg"),
                7: this._fid,
                8: 0,
                9: 0,
                10: 66,
                12: 1,
                13: this.md5,
                // 17: 3,
                20: this.type,
                22: this.width,
                23: this.height,
                24: 200,
                25: this.size,
                26: this.origin ? 1 : 0,
                29: 0,
                30: 0,
                34: {
                    1: this.asface ? 1 : 0
                },
            };
        }
        if (this.summary)
            proto[this.dm ? 29 : 34][this.dm ? 8 : 9] = this.summary;
        Object.assign(this.proto, proto);
    }
    /** 服务端图片失效时建议调用此函数 */
    deleteCacheFile() {
        this.cachefile && fs_1.default.unlink(this.cachefile, common_1.NOOP);
    }
    /** 图片上传完成后建议调用此函数(文件存在系统临时目录中) */
    deleteTmpFile() {
        this.tmpfile && fs_1.default.unlink(this.tmpfile, common_1.NOOP);
        this.readable?.destroy();
    }
}
exports.Image = Image;
