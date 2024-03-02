import { Image } from "./image";
import { Quotable, Sendable } from "./elements";
import { pb } from "../core";
import { Anonymous } from "./message";
export interface ConverterExt {
    /** 是否是私聊(default:false) */
    dm?: boolean;
    /** 网络图片缓存路径 */
    cachedir?: string;
    /** 群员列表(用于AT时查询card) */
    mlist?: Map<number, {
        card?: string;
        nickname?: string;
    }>;
}
/** 将消息元素转换为protobuf */
export declare class Converter {
    private ext?;
    is_chain: boolean;
    elems: pb.Encodable[];
    /** 用于最终发送 */
    rich: pb.Encodable;
    /** 长度(字符) */
    length: number;
    /** 包含的图片(可能需要上传) */
    imgs: Image[];
    /** 预览文字 */
    brief: string;
    /** 分片后 */
    private fragments;
    constructor(content: Sendable, ext?: ConverterExt | undefined);
    private _convert;
    private _text;
    private text;
    private at;
    private face;
    private sface;
    private bface;
    private dice;
    private rps;
    private image;
    private flash;
    private record;
    private video;
    private location;
    private node;
    private music;
    private share;
    private json;
    private xml;
    private poke;
    private markdown;
    private button;
    private mirai;
    private file;
    private reply;
    /** 转换为分片消息 */
    toFragments(): Uint8Array[];
    private _divideText;
    private _pushFragment;
    /** 匿名化 */
    anonymize(anon: Omit<Anonymous, "flag">): void;
    /** 引用回复 */
    quote(source: Quotable): void;
}
