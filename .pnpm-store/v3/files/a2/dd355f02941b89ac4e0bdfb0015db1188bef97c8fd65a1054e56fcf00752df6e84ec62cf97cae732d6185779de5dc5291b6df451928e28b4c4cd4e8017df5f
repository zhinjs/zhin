/// <reference types="node" />
/// <reference types="node" />
import { PassThrough } from "stream";
export default interface Writer {
    read(size?: number): Buffer;
}
export default class Writer extends PassThrough {
    writeU8(v: number): this;
    writeU16(v: number): this;
    write32(v: number): this;
    writeU32(v: number): this;
    writeU64(v: number | bigint): this;
    writeBytes(v: string | Uint8Array): this;
    writeWithLength(v: string | Uint8Array): this;
    writeTlv(v: string | Uint8Array): this;
}
