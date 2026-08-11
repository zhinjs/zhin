/**
 * silk-wasm 是纯可选运行时依赖（不入 package.json）：silk-transcode.ts 在
 * try/catch 里动态 import，缺失时降级返回 null。这里只声明用到的最小表面。
 */
declare module 'silk-wasm' {
  export function decode(
    input: Uint8Array,
    sampleRate: number,
  ): Promise<{ data: Uint8Array; duration: number }>;
}
