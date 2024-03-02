export interface encodeResult {
    /** silk */
    data: Uint8Array;
    duration: number;
}
export interface decodeResult {
    /** pcm_s16le */
    data: Uint8Array;
    duration: number;
}
export declare function encode(input: ArrayBufferView | ArrayBuffer, sampleRate: number): Promise<encodeResult>;
export declare function decode(input: ArrayBufferView | ArrayBuffer, sampleRate: number): Promise<decodeResult>;
export declare function getDuration(silk: ArrayBufferView | ArrayBuffer, frameMs?: number): number;
export declare function isWav(fileData: ArrayBufferView | ArrayBuffer): boolean;
