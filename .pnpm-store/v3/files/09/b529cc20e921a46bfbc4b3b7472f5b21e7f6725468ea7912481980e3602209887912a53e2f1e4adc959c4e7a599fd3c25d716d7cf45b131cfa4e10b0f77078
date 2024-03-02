/// <reference types="node" />
/// <reference types="node" />
import * as stream from "stream";
import { pb } from "../core";
type Client = import("../client").Client;
export declare enum CmdID {
    DmImage = 1,
    GroupImage = 2,
    SelfPortrait = 5,
    ShortVideo = 25,
    DmPtt = 26,
    MultiMsg = 27,
    GroupPtt = 29,
    OfflineFile = 69,
    GroupFile = 71,
    Ocr = 76
}
/** 上传时的附加数据，必须知道流的size和md5 */
export interface HighwayUploadExt {
    cmdid: CmdID;
    size: number;
    md5: Buffer;
    ticket?: Buffer;
    ext?: Uint8Array;
    encrypt?: boolean;
    callback?: (percentage: string) => void;
    timeout?: number;
}
/** highway上传数据 (只能上传流) */
export declare function highwayUpload(this: Client, readable: stream.Readable, obj: HighwayUploadExt, ip?: string | number, port?: number): Promise<pb.Proto>;
export declare function highwayHttpUpload(this: Client, readable: stream.Readable, obj: HighwayUploadExt, ip?: string | number, port?: number): Promise<unknown>;
export {};
