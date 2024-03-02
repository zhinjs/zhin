"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Converter = void 0;
const zlib_1 = require("zlib");
const face_1 = require("./face");
const image_1 = require("./image");
const elements_1 = require("./elements");
const core_1 = require("../core");
const message_1 = require("./message");
const music_1 = require("./music");
const EMOJI_NOT_ENDING = ["\uD835", "\uD83C", "\uD83D", "\uD83E", "\u200D"];
const EMOJI_NOT_STARTING = ["\uFE0F", "\u200D", "\u20E3"];
const PB_RESERVER = core_1.pb.encode({
    37: {
        17: 0,
        19: {
            15: 0,
            31: 0,
            41: 0
        },
    }
});
const AT_BUF = Buffer.from([0, 1, 0, 0, 0]);
const BUF1 = Buffer.from([1]);
const BUF2 = Buffer.alloc(2);
const random = (a, b) => Math.floor(Math.random() * (b - a) + a);
/** 将消息元素转换为protobuf */
class Converter {
    constructor(content, ext) {
        this.ext = ext;
        this.is_chain = true;
        this.elems = [];
        /** 用于最终发送 */
        this.rich = { 2: this.elems, 4: null };
        /** 长度(字符) */
        this.length = 0;
        /** 包含的图片(可能需要上传) */
        this.imgs = [];
        /** 预览文字 */
        this.brief = "";
        /** 分片后 */
        this.fragments = [];
        let _content = Array.isArray(content) ? content : [content];
        for (let elem of _content) {
            if (!(typeof (elem) === "string" || elements_1.ChainElemTypes.includes(elem.type))) {
                _content = [elem];
                break;
            }
        }
        for (let elem of _content) {
            this._convert(elem);
        }
        if (!this.elems.length && !this.rich[4])
            throw new Error("empty message");
        this.elems.push(PB_RESERVER);
    }
    _convert(elem) {
        if (typeof elem === "string")
            this._text(elem);
        else if (Reflect.has(this, elem.type))
            this[elem.type](elem);
    }
    _text(text, attr6) {
        text = String(text);
        if (!text.length)
            return;
        this.elems.push({
            1: {
                1: text,
                3: attr6
            }
        });
        this.length += text.length;
        this.brief += text;
    }
    text(elem) {
        this._text(elem.text);
    }
    at(elem) {
        let { qq, id, text, dummy } = elem;
        if (qq === 0 && id) {
            // 频道中的AT
            this.elems.push({
                1: {
                    1: text || (id === "all" ? "@全体成员" : ("@" + id)),
                    12: {
                        3: 2,
                        5: id === "all" ? 0 : BigInt(id)
                    }
                }
            });
            return;
        }
        if (qq === "all") {
            var q = 0, flag = 1, display = "全体成员";
        }
        else {
            var q = Number(qq), flag = 0, display = text || String(qq);
            if (!text) {
                const member = this.ext?.mlist?.get(q);
                display = member?.card || member?.nickname || display;
            }
        }
        display = "@" + display;
        if (dummy)
            return this._text(display);
        const buf = Buffer.allocUnsafe(6);
        buf.writeUInt8(display.length);
        buf.writeUInt8(flag, 1);
        buf.writeUInt32BE(q, 2);
        const attr6 = Buffer.concat([AT_BUF, buf, BUF2]);
        this._text(display, attr6);
    }
    face(elem) {
        let { id, text, qlottie } = elem;
        id = Number(id);
        if (id < 0 || id > 0xffff || isNaN(id))
            throw new Error("wrong face id: " + id);
        if (qlottie) {
            if (face_1.facemap[id]) {
                text = face_1.facemap[id];
            }
            else if (!text) {
                text = "/" + id;
            }
            if (!text.startsWith("/"))
                text = "/" + text;
            this.elems.push([
                {
                    53: {
                        1: 37,
                        2: {
                            1: "1",
                            2: qlottie,
                            3: id,
                            4: 1,
                            5: 1,
                            6: "",
                            7: text,
                            8: "",
                            9: 1
                        },
                        3: 1
                    }
                },
                {
                    1: {
                        1: text,
                        12: {
                            1: "[" + text.replace("/", "") + "]请使用最新版手机QQ体验新功能"
                        }
                    }
                },
                {
                    37: {
                        17: 21908,
                        19: {
                            15: 65536,
                            31: 0,
                            41: 0
                        }
                    }
                }
            ]);
            return;
        }
        if (id <= 0xff) {
            const old = Buffer.allocUnsafe(2);
            old.writeUInt16BE(0x1441 + id);
            this.elems.push({
                2: {
                    1: id,
                    2: old,
                    11: face_1.FACE_OLD_BUF
                }
            });
        }
        else {
            if (face_1.facemap[id])
                text = face_1.facemap[id];
            else if (!text)
                text = "/" + id;
            this.elems.push({
                53: {
                    1: 33,
                    2: {
                        1: id,
                        2: text,
                        3: text
                    },
                    3: 1
                }
            });
        }
        this.brief += "[表情]";
    }
    sface(elem) {
        let { id, text } = elem;
        if (!text)
            text = String(id);
        text = "[" + text + "]";
        this.elems.push({
            "53": {
                "1": 37,
                "2": {
                    "1": "1",
                    "2": "1",
                    "3": id,
                    "4": 1,
                    "5": 1,
                    "6": {},
                    "7": text,
                    "9": 1
                },
                "3": 1
            }
        });
        //console.log(JSON.stringify(this.elems));
        this._text(text);
    }
    bface(elem, magic) {
        let { file, text } = elem;
        if (!text)
            text = "原创表情";
        text = "[" + String(text).slice(0, 5) + "]";
        const o = {
            1: text,
            2: 6,
            3: 1,
            4: Buffer.from(file.slice(0, 32), "hex"),
            5: parseInt(file.slice(64)),
            6: 3,
            7: Buffer.from(file.slice(32, 64), "hex"),
            9: 0,
            10: 200,
            11: 200,
            12: magic || null
        };
        this.elems.push({ 6: o });
        this._text(text);
    }
    dice(elem) {
        const id = (elem.id >= 1 && elem.id <= 6) ? (elem.id - 1) : random(0, 6);
        return this.bface({
            type: "bface", file: "4823d3adb15df08014ce5d6796b76ee13430396532613639623136393138663911464", text: "骰子"
        }, Buffer.from([0x72, 0x73, 0x63, 0x54, 0x79, 0x70, 0x65, 0x3f, 0x31, 0x3b, 0x76, 0x61, 0x6c, 0x75, 0x65, 0x3d, 0x30 + id]));
    }
    rps(elem) {
        const id = (elem.id >= 1 && elem.id <= 3) ? (elem.id - 1) : random(0, 3);
        return this.bface({
            type: "bface", file: "83c8a293ae65ca140f348120a77448ee3764653339666562636634356536646211415", text: "猜拳"
        }, Buffer.from([0x72, 0x73, 0x63, 0x54, 0x79, 0x70, 0x65, 0x3f, 0x31, 0x3b, 0x76, 0x61, 0x6c, 0x75, 0x65, 0x3d, 0x30 + id]));
    }
    image(elem) {
        const img = new image_1.Image(elem, this.ext?.dm, this.ext?.cachedir);
        this.imgs.push(img);
        this.elems.push(this.ext?.dm ? { 4: img.proto } : { 8: img.proto });
        this.brief += "[图片]";
    }
    flash(elem) {
        const img = new image_1.Image(elem, this.ext?.dm, this.ext?.cachedir);
        this.imgs.push(img);
        this.elems.push({
            53: {
                1: 3,
                2: this.ext?.dm ? { 2: img.proto } : { 1: img.proto },
                3: 0,
            }
        });
        this.elems.push({
            1: {
                1: "[闪照]请使用新版手机QQ查看闪照。"
            }
        });
        this.brief += "[闪照]";
    }
    record(elem) {
        let file = String(elem.file);
        if (!file.startsWith("protobuf://"))
            throw new Error("非法的语音元素: " + file);
        const buf = Buffer.from(file.replace("protobuf://", ""), "base64");
        this.rich[4] = buf;
        this.brief += "[语音]";
        this.is_chain = false;
    }
    video(elem) {
        let file = String(elem.file);
        if (!file.startsWith("protobuf://"))
            throw new Error("非法的视频元素: " + file);
        const buf = Buffer.from(file.replace("protobuf://", ""), "base64");
        this.elems.push({ 19: buf });
        this.elems.push({
            1: {
                1: "你的QQ暂不支持查看视频短片，请期待后续版本。"
            }
        });
        this.brief += "[视频]";
        this.is_chain = false;
    }
    location(elem) {
        let { address, lat, lng, name, id } = elem;
        if (!address || !lat || !lng)
            throw new Error("location share need 'address', 'lat' and 'lng'");
        let data = {
            config: { forward: true, type: "card", autosize: true },
            prompt: "[应用]地图",
            from: 1,
            app: "com.tencent.map",
            ver: "1.0.3.5",
            view: "LocationShare",
            meta: {
                "Location.Search": {
                    from: "plusPanel",
                    id: id || "",
                    lat, lng, address,
                    name: name || "位置分享"
                }
            },
            desc: "地图"
        };
        this.json({
            type: "json", data
        });
    }
    node(elem) {
        throw new Error('这个不能直接发');
    }
    music(elem) {
        if (['title', 'singer', 'jumpUrl', 'musicUrl', 'preview'].some(key => !elem[key]))
            return this.json({
                type: 'json',
                data: (0, music_1.makeMusicJson)(elem)
            });
    }
    share(elem) {
        throw new Error('这个不能直接发');
    }
    json(elem) {
        this.elems.push({
            51: {
                1: Buffer.concat([BUF1, (0, zlib_1.deflateSync)(typeof elem.data === "string" ? elem.data : JSON.stringify(elem.data))])
            }
        });
        this.brief += "[json消息]";
        this.is_chain = false;
    }
    xml(elem) {
        this.elems.push({
            12: {
                1: Buffer.concat([BUF1, (0, zlib_1.deflateSync)(elem.data)]),
                2: elem.id > 0 ? elem.id : 60,
            }
        });
        this.brief += "[xml消息]";
        this.is_chain = false;
    }
    poke(elem) {
        let { id } = elem;
        if (!(id >= 0 && id <= 6))
            throw new Error("wrong poke id: " + id);
        this.elems.push({
            53: {
                1: 2,
                2: {
                    3: 0,
                    7: 0,
                    10: 0,
                },
                3: id,
            }
        });
        this.brief += "[戳一戳]";
        this.is_chain = false;
    }
    markdown(elem) {
        const { content } = elem;
        this.elems.push({
            53: {
                1: 45,
                2: {
                    1: content
                },
                3: 1
            }
        });
        this.brief += "[markdown消息]";
    }
    button(elem) {
        const { content } = elem;
        const _content = {
            1: {
                1: content.rows.map(row => {
                    return {
                        1: row.buttons.map(button => {
                            return {
                                1: button.id,
                                2: {
                                    1: button.render_data.label,
                                    2: button.render_data.visited_label,
                                    3: button.render_data.style
                                },
                                3: {
                                    1: button.action.type,
                                    2: {
                                        1: button.action.permission.type,
                                        2: button.action.permission.specify_role_ids,
                                        3: button.action.permission.specify_user_ids,
                                    },
                                    4: button.action.unsupport_tips,
                                    5: button.action.data,
                                    7: button.action.reply ? 1 : 0,
                                    8: button.action.enter ? 1 : 0
                                }
                            };
                        })
                    };
                }),
                2: content.appid
            }
        };
        this.elems.push({
            53: {
                1: 46,
                2: _content,
                3: 1
            }
        });
        this.brief += "[button消息]";
    }
    mirai(elem) {
        const { data } = elem;
        this.elems.push({
            31: {
                2: String(data),
                3: 103904510
            }
        });
        this.brief += data;
    }
    file(elem) {
        throw new Error("暂不支持发送或转发file元素，请调用文件相关API完成该操作");
    }
    reply(elem) {
        const { id } = elem;
        if (id.length > 24)
            this.quote({ ...(0, message_1.parseGroupMessageId)(id), message: elem.text || '[消息]' });
        else
            this.quote({ ...(0, message_1.parseDmMessageId)(id), message: elem.text || '[消息]' });
    }
    /** 转换为分片消息 */
    toFragments() {
        this.elems.pop();
        let frag = [];
        for (let proto of this.elems) {
            if (proto[1] && !proto[1][3]) {
                this._pushFragment(frag);
                frag = [];
                this._divideText(proto[1][1]);
            }
            else {
                frag.push(proto);
            }
        }
        if (!frag.length && this.fragments.length === 1) {
            frag.push({
                1: {
                    1: "",
                }
            });
        }
        this._pushFragment(frag);
        return this.fragments;
    }
    _divideText(text) {
        let n = 0;
        while (n < text.length) {
            let m = n + 80;
            let chunk = text.slice(n, m);
            n = m;
            if (text.length > n) {
                // emoji不能从中间分割，否则客户端会乱码
                while (EMOJI_NOT_ENDING.includes(chunk[chunk.length - 1]) && text[n]) {
                    chunk += text[n];
                    ++n;
                }
                while (EMOJI_NOT_STARTING.includes(text[n])) {
                    chunk += text[n];
                    ++n;
                    while (EMOJI_NOT_ENDING.includes(chunk[chunk.length - 1]) && text[n]) {
                        chunk += text[n];
                        ++n;
                    }
                }
            }
            this._pushFragment([{
                    1: {
                        1: chunk
                    }
                }]);
        }
    }
    _pushFragment(proto) {
        if (proto.length > 0) {
            proto.push(PB_RESERVER);
            this.fragments.push(core_1.pb.encode({
                2: proto
            }));
        }
    }
    /** 匿名化 */
    anonymize(anon) {
        this.elems.unshift({
            21: {
                1: 2,
                3: anon.name,
                4: anon.id2,
                5: anon.expire_time,
                6: anon.id,
            }
        });
    }
    /** 引用回复 */
    quote(source) {
        const elems = new Converter(source.message || "", this.ext).elems;
        const tmp = this.brief;
        if (!this.ext?.dm) {
            this.at({ type: "at", qq: source.user_id });
            this.elems.unshift(this.elems.pop());
        }
        this.elems.unshift({
            45: {
                1: [source.seq],
                2: source.user_id,
                3: source.time,
                4: 1,
                5: elems,
                6: 0,
                8: {
                    3: (0, message_1.rand2uuid)(source.rand || 0)
                }
            }
        });
        this.brief = `[回复${this.brief.replace(tmp, "")}]` + tmp;
    }
}
exports.Converter = Converter;
