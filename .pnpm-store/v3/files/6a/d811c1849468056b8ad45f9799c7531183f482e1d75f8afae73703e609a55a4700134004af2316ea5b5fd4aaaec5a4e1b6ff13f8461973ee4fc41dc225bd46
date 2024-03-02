/// <reference types="node" />
export type JceObject = {
    [tag: number]: any;
};
export declare class Struct extends null {
}
export declare class Nested {
    data: Buffer;
    constructor(data: Buffer);
}
export declare function decode(encoded: Buffer): JceObject;
export declare function encode(obj: JceObject | any[]): Buffer;
/** 嵌套结构数据必须调用此函数创建 */
export declare function encodeNested(obj: JceObject | any[]): Nested;
