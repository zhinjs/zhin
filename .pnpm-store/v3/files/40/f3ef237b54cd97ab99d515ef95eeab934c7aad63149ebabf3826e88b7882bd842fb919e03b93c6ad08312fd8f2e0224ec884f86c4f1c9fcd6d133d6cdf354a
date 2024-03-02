import { pb } from "../core";
import * as T from "./elements";
/** 解析消息 */
export declare function parse(rich: pb.Proto | pb.Proto[], uin?: number): Parser;
/** 消息解析器 */
export declare class Parser {
    private uin?;
    message: T.MessageElem[];
    brief: string;
    content: string;
    /** 匿名情报 */
    anon?: pb.Proto;
    /** 额外情报 */
    extra?: pb.Proto;
    /** 引用回复 */
    quotation?: pb.Proto;
    atme: boolean;
    atall: boolean;
    newImg: boolean;
    imgprefix: any;
    private exclusive;
    private it?;
    constructor(rich: pb.Proto | pb.Proto[], uin?: number | undefined);
    /** 获取下一个节点的文本 */
    private getNextText;
    /** 解析: xml, json, ptt, video, flash, file, shake, poke */
    private parseExclusiveElem;
    /** 解析: text, at, face, bface, sface, image, mirai */
    private parsePartialElem;
    private parseElems;
    private parseNewImgElem;
    private parseImgElem;
}
export declare function getGroupImageUrl(md5: string): string;
