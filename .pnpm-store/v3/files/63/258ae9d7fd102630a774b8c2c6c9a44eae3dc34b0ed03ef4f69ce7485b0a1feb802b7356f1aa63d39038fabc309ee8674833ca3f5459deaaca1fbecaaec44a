/// <reference types="node" />
/// <reference types="node" />
/// <reference types="node" />
/// <reference types="node" />
import { BinaryLike } from "crypto";
import * as zlib from "zlib";
import * as stream from "stream";
/** 一个0长buf */
export declare const BUF0: Buffer;
/** 4个0的buf */
export declare const BUF4: Buffer;
/** 16个0的buf */
export declare const BUF16: Buffer;
/** no operation */
export declare const NOOP: () => void;
/** promisified unzip */
export declare const unzip: typeof zlib.unzip.__promisify__;
/** promisified gzip */
export declare const gzip: typeof zlib.gzip.__promisify__;
/** promisified pipeline */
export declare const pipeline: typeof stream.pipeline.__promisify__;
/** md5 hash */
export declare const md5: (data: BinaryLike) => Buffer;
/** sha hash */
export declare const sha: (data: BinaryLike) => Buffer;
export declare const randomString: (n: number, template?: string) => string;
export declare function formatTime(value: Date | number | string, template?: string): string;
/** unix timestamp (second) */
export declare const timestamp: () => number;
/** 数字ip转通用ip */
export declare function int32ip2str(ip: number | string): string;
/** 隐藏并锁定一个属性 */
export declare function lock(obj: any, prop: string): void;
export declare function unlock(obj: any, prop: string): void;
/** 隐藏一个属性 */
export declare function hide(obj: any, prop: string): void;
