/// <reference types="node" />
export interface Encodable {
    [tag: number]: any;
}
export declare class Proto implements Encodable {
    private encoded;
    [tag: number]: any;
    get length(): number;
    constructor(encoded: Buffer, decoded?: Proto);
    toString(): string;
    toHex(): string;
    toBase64(): string;
    toBuffer(): Buffer;
    toJSON(): any;
    [Symbol.toPrimitive](): string;
}
export declare function encode(obj: Encodable): Uint8Array;
export declare function decode(encoded: Buffer): Proto;
export declare function decodePb(buffer_data: Buffer): {};
