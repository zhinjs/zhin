/// <reference types="node" />
/// <reference types="node" />
import * as stream from "stream";
export declare function uuid(): string;
/** 计算流的md5 */
export declare function md5Stream(readable: stream.Readable): Promise<Buffer>;
/** 计算文件的md5和sha */
export declare function fileHash(filepath: string): Promise<[Buffer, Buffer]>;
/** 群号转uin */
export declare function code2uin(code: number): number;
/** uin转群号 */
export declare function uin2code(uin: number): number;
/** 解析彩色群名片 */
export declare function parseFunString(buf: Buffer): string;
/** xml转义 */
export declare function escapeXml(str: string): string;
export declare function log(any: any): void;
/** 用于下载限量 */
export declare class DownloadTransform extends stream.Transform {
    _size: number;
    _transform(data: Buffer, encoding: BufferEncoding, callback: stream.TransformCallback): void;
}
export declare const PB_CONTENT: Uint8Array;
export declare const IS_WIN: boolean;
/** 系统临时目录，用于临时存放下载的图片等内容 */
export declare const TMP_DIR: string;
/** 最大上传和下载大小，以图片上传限制为准：30MB */
export declare const MAX_UPLOAD_SIZE = 31457280;
/** 性别 */
export type Gender = "male" | "female" | "unknown";
/** 群内权限 */
export type GroupRole = "owner" | "admin" | "member";
/** 可设置的在线状态 */
export declare enum OnlineStatus {
    /** 离线 */
    Offline = 0,
    /** 在线 */
    Online = 11,
    /** 离开 */
    Absent = 31,
    /** 隐身 */
    Invisible = 41,
    /** 忙碌 */
    Busy = 50,
    /** Q我吧 */
    Qme = 60,
    /** 请勿打扰 */
    DontDisturb = 70
}
export * from "./core/constants";
