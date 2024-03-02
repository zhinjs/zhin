/// <reference types="node" />
export interface state {
    state: Uint32Array;
    orgState: Uint32Array;
    nr: number;
    p: number;
}
export declare class state {
    constructor(a: Uint32Array, b: Uint32Array, c: number, d: number);
    init(a: Buffer, b: Buffer, c: Uint32Array, d: number): void;
    encrypt(data: Buffer): void;
}
/**
 * t544 algorithm
 * @param curr
 * @param input
 */
export declare function sign(curr: number, input: Buffer): Buffer;
